use std::path::PathBuf;
use std::sync::Mutex;

use wither_core::Settings;
use wither_terminal::TerminalManager;
use wither_workspace::Workspace;

#[derive(Default)]
pub struct AppState {
    pub settings: Mutex<Settings>,
    /// Where settings get saved, None when the config dir couldn't be resolved and
    /// settings only live for this session.
    pub settings_path: Option<PathBuf>,
    pub workspace: Mutex<Option<Workspace>>,
    pub terminals: TerminalManager,
}

impl AppState {
    /// Loads saved settings from `settings_path`. A broken file shouldn't stop the app from
    /// starting, so that falls back to defaults and gets overwritten on the next change.
    pub fn load(settings_path: Option<PathBuf>) -> Self {
        let settings = settings_path
            .as_deref()
            .map(|path| {
                Settings::load(path).unwrap_or_else(|error| {
                    eprintln!("could not read {}: {error}", path.display());
                    Settings::default()
                })
            })
            .unwrap_or_default();
        Self {
            settings: Mutex::new(settings),
            settings_path,
            ..Default::default()
        }
    }
}
