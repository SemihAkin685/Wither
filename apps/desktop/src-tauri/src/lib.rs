mod commands;
mod state;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::update_settings,
            commands::recent_projects,
            commands::open_workspace,
            commands::close_workspace,
            commands::read_file,
            commands::write_file,
            commands::search_workspace,
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wither");
}
