use std::path::PathBuf;
use std::sync::Mutex;

use wither_core::Settings;
use wither_terminal::TerminalManager;
use wither_workspace::{RecentProjects, Workspace};

#[derive(Default)]
pub struct AppState {
    pub settings: Mutex<Settings>,
    /// Where settings get saved, None when the config dir couldn't be resolved and
    /// settings only live for this session.
    pub settings_path: Option<PathBuf>,
    pub workspace: Mutex<Option<Workspace>>,
    pub recent: Mutex<RecentProjects>,
    /// Where the recent list gets saved, None works like settings_path.
    pub recent_path: Option<PathBuf>,
    pub terminals: TerminalManager,
}

impl AppState {
    /// Loads saved settings and the recent list from the config dir. A broken file shouldn't
    /// stop the app from starting, so that falls back to defaults and gets overwritten on the
    /// next change.
    pub fn load(config_dir: Option<PathBuf>) -> Self {
        let settings_path = config_dir.as_ref().map(|dir| dir.join("settings.json"));
        let recent_path = config_dir.map(|dir| dir.join("recent.json"));
        let settings = settings_path
            .as_deref()
            .map(|path| {
                Settings::load(path).unwrap_or_else(|error| {
                    eprintln!("could not read {}: {error}", path.display());
                    Settings::default()
                })
            })
            .unwrap_or_default();
        let recent = recent_path
            .as_deref()
            .map(|path| {
                RecentProjects::load(path).unwrap_or_else(|error| {
                    eprintln!("could not read {}: {error}", path.display());
                    RecentProjects::default()
                })
            })
            .unwrap_or_default();
        Self {
            settings: Mutex::new(settings),
            settings_path,
            recent: Mutex::new(recent),
            recent_path,
            ..Default::default()
        }
    }
}
