mod commands;
#[cfg(target_os = "linux")]
mod desktop_entry;
mod state;

use state::AppState;
use tauri::Manager;

pub fn run() {
    #[cfg(target_os = "linux")]
    desktop_entry::ensure();

    tauri::Builder::default()
        .setup(|app| {
            let settings_path = app
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join("settings.json"));
            app.manage(AppState::load(settings_path));
            Ok(())
        })
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
            commands::check_workspace,
            commands::completion_catalog,
            commands::git_status,
            commands::git_init,
            commands::git_checkout,
            commands::git_create_branch,
            commands::terminal_spawn,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wither");
}
