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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppState::load(app.path().app_config_dir().ok()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::update_settings,
            commands::recent_projects,
            commands::open_workspace,
            commands::open_recent,
            commands::close_workspace,
            commands::read_file,
            commands::read_image,
            commands::write_file,
            commands::search_workspace,
            commands::check_workspace,
            commands::completion_catalog,
            commands::entity_model,
            commands::blockbench_installed,
            commands::open_in_blockbench,
            commands::open_blockbench_download,
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
