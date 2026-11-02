//! Finds a local Blockbench and opens models in it. Blockbench takes files as plain
//! arguments, so this is just looking in the usual install spots and spawning it.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const DOWNLOAD_URL: &str = "https://www.blockbench.net/downloads";

const FLATPAK_ID: &str = "net.blockbench.Blockbench";

#[derive(Debug, thiserror::Error)]
pub enum BlockbenchError {
    #[error("Blockbench is not installed")]
    NotInstalled,
    #[error("could not start {0}: {1}")]
    Spawn(String, std::io::Error),
}

pub type Result<T> = std::result::Result<T, BlockbenchError>;

/// A Blockbench we know how to start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Install {
    Executable(PathBuf),
    Flatpak,
    /// A macOS .app bundle, started through `open -a`.
    App(PathBuf),
}

impl Install {
    /// Opens `file` in Blockbench without waiting for it to exit.
    pub fn open(&self, file: &Path) -> Result<()> {
        let mut command = match self {
            Self::Executable(exe) => {
                let mut c = Command::new(exe);
                c.arg(file);
                c
            }
            Self::Flatpak => {
                // file forwarding hands the sandbox a portal path, so files outside home work too
                let mut c = Command::new("flatpak");
                c.args(["run", "--file-forwarding", FLATPAK_ID, "@@"])
                    .arg(file)
                    .arg("@@");
                c
            }
            Self::App(app) => {
                let mut c = Command::new("open");
                c.arg("-a").arg(app).arg(file);
                c
            }
        };
        spawn_detached(&mut command)
    }
}

/// Looks for Blockbench in the places its installers and package managers use.
pub fn find() -> Option<Install> {
    find_in(&Env::from_process())
}

/// Opens the Blockbench download page in the default browser.
pub fn open_download_page() -> Result<()> {
    let opener = if cfg!(target_os = "windows") {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    spawn_detached(Command::new(opener).arg(DOWNLOAD_URL))
}

fn spawn_detached(command: &mut Command) -> Result<()> {
    let program = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => BlockbenchError::NotInstalled,
            _ => BlockbenchError::Spawn(program, error),
        })?;
    // hmm, nobody cares about the exit code, but reaping it keeps a zombie from hanging around
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// The bits of the environment detection reads, split out so tests can fake them.
#[derive(Debug, Default)]
struct Env {
    path: Option<OsString>,
    home: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
    program_files: Option<PathBuf>,
}

impl Env {
    fn from_process() -> Self {
        let var = |name| std::env::var_os(name).map(PathBuf::from);
        Self {
            path: std::env::var_os("PATH"),
            home: var("HOME").or_else(|| var("USERPROFILE")),
            local_app_data: var("LOCALAPPDATA"),
            program_files: var("ProgramFiles"),
        }
    }
}

fn find_in(env: &Env) -> Option<Install> {
    if cfg!(target_os = "macos") {
        let mut apps = vec![PathBuf::from("/Applications/Blockbench.app")];
        apps.extend(
            env.home
                .iter()
                .map(|h| h.join("Applications/Blockbench.app")),
        );
        if let Some(app) = apps.into_iter().find(|a| a.is_dir()) {
            return Some(Install::App(app));
        }
    }
    if cfg!(target_os = "windows") {
        let installed = [
            env.local_app_data
                .as_ref()
                .map(|d| d.join("Programs/Blockbench/Blockbench.exe")),
            env.program_files
                .as_ref()
                .map(|d| d.join("Blockbench/Blockbench.exe")),
        ];
        if let Some(exe) = installed.into_iter().flatten().find(|p| p.is_file()) {
            return Some(Install::Executable(exe));
        }
    }
    let exe_name = if cfg!(target_os = "windows") {
        "blockbench.exe"
    } else {
        "blockbench"
    };
    if let Some(exe) = env.path.as_ref().and_then(|path| on_path(path, exe_name)) {
        return Some(Install::Executable(exe));
    }
    if cfg!(target_os = "linux") {
        return linux_install(env);
    }
    None
}

fn on_path(path: &OsString, name: &str) -> Option<PathBuf> {
    std::env::split_paths(path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn linux_install(env: &Env) -> Option<Install> {
    let mut flatpak_dirs = vec![PathBuf::from("/var/lib/flatpak/app").join(FLATPAK_ID)];
    flatpak_dirs.extend(
        env.home
            .iter()
            .map(|h| h.join(".local/share/flatpak/app").join(FLATPAK_ID)),
    );
    if flatpak_dirs.iter().any(|d| d.is_dir()) {
        return Some(Install::Flatpak);
    }
    // AppImages usually sit in one of these, named like Blockbench_4.12.0.AppImage
    let home = env.home.as_ref()?;
    ["Applications", ".local/bin", "Downloads"]
        .iter()
        .filter_map(|dir| std::fs::read_dir(home.join(dir)).ok())
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .find(|p| {
            p.is_file()
                && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                    let n = n.to_ascii_lowercase();
                    n.starts_with("blockbench") && n.ends_with(".appimage")
                })
        })
        .map(Install::Executable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("wither-blockbench-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_blockbench_on_path() {
        let dir = scratch("path");
        let name = if cfg!(target_os = "windows") {
            "blockbench.exe"
        } else {
            "blockbench"
        };
        std::fs::write(dir.join(name), "").unwrap();
        let env = Env {
            path: Some(std::env::join_paths([dir.clone()]).unwrap()),
            ..Env::default()
        };
        // a real install on the machine running the tests may win on macOS and Windows
        if cfg!(target_os = "linux") {
            assert_eq!(find_in(&env), Some(Install::Executable(dir.join(name))));
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn finds_an_appimage_in_home() {
        let home = scratch("home");
        std::fs::create_dir_all(home.join("Applications")).unwrap();
        let image = home.join("Applications/Blockbench_4.12.0.AppImage");
        std::fs::write(&image, "").unwrap();
        let env = Env {
            path: Some(OsString::new()),
            home: Some(home.clone()),
            ..Env::default()
        };
        // a system wide flatpak takes priority, only check the AppImage when there isn't one
        if !PathBuf::from("/var/lib/flatpak/app")
            .join(FLATPAK_ID)
            .is_dir()
        {
            assert_eq!(find_in(&env), Some(Install::Executable(image)));
        }
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn empty_environment_finds_nothing_on_linux() {
        if cfg!(target_os = "linux")
            && !PathBuf::from("/var/lib/flatpak/app")
                .join(FLATPAK_ID)
                .is_dir()
        {
            assert_eq!(
                find_in(&Env {
                    path: Some(OsString::new()),
                    ..Env::default()
                }),
                None
            );
        }
    }
}
