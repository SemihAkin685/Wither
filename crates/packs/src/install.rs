use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::discover::FoundPack;
use crate::fsutil::{copy_dir, sanitize, write_atomic};
use crate::manifest::{Manifest, PackKind};
use crate::{PackError, Result};

/// Dropped into every folder Wither installs, so it only ever deletes its own copies.
const MARKER: &str = ".wither-install";

/// One Minecraft data folder (a com.mojang). On GDK Windows builds packs and worlds live in
/// different com.mojang folders, everywhere else both roots are the same.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Install {
    /// Stable id the UI hands back, the worlds folder as a string.
    pub id: String,
    pub label: String,
    pub packs_root: PathBuf,
    pub worlds_root: PathBuf,
}

impl Install {
    fn new(label: impl Into<String>, packs_root: PathBuf, worlds_root: PathBuf) -> Self {
        Self {
            id: worlds_root.display().to_string(),
            label: label.into(),
            packs_root,
            worlds_root,
        }
    }

    /// A com.mojang folder the user picked in Settings.
    pub fn manual(path: &Path) -> Self {
        Self::new("Custom folder", path.to_path_buf(), path.to_path_buf())
    }
}

/// Finds the Minecraft installs on this machine. Only folders that exist are returned.
pub fn detect() -> Vec<Install> {
    let env = Env::from_process();
    if cfg!(target_os = "windows") {
        windows_installs(&env)
    } else if cfg!(target_os = "linux") {
        linux_installs(&env)
    } else {
        Vec::new()
    }
}

/// The bits of the environment detection reads, split out so tests can fake them.
#[derive(Debug, Default)]
struct Env {
    home: Option<PathBuf>,
    xdg_data_home: Option<PathBuf>,
    app_data: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
}

impl Env {
    fn from_process() -> Self {
        let var = |name| std::env::var_os(name).map(PathBuf::from);
        Self {
            home: var("HOME"),
            xdg_data_home: var("XDG_DATA_HOME"),
            app_data: var("APPDATA"),
            local_app_data: var("LOCALAPPDATA"),
        }
    }
}

fn linux_installs(env: &Env) -> Vec<Install> {
    let data_home = env
        .xdg_data_home
        .clone()
        .or_else(|| env.home.as_ref().map(|h| h.join(".local/share")));
    let candidates = [
        data_home.map(|d| ("mcpelauncher", d.join("mcpelauncher/games/com.mojang"))),
        env.home.as_ref().map(|h| {
            (
                "mcpelauncher (Flatpak)",
                h.join(".var/app/io.mrarm.mcpelauncher/data/mcpelauncher/games/com.mojang"),
            )
        }),
    ];
    candidates
        .into_iter()
        .flatten()
        .filter(|(_, dir)| dir.is_dir())
        .map(|(label, dir)| Install::new(label, dir.clone(), dir))
        .collect()
}

fn windows_installs(env: &Env) -> Vec<Install> {
    let mut out = Vec::new();
    if let Some(app_data) = &env.app_data {
        // GDK builds (1.21.120+): packs in Users/Shared, worlds per signed in user
        let users = app_data.join("Minecraft Bedrock").join("Users");
        let shared = users.join("Shared").join("games").join("com.mojang");
        let mut user_dirs: Vec<_> = fs::read_dir(&users)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name() != "Shared")
            .map(|e| (e.file_name(), e.path().join("games").join("com.mojang")))
            .filter(|(_, dir)| dir.join("minecraftWorlds").is_dir())
            .collect();
        user_dirs.sort();
        for (name, dir) in user_dirs {
            let packs = if shared.is_dir() {
                shared.clone()
            } else {
                dir.clone()
            };
            let label = format!("Minecraft ({})", name.to_string_lossy());
            out.push(Install::new(label, packs, dir));
        }
        if out.is_empty() && shared.is_dir() {
            out.push(Install::new("Minecraft", shared.clone(), shared));
        }
    }
    if let Some(local) = &env.local_app_data {
        let uwp = local
            .join("Packages")
            .join("Microsoft.MinecraftUWP_8wekyb3d8bbwe")
            .join("LocalState")
            .join("games")
            .join("com.mojang");
        if uwp.is_dir() {
            out.push(Install::new("Minecraft (UWP)", uwp.clone(), uwp));
        }
    }
    out
}

#[derive(Debug, Serialize, Deserialize)]
struct Marker {
    uuid: String,
    project: String,
}

/// Result of installing one pack. Warnings are things the user should know but that
/// didn't stop the install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Installed {
    Copied {
        path: PathBuf,
        warnings: Vec<String>,
    },
    Skipped(String),
}

/// Copies a pack into the install's development_*_packs folder as
/// `<project>_<pack folder>`, replacing older Wither copies of the same pack.
pub fn install_pack(
    install: &Install,
    pack: &FoundPack,
    project_name: &str,
    project_root: &Path,
) -> Result<Installed> {
    let kind_dir = match pack.manifest.kind {
        PackKind::Behavior => "development_behavior_packs",
        PackKind::Resource => "development_resource_packs",
        PackKind::Skin | PackKind::Unknown => {
            return Ok(Installed::Skipped(format!(
                "{} is not a behavior or resource pack",
                pack.folder
            )))
        }
    };
    let parent = install.packs_root.join(kind_dir);
    fs::create_dir_all(&parent).map_err(|e| PackError::io(&parent, e))?;
    let name = sanitize(&format!("{project_name}_{}", pack.folder));
    let target = parent.join(&name);
    let uuid = &pack.manifest.uuid;

    let mut warnings = Vec::new();
    for entry in fs::read_dir(&parent).map_err(|e| PackError::io(&parent, e))? {
        let entry = entry.map_err(|e| PackError::io(&parent, e))?;
        if !entry.file_type().is_ok_and(|t| t.is_dir()) || entry.file_name() == name.as_str() {
            continue;
        }
        let dir = entry.path();
        match read_marker(&dir) {
            Some(marker) if marker.uuid.eq_ignore_ascii_case(uuid) => {
                fs::remove_dir_all(&dir).map_err(|e| PackError::io(&dir, e))?;
            }
            Some(_) => {}
            None => {
                let same = Manifest::load(&dir.join("manifest.json"))
                    .is_ok_and(|m| m.uuid.eq_ignore_ascii_case(uuid));
                if same {
                    warnings.push(format!(
                        "{} has the same uuid as {}, the game may load that one instead",
                        dir.display(),
                        pack.folder
                    ));
                }
            }
        }
    }

    if target.exists() {
        if read_marker(&target).is_none() {
            return Ok(Installed::Skipped(format!(
                "{} already exists and wasn't installed by Wither, left it alone",
                target.display()
            )));
        }
        fs::remove_dir_all(&target).map_err(|e| PackError::io(&target, e))?;
    }
    copy_dir(&pack.dir, &target)?;
    let marker = Marker {
        uuid: uuid.clone(),
        project: project_root.display().to_string(),
    };
    let json = serde_json::to_vec_pretty(&marker).unwrap_or_default();
    write_atomic(&target.join(MARKER), &json)?;
    Ok(Installed::Copied {
        path: target,
        warnings,
    })
}

fn read_marker(dir: &Path) -> Option<Marker> {
    let text = fs::read_to_string(dir.join(MARKER)).ok()?;
    serde_json::from_str(&text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("wither-install-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn linux_finds_native_and_flatpak() {
        let home = temp("linux");
        let native = home.join(".local/share/mcpelauncher/games/com.mojang");
        let flatpak =
            home.join(".var/app/io.mrarm.mcpelauncher/data/mcpelauncher/games/com.mojang");
        fs::create_dir_all(&native).unwrap();
        fs::create_dir_all(&flatpak).unwrap();
        let env = Env {
            home: Some(home.clone()),
            ..Env::default()
        };
        let found = linux_installs(&env);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].packs_root, native);
        assert_eq!(found[1].worlds_root, flatpak);
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn windows_gdk_splits_packs_and_worlds() {
        let app_data = temp("gdk");
        let users = app_data.join("Minecraft Bedrock/Users");
        let shared = users.join("Shared/games/com.mojang");
        let user = users.join("1234/games/com.mojang");
        fs::create_dir_all(&shared).unwrap();
        fs::create_dir_all(user.join("minecraftWorlds")).unwrap();
        let env = Env {
            app_data: Some(app_data.clone()),
            ..Env::default()
        };
        let found = windows_installs(&env);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].packs_root, shared);
        assert_eq!(found[0].worlds_root, user);
        assert_eq!(found[0].label, "Minecraft (1234)");
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn nothing_found_without_folders() {
        let env = Env {
            home: Some(PathBuf::from("/definitely/not/here")),
            ..Env::default()
        };
        assert!(linux_installs(&env).is_empty());
        assert!(windows_installs(&env).is_empty());
    }
}
