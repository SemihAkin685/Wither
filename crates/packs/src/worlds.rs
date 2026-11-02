use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::{json, Value};

use crate::fsutil::write_atomic;
use crate::install::Install;
use crate::manifest::{Manifest, PackKind};
use crate::{PackError, Result};

const WORLDS: &str = "minecraftWorlds";
const ICON: &str = "world_icon.jpeg";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    /// Folder name under minecraftWorlds, the game's own random id.
    pub id: String,
    pub name: String,
    /// Unix seconds, from level.dat's modification time.
    pub last_played: u64,
    pub has_icon: bool,
}

/// Worlds of an install, most recently played first. No worlds folder just means none yet.
pub fn list_worlds(install: &Install) -> Result<Vec<World>> {
    let root = install.worlds_root.join(WORLDS);
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(PackError::io(&root, error)),
    };
    let mut worlds: Vec<World> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let dir = e.path();
            let level = fs::metadata(dir.join("level.dat")).ok()?;
            let id = e.file_name().to_string_lossy().into_owned();
            let name = fs::read_to_string(dir.join("levelname.txt"))
                .map(|n| n.trim().to_owned())
                .ok()
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| id.clone());
            let last_played = level
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            Some(World {
                has_icon: dir.join(ICON).is_file(),
                id,
                name,
                last_played,
            })
        })
        .collect();
    worlds.sort_by(|a, b| b.last_played.cmp(&a.last_played).then(a.name.cmp(&b.name)));
    Ok(worlds)
}

/// The world's thumbnail as raw jpeg bytes.
pub fn world_icon(install: &Install, id: &str) -> Result<Vec<u8>> {
    let path = world_dir(install, id)?.join(ICON);
    fs::read(&path).map_err(|e| PackError::io(&path, e))
}

/// Adds the packs to a world's world_behavior_packs.json / world_resource_packs.json.
/// A pack already listed just gets its version bumped, nothing else in the file moves.
pub fn attach(install: &Install, id: &str, packs: &[&Manifest]) -> Result<()> {
    let dir = world_dir(install, id)?;
    for (kind, file) in [
        (PackKind::Behavior, "world_behavior_packs.json"),
        (PackKind::Resource, "world_resource_packs.json"),
    ] {
        let wanted: Vec<_> = packs.iter().filter(|m| m.kind == kind).collect();
        if wanted.is_empty() {
            continue;
        }
        let path = dir.join(file);
        let mut entries = read_list(&path)?;
        let before = entries.clone();
        for manifest in wanted {
            let existing = entries.iter_mut().find(|e| {
                e.get("pack_id")
                    .and_then(Value::as_str)
                    .is_some_and(|u| u.eq_ignore_ascii_case(&manifest.uuid))
            });
            match existing {
                Some(entry) => entry["version"] = json!(manifest.version),
                None => {
                    entries.push(json!({ "pack_id": manifest.uuid, "version": manifest.version }))
                }
            }
        }
        if entries != before {
            let text = serde_json::to_vec_pretty(&entries).unwrap_or_default();
            write_atomic(&path, &text)?;
        }
    }
    Ok(())
}

fn read_list(path: &Path) -> Result<Vec<Value>> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(PackError::io(path, error)),
    };
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    // a file we can't read stays untouched, rewriting it could drop packs the world needs
    serde_json::from_str(&text).map_err(|e| PackError::WorldFile {
        path: path.display().to_string(),
        message: e.to_string(),
    })
}

fn world_dir(install: &Install, id: &str) -> Result<PathBuf> {
    let plain = !id.is_empty()
        && id != "."
        && id != ".."
        && !id.contains(['/', '\\'])
        && !id.contains('\0');
    let dir = install.worlds_root.join(WORLDS).join(id);
    if plain && dir.join("level.dat").is_file() {
        Ok(dir)
    } else {
        Err(PackError::WorldNotFound(id.to_owned()))
    }
}
