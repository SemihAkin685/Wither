use std::process::{Command, Stdio};

use crate::{PackError, Result};

const FLATPAK_ID: &str = "io.mrarm.mcpelauncher";

/// Starts the game without waiting for it. `command` overrides detection, it's split on
/// whitespace, so paths with spaces need a wrapper script.
pub fn launch(command: Option<&str>) -> Result<()> {
    if let Some(command) = command.map(str::trim).filter(|c| !c.is_empty()) {
        let mut parts = command.split_whitespace();
        let program = parts.next().unwrap_or_default();
        let mut cmd = Command::new(program);
        cmd.args(parts);
        return spawn_detached(&mut cmd);
    }
    if cfg!(target_os = "windows") {
        // the minecraft: protocol works for both the GDK and the old store build
        return spawn_detached(Command::new("explorer").arg("minecraft:"));
    }
    if cfg!(target_os = "linux") {
        if flatpak_installed() {
            return spawn_detached(Command::new("flatpak").args(["run", FLATPAK_ID]));
        }
        return spawn_detached(&mut Command::new("mcpelauncher-ui-qt"));
    }
    Err(PackError::LauncherNotFound)
}

/// Whether the game is running right now. None when this platform can't tell.
pub fn is_running() -> Option<bool> {
    if cfg!(target_os = "linux") {
        let procs = std::fs::read_dir("/proc").ok()?;
        // comm is cut at 15 chars, so mcpelauncher-client shows up as mcpelauncher-cl
        return Some(procs.filter_map(|e| e.ok()).any(|e| {
            std::fs::read_to_string(e.path().join("comm"))
                .is_ok_and(|c| c.trim_end().starts_with("mcpelauncher-cl"))
        }));
    }
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("tasklist");
        cmd.args(["/FI", "IMAGENAME eq Minecraft.Windows.exe", "/NH"]);
        hide_console(&mut cmd);
        let output = cmd.output().ok()?;
        return Some(String::from_utf8_lossy(&output.stdout).contains("Minecraft.Windows.exe"));
    }
    None
}

fn flatpak_installed() -> bool {
    Command::new("flatpak")
        .args(["info", FLATPAK_ID])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW, otherwise a console flashes up every time the test view checks
    cmd.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

fn spawn_detached(command: &mut Command) -> Result<()> {
    let program = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => PackError::LauncherNotFound,
            _ => PackError::Launch(program, error),
        })?;
    // nobody waits on the game, but reaping it keeps a zombie from hanging around
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
