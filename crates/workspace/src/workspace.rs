use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::search::{self, SearchMatch};
use crate::tree::{FileNode, Language};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceError {
    NotFound(String),
    NotText(String),
    Io { path: String, message: String },
    TooManyFiles(usize),
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(path) => write!(f, "file not found: {path}"),
            Self::NotText(path) => write!(f, "file is not a text file: {path}"),
            Self::Io { path, message } => write!(f, "{path}: {message}"),
            Self::TooManyFiles(limit) => {
                write!(f, "folder has more than {limit} files, open a smaller one")
            }
        }
    }
}

impl std::error::Error for WorkspaceError {}

impl WorkspaceError {
    fn io(path: &Path, error: std::io::Error) -> Self {
        Self::Io {
            path: path.display().to_string(),
            message: error.to_string(),
        }
    }
}

/// Folders nobody wants in the explorer and that can hold a huge number of files.
const SKIPPED_DIRS: &[&str] = &[".git", "node_modules", "target"];
const MAX_FILES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// A project held in memory. Text files are loaded up front so search and diagnostics never
/// wait on the disk. Workspaces opened from a folder write saves through to it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub name: String,
    pub root: String,
    pub tree: Vec<FileNode>,
    #[serde(skip)]
    files: BTreeMap<String, String>,
    #[serde(skip)]
    disk_root: Option<PathBuf>,
}

impl Workspace {
    /// Loads every file under `dir`. Images only get a tree entry, text files that aren't
    /// valid UTF-8 or are too big to edit comfortably are left out.
    pub fn open(dir: &Path) -> Result<Self, WorkspaceError> {
        let dir = fs::canonicalize(dir).map_err(|e| WorkspaceError::io(dir, e))?;
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| dir.display().to_string());
        let mut builder = WorkspaceBuilder::new(name, dir.display().to_string());
        let mut count = 0;
        load_dir(&dir, "", &mut builder, &mut count)?;
        let mut workspace = builder.build();
        workspace.disk_root = Some(dir);
        Ok(workspace)
    }

    pub fn read(&self, path: &str) -> Result<&str, WorkspaceError> {
        if !Language::from_path(path).is_text() {
            return Err(WorkspaceError::NotText(path.to_owned()));
        }
        self.files
            .get(path)
            .map(String::as_str)
            .ok_or_else(|| WorkspaceError::NotFound(path.to_owned()))
    }

    /// Raw bytes of an image in a workspace opened from disk, for previews that need the
    /// pack's own textures. In-memory workspaces have no image data, so they report NotFound.
    pub fn read_image(&self, path: &str) -> Result<Vec<u8>, WorkspaceError> {
        if Language::from_path(path).is_text() {
            return Err(WorkspaceError::NotFound(path.to_owned()));
        }
        let root = self
            .disk_root
            .as_ref()
            .filter(|_| self.files.contains_key(path))
            .ok_or_else(|| WorkspaceError::NotFound(path.to_owned()))?;
        let target = root.join(path);
        fs::read(&target).map_err(|e| WorkspaceError::io(&target, e))
    }

    pub fn write(&mut self, path: &str, contents: String) -> Result<(), WorkspaceError> {
        let slot = self
            .files
            .get_mut(path)
            .ok_or_else(|| WorkspaceError::NotFound(path.to_owned()))?;
        // ok so only paths we loaded ourselves end up as keys, joining them can't escape the root
        if let Some(root) = &self.disk_root {
            let target = root.join(path);
            fs::write(&target, &contents).map_err(|e| WorkspaceError::io(&target, e))?;
        }
        *slot = contents;
        Ok(())
    }

    /// Every text file with its contents, sorted by path.
    pub fn text_files(&self) -> impl Iterator<Item = (&str, &str)> {
        self.files
            .iter()
            .filter(|(path, _)| Language::from_path(path).is_text())
            .map(|(path, text)| (path.as_str(), text.as_str()))
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchMatch> {
        search::search_files(self.text_files(), query, limit)
    }
}

pub struct WorkspaceBuilder {
    name: String,
    root: String,
    files: BTreeMap<String, String>,
}

impl WorkspaceBuilder {
    pub fn new(name: impl Into<String>, root: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            root: root.into(),
            files: BTreeMap::new(),
        }
    }

    pub fn file(mut self, path: &str, contents: &str) -> Self {
        self.insert(path.trim_matches('/').to_owned(), contents.to_owned());
        self
    }

    fn insert(&mut self, path: String, contents: String) {
        self.files.insert(path, contents);
    }

    pub fn build(self) -> Workspace {
        let mut root = FileNode::directory(&self.name, "");
        for path in self.files.keys() {
            insert_path(&mut root, path);
        }
        root.sort_recursive();
        Workspace {
            name: self.name,
            root: self.root,
            tree: root.children,
            files: self.files,
            disk_root: None,
        }
    }
}

fn load_dir(
    dir: &Path,
    prefix: &str,
    builder: &mut WorkspaceBuilder,
    count: &mut usize,
) -> Result<(), WorkspaceError> {
    let entries = fs::read_dir(dir).map_err(|e| WorkspaceError::io(dir, e))?;
    for entry in entries {
        let entry = entry.map_err(|e| WorkspaceError::io(dir, e))?;
        // hmm, non UTF-8 names can't round trip through the UI's string paths, skip them
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // symlinks aren't followed, a link back up the tree would loop forever
        if file_type.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) {
                load_dir(&entry.path(), &path, builder, count)?;
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        *count += 1;
        if *count > MAX_FILES {
            return Err(WorkspaceError::TooManyFiles(MAX_FILES));
        }
        if !Language::from_path(&path).is_text() {
            builder.insert(path, String::new());
            continue;
        }
        let too_big = entry.metadata().map_or(true, |m| m.len() > MAX_FILE_BYTES);
        if too_big {
            continue;
        }
        if let Ok(text) = fs::read_to_string(entry.path()) {
            builder.insert(path, text);
        }
    }
    Ok(())
}

fn insert_path(root: &mut FileNode, path: &str) {
    let segments: Vec<&str> = path.split('/').collect();
    let mut node = root;
    for (depth, segment) in segments.iter().enumerate() {
        let sub_path = segments[..=depth].join("/");
        let is_leaf = depth == segments.len() - 1;
        let index = match node.children.iter().position(|c| c.name == *segment) {
            Some(index) => index,
            None => {
                let child = if is_leaf {
                    FileNode::file(segment, &sub_path)
                } else {
                    FileNode::directory(segment, &sub_path)
                };
                node.children.push(child);
                node.children.len() - 1
            }
        };
        node = &mut node.children[index];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::NodeKind;

    fn workspace() -> Workspace {
        WorkspaceBuilder::new("demo", "~/demo")
            .file("BP/manifest.json", "{}")
            .file("BP/entities/zombie.json", "{\"a\": 1}")
            .file("README.md", "# hi")
            .file("BP/pack_icon.png", "")
            .build()
    }

    #[test]
    fn build_nests_directories() {
        let ws = workspace();
        assert_eq!(ws.tree[0].name, "BP");
        assert_eq!(ws.tree[0].kind, NodeKind::Directory);
        let bp = &ws.tree[0];
        assert_eq!(bp.children[0].path, "BP/entities");
        assert_eq!(bp.children[0].children[0].path, "BP/entities/zombie.json");
        assert_eq!(ws.tree[1].name, "README.md");
    }

    #[test]
    fn read_and_write_round_trip() {
        let mut ws = workspace();
        ws.write("README.md", "# changed".into()).unwrap();
        assert_eq!(ws.read("README.md").unwrap(), "# changed");
    }

    #[test]
    fn read_rejects_missing_and_binary_files() {
        let ws = workspace();
        assert!(matches!(
            ws.read("nope.json"),
            Err(WorkspaceError::NotFound(_))
        ));
        assert!(matches!(
            ws.read("BP/pack_icon.png"),
            Err(WorkspaceError::NotText(_))
        ));
    }

    #[test]
    fn write_does_not_create_files() {
        let mut ws = workspace();
        assert!(ws.write("new.json", "{}".into()).is_err());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wither-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_loads_folder_and_skips_noise() {
        let dir = temp_dir("open");
        fs::create_dir_all(dir.join("BP/entities")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join("BP/entities/zombie.json"), "{}").unwrap();
        fs::write(dir.join("BP/pack_icon.png"), [0x89, 0x50]).unwrap();
        fs::write(dir.join("broken.txt"), [0xff, 0xfe, 0x00]).unwrap();
        fs::write(dir.join(".git/HEAD"), "ref").unwrap();

        let ws = Workspace::open(&dir).unwrap();
        let paths: Vec<_> = ws.files.keys().map(String::as_str).collect();
        assert_eq!(paths, ["BP/entities/zombie.json", "BP/pack_icon.png"]);
        assert_eq!(ws.read("BP/entities/zombie.json").unwrap(), "{}");
        assert!(ws.name.starts_with("wither-open"));
        assert_eq!(ws.read_image("BP/pack_icon.png").unwrap(), [0x89, 0x50]);
        assert!(ws.read_image("BP/entities/zombie.json").is_err());
        assert!(ws.read_image("../outside.png").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_goes_to_disk_for_opened_folders() {
        let dir = temp_dir("write");
        fs::write(dir.join("README.md"), "# hi").unwrap();

        let mut ws = Workspace::open(&dir).unwrap();
        ws.write("README.md", "# changed".into()).unwrap();
        assert_eq!(fs::read_to_string(dir.join("README.md")).unwrap(), "# changed");
        fs::remove_dir_all(&dir).unwrap();
    }
}
