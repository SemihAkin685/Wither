use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::fsutil::{is_skipped, sanitize};
use crate::manifest::Manifest;
use crate::{PackError, Result};

const MANIFEST: &str = "manifest.json";
// packs sit near the top of a project, no need to crawl a whole disk if someone opens ~
const MAX_DEPTH: usize = 6;

/// A pack folder on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundPack {
    #[serde(skip)]
    pub dir: PathBuf,
    /// Path relative to the project root with `/` separators, "" for a pack at the root.
    pub rel: String,
    /// Folder name used inside archives and install folders.
    pub folder: String,
    pub manifest: Manifest,
}

/// Packs found under a folder. A broken manifest doesn't hide the other packs, it ends up
/// in `broken` so callers can block just that one.
#[derive(Debug, Default)]
pub struct Discovery {
    pub packs: Vec<FoundPack>,
    pub broken: Vec<PackError>,
}

/// Finds every folder with a manifest.json under `root`, without looking inside a pack
/// for more packs.
pub fn find_packs(root: &Path) -> Result<Discovery> {
    let mut found = Discovery::default();
    let root_name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    walk(root, "", &root_name, 0, &mut found)?;
    found.packs.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(found)
}

fn walk(dir: &Path, rel: &str, name: &str, depth: usize, found: &mut Discovery) -> Result<()> {
    let manifest = dir.join(MANIFEST);
    if manifest.is_file() {
        match Manifest::load(&manifest) {
            Ok(manifest) => found.packs.push(FoundPack {
                dir: dir.to_path_buf(),
                rel: rel.to_owned(),
                folder: sanitize(name),
                manifest,
            }),
            Err(error) => found.broken.push(error),
        }
        return Ok(());
    }
    if depth >= MAX_DEPTH {
        return Ok(());
    }
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| PackError::io(dir, e))?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let child = entry.file_name().to_string_lossy().into_owned();
        if is_skipped(&child) || !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let child_rel = if rel.is_empty() {
            child.clone()
        } else {
            format!("{rel}/{child}")
        };
        walk(&entry.path(), &child_rel, &child, depth + 1, found)?;
    }
    Ok(())
}
