use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize, Serializer};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;
use wither_core::{AppInfo, Settings, SettingsPatch};
use wither_diagnostics::Problem;
use wither_git::{GitError, RepoStatus};
use wither_terminal::{SpawnOptions, TerminalError, TerminalSize};
use wither_workspace::{sample, RecentProject, SearchMatch, Workspace, WorkspaceError};

use crate::state::AppState;

const SEARCH_LIMIT: usize = 500;
const MAX_QUERY_LEN: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("no workspace is open")]
    NoWorkspace,
    #[error("search query is too long")]
    QueryTooLong,
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error(transparent)]
    Terminal(#[from] TerminalError),
    #[error(transparent)]
    Git(#[from] GitError),
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
    Ok(settings.clone())
}

#[tauri::command]
pub fn recent_projects() -> Vec<RecentProject> {
    wither_workspace::recent::sample_recent_projects()
}

#[tauri::command]
pub fn open_workspace(state: State<'_, AppState>) -> CommandResult<Workspace> {
    let workspace = sample::bedrock_workspace();
    *lock(&state.workspace)? = Some(workspace.clone());
    Ok(workspace)
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
