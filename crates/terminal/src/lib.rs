use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

const READ_BUFFER: usize = 16 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("terminal session {0} does not exist")]
    NotFound(u32),
    #[error("pty error: {0}")]
    Pty(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, TerminalError>;

fn pty_err(error: impl std::fmt::Display) -> TerminalError {
    TerminalError::Pty(error.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

impl TerminalSize {
    fn to_pty(self) -> PtySize {
        PtySize {
            cols: self.cols.max(2),
            rows: self.rows.max(1),
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SpawnOptions {
    pub size: TerminalSize,
    pub cwd: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    pub id: u32,
    pub shell: String,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // yeah, the shell may already be gone here, so the error is expected
        let _ = self.child.kill();
    }
}

type Sessions = Arc<Mutex<HashMap<u32, Session>>>;

/// Owns every running shell. Dropping the manager kills them all, so nothing
/// outlives the app.
#[derive(Default)]
pub struct TerminalManager {
    sessions: Sessions,
    next_id: AtomicU32,
}

fn lock(sessions: &Sessions) -> MutexGuard<'_, HashMap<u32, Session>> {
    // hmm, a poisoned map only means some other call panicked, the data is still fine
    sessions
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl TerminalManager {
    /// Starts the user's login shell in a new pty. Output is pushed to `on_output`
    /// from a background thread, and `on_exit` fires once with the exit code
    /// (None when the session was killed).
    pub fn spawn(
        &self,
        options: SpawnOptions,
        mut on_output: impl FnMut(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<SessionInfo> {
        let pair = native_pty_system()
            .openpty(options.size.to_pty())
            .map_err(pty_err)?;

        let mut command = CommandBuilder::new_default_prog();
        let shell = command.get_shell();
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "Wither");
        if let Some(cwd) = options.cwd.filter(|dir| dir.is_dir()) {
            command.cwd(cwd);
        }

        let child = pair.slave.spawn_command(command).map_err(pty_err)?;
        // ok so the slave has to be dropped here, otherwise the reader never sees EOF
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(pty_err)?;
        let writer = pair.master.take_writer().map_err(pty_err)?;

        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        lock(&self.sessions).insert(
            id,
            Session {
                master: pair.master,
                writer,
                child,
            },
        );

        let sessions = Arc::clone(&self.sessions);
        thread::Builder::new()
            .name(format!("wither-pty-{id}"))
            .spawn(move || {
                let mut buffer = vec![0u8; READ_BUFFER];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => on_output(buffer[..n].to_vec()),
                    }
                }
                let session = lock(&sessions).remove(&id);
                let code =
                    session.and_then(|mut s| s.child.wait().ok().map(|status| status.exit_code()));
                on_exit(code);
            })?;

        Ok(SessionInfo { id, shell })
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<()> {
        let mut sessions = lock(&self.sessions);
        let session = sessions.get_mut(&id).ok_or(TerminalError::NotFound(id))?;
        session.writer.write_all(data)?;
        session.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: u32, size: TerminalSize) -> Result<()> {
        let sessions = lock(&self.sessions);
        let session = sessions.get(&id).ok_or(TerminalError::NotFound(id))?;
        session.master.resize(size.to_pty()).map_err(pty_err)
    }

    pub fn kill(&self, id: u32) -> Result<()> {
        lock(&self.sessions)
            .remove(&id)
            .map(drop)
            .ok_or(TerminalError::NotFound(id))
    }
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        // reader threads hold their own Arc to the map, so clearing it is what actually kills the shells
        lock(&self.sessions).clear();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn options() -> SpawnOptions {
        SpawnOptions {
            size: TerminalSize { cols: 80, rows: 24 },
            cwd: None,
        }
    }

    #[test]
    fn shell_echoes_and_exits() {
        let manager = TerminalManager::default();
        let (out_tx, out_rx) = mpsc::channel();
        let (exit_tx, exit_rx) = mpsc::channel();
        let info = manager
            .spawn(
                options(),
                move |bytes| {
                    let _ = out_tx.send(bytes);
                },
                move |code| {
                    let _ = exit_tx.send(code);
                },
            )
            .unwrap();

        manager
            .write(info.id, b"echo wither-$((40+2))\nexit 3\n")
            .unwrap();

        let mut output = Vec::new();
        while let Ok(chunk) = out_rx.recv_timeout(Duration::from_secs(5)) {
            output.extend(chunk);
            if String::from_utf8_lossy(&output).contains("wither-42") {
                break;
            }
        }
        assert!(String::from_utf8_lossy(&output).contains("wither-42"));
        assert_eq!(
            exit_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            Some(3)
        );
        assert!(matches!(
            manager.write(info.id, b"x"),
            Err(TerminalError::NotFound(_))
        ));
    }

    #[test]
    fn kill_removes_session() {
        let manager = TerminalManager::default();
        let (exit_tx, exit_rx) = mpsc::channel();
        let info = manager
            .spawn(
                options(),
                |_| {},
                move |code| {
                    let _ = exit_tx.send(code);
                },
            )
            .unwrap();
        manager
            .resize(
                info.id,
                TerminalSize {
                    cols: 120,
                    rows: 40,
                },
            )
            .unwrap();
        manager.kill(info.id).unwrap();
        assert_eq!(exit_rx.recv_timeout(Duration::from_secs(5)).unwrap(), None);
        assert!(manager.kill(info.id).is_err());
    }
}
