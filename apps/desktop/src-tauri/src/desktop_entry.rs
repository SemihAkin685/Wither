//! Linux desktop entry fallback so the taskbar shows the real icon.
//!
//! On Wayland the compositor ignores the GTK window icon and looks the window's
//! app_id up as `<app_id>.desktop` instead. Packaged builds (deb, rpm) ship that
//! file, but `tauri dev` or a bare binary from target/ doesn't, so KDE and GNOME
//! fall back to a generic letter icon.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

// yeah, without enable_gtk_app_id GTK uses the program name, so this is the binary name
const APP_ID: &str = "wither";
const MARKER: &str = "X-Wither-Generated=true";
const ICON: &[u8] = include_bytes!("../icons/icon.png");

/// Writes a hidden desktop entry plus icon into the user's data dir when no
/// installed entry exists. Failures are only logged, a missing icon isn't worth
/// blocking startup over.
pub fn ensure() {
    if let Err(err) = try_ensure() {
        eprintln!("wither: could not install desktop entry: {err}");
    }
}

fn try_ensure() -> std::io::Result<()> {
    let Some(data_home) = data_home() else {
        return Ok(());
    };
    let file_name = format!("{APP_ID}.desktop");
    let entry_path = data_home.join("applications").join(&file_name);

    // a real install wins, we only manage the entry we wrote ourselves
    if system_entry_exists(&file_name) {
        return Ok(());
    }
    if let Ok(existing) = fs::read_to_string(&entry_path) {
        if !existing.contains(MARKER) {
            return Ok(());
        }
    }

    let icon_path = data_home
        .join("icons/hicolor/512x512/apps")
        .join(format!("{APP_ID}.png"));
    write_if_changed(&icon_path, ICON)?;

    let exe = env::current_exe()?;
    let entry = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Wither\n\
         Comment=The IDE for Minecraft Bedrock addons\n\
         Exec={}\n\
         Icon={}\n\
         Terminal=false\n\
         Categories=Development;IDE;\n\
         StartupWMClass={APP_ID}\n\
         NoDisplay=true\n\
         {MARKER}\n",
        quote_exec(&exe),
        icon_path.display(),
    );
    write_if_changed(&entry_path, entry.as_bytes())
}

fn data_home() -> Option<PathBuf> {
    env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

fn system_entry_exists(file_name: &str) -> bool {
    let dirs = env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    dirs.split(':')
        .filter(|d| !d.is_empty())
        .any(|d| Path::new(d).join("applications").join(file_name).is_file())
}

fn write_if_changed(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if fs::read(path).is_ok_and(|current| current == contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)
}

/// Quotes the executable for an Exec key. The spec wants `"`, `` ` ``, `$` and `\`
/// escaped inside quotes, and then the whole value goes through the string escape
/// pass again, hence the doubled backslash.
fn quote_exec(exe: &Path) -> String {
    let mut out = String::from("\"");
    for c in exe.to_string_lossy().chars() {
        match c {
            '"' | '`' | '$' => {
                out.push_str("\\\\");
                out.push(c);
            }
            '\\' => out.push_str("\\\\\\\\"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_plain_path() {
        assert_eq!(
            quote_exec(Path::new("/home/me/Masaüstü/wither")),
            "\"/home/me/Masaüstü/wither\""
        );
    }

    #[test]
    fn escapes_reserved_chars() {
        assert_eq!(quote_exec(Path::new("/a$b")), "\"/a\\\\$b\"");
    }
}
