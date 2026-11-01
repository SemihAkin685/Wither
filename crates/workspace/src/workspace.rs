use std::collections::BTreeMap;
use std::fmt;

use serde::Serialize;

use crate::search::{self, SearchMatch};
use crate::tree::{FileNode, Language};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceError {
    NotFound(String),
    NotText(String),
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(path) => write!(f, "file not found: {path}"),
            Self::NotText(path) => write!(f, "file is not a text file: {path}"),
        }
    }
}

impl std::error::Error for WorkspaceError {}

/// An in-memory project. File contents live next to the tree so the UI can open
/// and save files without touching the disk yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub name: String,
    pub root: String,
    pub tree: Vec<FileNode>,
    #[serde(skip)]
    files: BTreeMap<String, String>,
}

impl Workspace {
    pub fn read(&self, path: &str) -> Result<&str, WorkspaceError> {
        if !Language::from_path(path).is_text() {
            return Err(WorkspaceError::NotText(path.to_owned()));
        }
        self.files
            .get(path)
            .map(String::as_str)
            .ok_or_else(|| WorkspaceError::NotFound(path.to_owned()))
    }

    pub fn write(&mut self, path: &str, contents: String) -> Result<(), WorkspaceError> {
        let slot = self
            .files
            .get_mut(path)
            .ok_or_else(|| WorkspaceError::NotFound(path.to_owned()))?;
        *slot = contents;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchMatch> {
        search::search_files(
            self.files
                .iter()
                .filter(|(path, _)| Language::from_path(path).is_text())
                .map(|(path, text)| (path.as_str(), text.as_str())),
            query,
            limit,
        )
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
        self.files
            .insert(path.trim_matches('/').to_owned(), contents.to_owned());
        self
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
        }
    }
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
}
