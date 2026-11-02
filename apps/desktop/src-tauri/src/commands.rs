use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize, Serializer};
use tauri::ipc::{Channel, InvokeResponseBody, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use wither_blockbench::BlockbenchError;
use wither_core::{AppInfo, Settings, SettingsPatch, TestTarget};
use wither_diagnostics::Problem;
use wither_git::{GitError, RepoStatus};
use wither_packs::{FoundPack, Install, Installed, PackError, TestReport, World};
use wither_terminal::{SpawnOptions, TerminalError, TerminalSize};
use wither_workspace::{RecentProject, SearchMatch, Workspace, WorkspaceError};

use crate::state::AppState;

const SEARCH_LIMIT: usize = 500;
const MAX_QUERY_LEN: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("no workspace is open")]
    NoWorkspace,
    #[error("the picked location is not a local folder")]
    NotAFolder,
    #[error("that folder is not in the recent list")]
    NotRecent,
    #[error("search query is too long")]
    QueryTooLong,
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error(transparent)]
    Terminal(#[from] TerminalError),
    #[error(transparent)]
    Git(#[from] GitError),
    #[error(transparent)]
    Blockbench(#[from] BlockbenchError),
    #[error("no model file found for {0}")]
    NoModel(String),
    #[error("this workspace isn't a folder on disk, open the project folder to use Blockbench")]
    NotOnDisk,
    #[error(transparent)]
    Packs(#[from] PackError),
    #[error("this is the built in sample, open a project folder to export or test it")]
    SampleProject,
    #[error("{0}")]
    BrokenPack(String),
    #[error("no pack (folder with a manifest.json) in this project")]
    NoPacks,
    #[error("pack {0} was not found in this project")]
    UnknownPack(String),
    #[error("that Minecraft install is not known, refresh the list")]
    UnknownInstall,
    #[error("the picked location is not a local file")]
    NotAFile,
    #[error("could not save settings: {0}")]
    SaveSettings(std::io::Error),
    #[error("application state is unavailable")]
    Poisoned,
}

// tauri wants errors to be Serialize, a plain message is all the UI needs
impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type CommandResult<T> = Result<T, CommandError>;

fn lock<T>(mutex: &Mutex<T>) -> CommandResult<MutexGuard<'_, T>> {
    mutex.lock().map_err(|_| CommandError::Poisoned)
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo::current()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> CommandResult<Settings> {
    Ok(lock(&state.settings)?.clone())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> CommandResult<Settings> {
    let mut settings = lock(&state.settings)?;
    settings.apply(patch);
    if let Some(path) = &state.settings_path {
        settings.save(path).map_err(CommandError::SaveSettings)?;
    }
    Ok(settings.clone())
}

/// Recent folders that still exist, newest first.
#[tauri::command]
pub fn recent_projects(state: State<'_, AppState>) -> CommandResult<Vec<RecentProject>> {
    Ok(lock(&state.recent)?
        .iter()
        .filter(|p| std::path::Path::new(&p.path).is_dir())
        .cloned()
        .collect())
}

/// Asks for a folder and opens it. None means the picker was cancelled, the current
/// workspace stays as it is then.
#[tauri::command]
pub async fn open_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<Workspace>> {
    // async command, so we're off the main thread and the blocking picker is fine here
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = picked.into_path().map_err(|_| CommandError::NotAFolder)?;
    open_dir(&state, &dir).map(Some)
}

/// Opens a folder from the recent list without asking. Only paths already in the list are
/// accepted, so this can't be used to load an arbitrary folder.
#[tauri::command]
pub async fn open_recent(state: State<'_, AppState>, path: String) -> CommandResult<Workspace> {
    if !lock(&state.recent)?.contains(&path) {
        return Err(CommandError::NotRecent);
    }
    open_dir(&state, std::path::Path::new(&path))
}

fn open_dir(state: &AppState, dir: &std::path::Path) -> CommandResult<Workspace> {
    let workspace = Workspace::open(dir)?;
    *lock(&state.workspace)? = Some(workspace.clone());
    remember(state, &workspace);
    Ok(workspace)
}

// the workspace is already open at this point, a recent list that can't be saved is only logged
fn remember(state: &AppState, workspace: &Workspace) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let Ok(mut recent) = lock(&state.recent) else {
        return;
    };
    recent.touch(&workspace.name, &workspace.root, now);
    if let Some(path) = &state.recent_path {
        if let Err(error) = recent.save(path) {
            eprintln!("could not save {}: {error}", path.display());
        }
    }
}

#[tauri::command]
pub fn close_workspace(state: State<'_, AppState>) -> CommandResult<()> {
    *lock(&state.workspace)? = None;
    Ok(())
}

#[tauri::command]
pub fn read_file(state: State<'_, AppState>, path: String) -> CommandResult<String> {
    let guard = lock(&state.workspace)?;
    let workspace = guard.as_ref().ok_or(CommandError::NoWorkspace)?;
    Ok(workspace.read(&path)?.to_owned())
}

/// Image bytes for the JSON UI preview. Goes back as a raw buffer, a JSON number array
/// would be several times bigger.
#[tauri::command]
pub fn read_image(state: State<'_, AppState>, path: String) -> CommandResult<Response> {
    let guard = lock(&state.workspace)?;
    let workspace = guard.as_ref().ok_or(CommandError::NoWorkspace)?;
    Ok(Response::new(workspace.read_image(&path)?))
}

#[tauri::command]
pub fn write_file(state: State<'_, AppState>, path: String, contents: String) -> CommandResult<()> {
    let mut guard = lock(&state.workspace)?;
    let workspace = guard.as_mut().ok_or(CommandError::NoWorkspace)?;
    workspace.write(&path, contents)?;
    Ok(())
}

#[tauri::command]
pub fn search_workspace(
    state: State<'_, AppState>,
    query: String,
) -> CommandResult<Vec<SearchMatch>> {
    if query.len() > MAX_QUERY_LEN {
        return Err(CommandError::QueryTooLong);
    }
    let guard = lock(&state.workspace)?;
    let workspace = guard.as_ref().ok_or(CommandError::NoWorkspace)?;
    Ok(workspace.search(&query, SEARCH_LIMIT))
}

/// Checks the open workspace with `unsaved` laid over the stored files, so problems follow
/// the editor as you type. Paths that aren't in the workspace are ignored.
#[tauri::command]
pub async fn check_workspace(
    state: State<'_, AppState>,
    unsaved: HashMap<String, String>,
) -> CommandResult<Vec<Problem>> {
    let files: Vec<(String, String)> = {
        let guard = lock(&state.workspace)?;
        let workspace = guard.as_ref().ok_or(CommandError::NoWorkspace)?;
        workspace
            .text_files()
            .map(|(path, text)| {
                let text = unsaved.get(path).map_or(text, String::as_str);
                (path.to_owned(), text.to_owned())
            })
            .collect()
    };
    Ok(wither_diagnostics::check(
        files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str())),
    ))
}

/// Component names, manifest vocabulary and vanilla ids for JSON completion. The editor asks
/// once and filters on its side.
#[tauri::command]
pub fn completion_catalog() -> wither_completion::Catalog {
    wither_completion::catalog()
}

/// Workspace path of the model behind an entity, attachable or geometry file, so the editor
/// only offers Blockbench when there's something to open.
#[tauri::command]
pub fn entity_model(state: State<'_, AppState>, path: String) -> CommandResult<Option<String>> {
    let guard = lock(&state.workspace)?;
    let workspace = guard.as_ref().ok_or(CommandError::NoWorkspace)?;
    Ok(workspace.model_for(&path))
}

// async so the install lookup never touches the main thread, it reads a few directories
#[tauri::command]
pub async fn blockbench_installed() -> bool {
    wither_blockbench::find().is_some()
}

/// Opens the model behind `path` in Blockbench. Goes through the saved file on disk,
/// unsaved edits in the editor don't make it over.
#[tauri::command]
pub async fn open_in_blockbench(state: State<'_, AppState>, path: String) -> CommandResult<()> {
    let file = {
        let guard = lock(&state.workspace)?;
        let workspace = guard.as_ref().ok_or(CommandError::NoWorkspace)?;
        let model = workspace
            .model_for(&path)
            .ok_or_else(|| CommandError::NoModel(path.clone()))?;
        workspace.disk_path(&model).ok_or(CommandError::NotOnDisk)?
    };
    let install = wither_blockbench::find().ok_or(BlockbenchError::NotInstalled)?;
    Ok(install.open(&file)?)
}

#[tauri::command]
pub fn open_blockbench_download() -> CommandResult<()> {
    Ok(wither_blockbench::open_download_page()?)
}

fn workspace_root(state: &AppState) -> CommandResult<std::path::PathBuf> {
    let guard = lock(&state.workspace)?;
    let root = &guard.as_ref().ok_or(CommandError::NoWorkspace)?.root;
    // hmm, the sample workspace stores its root as ~/..., so expand it before handing it to git
    Ok(match (root.strip_prefix("~/"), home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => root.into(),
    })
}

// git commands are async so a slow repo never blocks the main thread

#[tauri::command]
pub async fn git_status(state: State<'_, AppState>) -> CommandResult<Option<RepoStatus>> {
    Ok(wither_git::status(&workspace_root(&state)?)?)
}

#[tauri::command]
pub async fn git_init(state: State<'_, AppState>) -> CommandResult<Option<RepoStatus>> {
    let root = workspace_root(&state)?;
    wither_git::init(&root)?;
    Ok(wither_git::status(&root)?)
}

#[tauri::command]
pub async fn git_checkout(
    state: State<'_, AppState>,
    branch: String,
) -> CommandResult<Option<RepoStatus>> {
    let root = workspace_root(&state)?;
    wither_git::checkout(&root, &branch)?;
    Ok(wither_git::status(&root)?)
}

#[tauri::command]
pub async fn git_create_branch(
    state: State<'_, AppState>,
    name: String,
    checkout: bool,
) -> CommandResult<Option<RepoStatus>> {
    let root = workspace_root(&state)?;
    wither_git::create_branch(&root, &name, checkout)?;
    Ok(wither_git::status(&root)?)
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct TerminalDimensions {
    cols: u16,
    rows: u16,
}

impl From<TerminalDimensions> for TerminalSize {
    fn from(size: TerminalDimensions) -> Self {
        Self {
            cols: size.cols,
            rows: size.rows,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    id: u32,
    shell: String,
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(Into::into)
}

#[tauri::command]
pub fn terminal_spawn(
    state: State<'_, AppState>,
    size: TerminalDimensions,
    on_output: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
) -> CommandResult<TerminalSession> {
    let options = SpawnOptions {
        size: size.into(),
        cwd: home_dir(),
    };
    // raw bytes go straight to xterm, it deals with utf8 split across chunks on its own
    let info = state.terminals.spawn(
        options,
        move |bytes| {
            let _ = on_output.send(InvokeResponseBody::Raw(bytes));
        },
        move |code| {
            let _ = on_exit.send(code);
        },
    )?;
    Ok(TerminalSession {
        id: info.id,
        shell: info.shell,
    })
}

#[tauri::command]
pub fn terminal_write(state: State<'_, AppState>, id: u32, data: String) -> CommandResult<()> {
    Ok(state.terminals.write(id, data.as_bytes())?)
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    id: u32,
    size: TerminalDimensions,
) -> CommandResult<()> {
    Ok(state.terminals.resize(id, size.into())?)
}

#[tauri::command]
pub fn terminal_kill(state: State<'_, AppState>, id: u32) -> CommandResult<()> {
    Ok(state.terminals.kill(id)?)
}

// pack export, import and in game testing; the file system work all lives in wither-packs

/// Name and folder of the open project. The sample has no files on disk to zip or copy.
fn project_on_disk(state: &AppState) -> CommandResult<(String, std::path::PathBuf)> {
    let guard = lock(&state.workspace)?;
    let workspace = guard.as_ref().ok_or(CommandError::NoWorkspace)?;
    let root = workspace.disk_root().ok_or(CommandError::SampleProject)?;
    Ok((workspace.name.clone(), root.to_path_buf()))
}

/// Packs of the open project. A broken manifest stops everything, half an addon is worse
/// than a clear error.
fn project_packs(root: &std::path::Path) -> CommandResult<Vec<FoundPack>> {
    let found = wither_packs::find_packs(root)?;
    if let Some(error) = found.broken.first() {
        return Err(CommandError::BrokenPack(error.to_string()));
    }
    if found.packs.is_empty() {
        return Err(CommandError::NoPacks);
    }
    Ok(found.packs)
}

#[tauri::command]
pub async fn list_packs(state: State<'_, AppState>) -> CommandResult<Vec<FoundPack>> {
    let (_, root) = project_on_disk(&state)?;
    Ok(wither_packs::find_packs(&root)?.packs)
}

/// Asks where to save and writes the project as a .mcaddon, or just the pack at `pack`
/// (its relative path from list_packs) as a .mcpack. None means the dialog was cancelled.
#[tauri::command]
pub async fn export_addon(
    app: AppHandle,
    state: State<'_, AppState>,
    pack: Option<String>,
) -> CommandResult<Option<String>> {
    let (name, root) = project_on_disk(&state)?;
    let packs = project_packs(&root)?;
    let single = match &pack {
        Some(rel) => Some(
            packs
                .iter()
                .find(|p| &p.rel == rel)
                .cloned()
                .ok_or_else(|| CommandError::UnknownPack(rel.clone()))?,
        ),
        None => None,
    };
    let (ext, label, file_name) = match &single {
        Some(p) => ("mcpack", "Minecraft pack", p.folder.clone()),
        None => ("mcaddon", "Minecraft addon", name),
    };
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter(label, &[ext])
        .set_file_name(format!("{file_name}.{ext}"))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut out = picked.into_path().map_err(|_| CommandError::NotAFile)?;
    // hmm, GTK happily saves without an extension, and the game only imports by extension
    if !out.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)) {
        let mut with_ext = out.into_os_string();
        with_ext.push(format!(".{ext}"));
        out = with_ext.into();
    }
    match &single {
        Some(p) => wither_packs::export_mcpack(p, &out)?,
        None => wither_packs::export_mcaddon(&packs, &out)?,
    }
    Ok(Some(out.display().to_string()))
}

/// Asks for a .mcaddon / .mcpack / .zip and a folder, unpacks it there and opens the result
/// as the workspace. A non empty folder gets a new subfolder named after the archive.
#[tauri::command]
pub async fn import_archive(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<Workspace>> {
    let Some(archive) = app
        .dialog()
        .file()
        .add_filter("Minecraft addon or pack", &["mcaddon", "mcpack", "zip"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let archive = archive.into_path().map_err(|_| CommandError::NotAFile)?;
    let Some(location) = app
        .dialog()
        .file()
        .set_title("Where should the project go?")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let location = location.into_path().map_err(|_| CommandError::NotAFolder)?;
    let target = wither_packs::import_target(&archive, &location);
    wither_packs::import(&archive, &target)?;
    open_dir(&state, &target).map(Some)
}

/// Detected installs, with the folder from Settings first when there is one.
fn known_installs(state: &AppState) -> CommandResult<Vec<Install>> {
    let manual = lock(&state.settings)?.minecraft_install.clone();
    let mut installs = Vec::new();
    if !manual.is_empty() && std::path::Path::new(&manual).is_dir() {
        installs.push(Install::manual(std::path::Path::new(&manual)));
    }
    for install in wither_packs::detect() {
        if !installs.iter().any(|i| i.id == install.id) {
            installs.push(install);
        }
    }
    Ok(installs)
}

// only ids we handed out ourselves get through, same idea as open_recent
fn find_install(state: &AppState, id: &str) -> CommandResult<Install> {
    known_installs(state)?
        .into_iter()
        .find(|i| i.id == id)
        .ok_or(CommandError::UnknownInstall)
}

#[tauri::command]
pub async fn minecraft_installs(state: State<'_, AppState>) -> CommandResult<Vec<Install>> {
    known_installs(&state)
}

#[tauri::command]
pub async fn list_worlds(state: State<'_, AppState>, install: String) -> CommandResult<Vec<World>> {
    let install = find_install(&state, &install)?;
    Ok(wither_packs::list_worlds(&install)?)
}

#[tauri::command]
pub async fn world_icon(
    state: State<'_, AppState>,
    install: String,
    world: String,
) -> CommandResult<Response> {
    let install = find_install(&state, &install)?;
    Ok(Response::new(wither_packs::world_icon(&install, &world)?))
}

/// Whether the game is running, None when this OS can't tell.
#[tauri::command]
pub async fn game_running() -> Option<bool> {
    wither_packs::is_running()
}

/// Copies every pack of the project into the install's development folders, attaches them
/// to `world` if one is given, then starts the game. A failed launch is reported, not an
/// error, the packs are already in place by then.
#[tauri::command]
pub async fn test_in_game(
    state: State<'_, AppState>,
    install: String,
    world: Option<String>,
) -> CommandResult<TestReport> {
    let (name, root) = project_on_disk(&state)?;
    let target = find_install(&state, &install)?;
    let found = wither_packs::find_packs(&root)?;
    if found.packs.is_empty() && found.broken.is_empty() {
        return Err(CommandError::NoPacks);
    }

    let mut report = TestReport {
        skipped: found.broken.iter().map(ToString::to_string).collect(),
        ..TestReport::default()
    };
    let mut copied = Vec::new();
    for pack in &found.packs {
        match wither_packs::install_pack(&target, pack, &name, &root)? {
            Installed::Copied { path, warnings } => {
                report
                    .installed
                    .push(format!("{} -> {}", pack.folder, path.display()));
                report.warnings.extend(warnings);
                copied.push(&pack.manifest);
            }
            Installed::Skipped(reason) => report.skipped.push(reason),
        }
    }

    if let Some(world) = &world {
        wither_packs::attach(&target, world, &copied)?;
        let world_name = wither_packs::list_worlds(&target)?
            .into_iter()
            .find(|w| &w.id == world)
            .map_or_else(|| world.clone(), |w| w.name);
        report.attached_to = Some(world_name);
    }

    let command = {
        let mut settings = lock(&state.settings)?;
        settings.last_test_target = Some(TestTarget {
            install: target.id.clone(),
            world: world.clone(),
        });
        if let Some(path) = &state.settings_path {
            if let Err(error) = settings.save(path) {
                report
                    .warnings
                    .push(format!("could not remember this target: {error}"));
            }
        }
        settings.launch_command.clone()
    };
    match wither_packs::launch(Some(&command)) {
        Ok(()) => report.launched = true,
        Err(error) => report.warnings.push(error.to_string()),
    }
    Ok(report)
}
