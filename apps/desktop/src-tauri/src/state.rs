use std::sync::Mutex;

use wither_core::Settings;
use wither_terminal::TerminalManager;
use wither_workspace::Workspace;

#[derive(Default)]
pub struct AppState {
    pub settings: Mutex<Settings>,
    pub workspace: Mutex<Option<Workspace>>,
    pub terminals: TerminalManager,
}
