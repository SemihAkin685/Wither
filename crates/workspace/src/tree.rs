use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Json,
    JavaScript,
    TypeScript,
    Lang,
    Markdown,
    Image,
    PlainText,
}

impl Language {
    pub fn from_path(path: &str) -> Self {
        let ext = path
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "json" | "mcmeta" => Self::Json,
            "js" | "mjs" => Self::JavaScript,
            "ts" => Self::TypeScript,
            "lang" => Self::Lang,
            "md" => Self::Markdown,
            "png" | "tga" | "jpg" | "jpeg" => Self::Image,
            _ => Self::PlainText,
        }
    }

    pub fn is_text(self) -> bool {
        self != Self::Image
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<Language>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FileNode>,
}

impl FileNode {
    pub fn file(name: &str, path: &str) -> Self {
        Self {
            name: name.to_owned(),
            path: path.to_owned(),
            kind: NodeKind::File,
            language: Some(Language::from_path(path)),
            children: Vec::new(),
        }
    }

    pub fn directory(name: &str, path: &str) -> Self {
        Self {
            name: name.to_owned(),
            path: path.to_owned(),
            kind: NodeKind::Directory,
            language: None,
            children: Vec::new(),
        }
    }

    pub fn is_directory(&self) -> bool {
        self.kind == NodeKind::Directory
    }

    /// Directories first, then files, both alphabetical. Same order every IDE uses,
    /// so people don't have to hunt for folders.
    pub fn sort_recursive(&mut self) {
        self.children.sort_by(|a, b| {
            b.is_directory()
                .cmp(&a.is_directory())
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        for child in &mut self.children {
            child.sort_recursive();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_detection_ignores_case() {
        assert_eq!(Language::from_path("BP/manifest.JSON"), Language::Json);
        assert_eq!(Language::from_path("texts/en_US.lang"), Language::Lang);
        assert_eq!(Language::from_path("pack_icon.png"), Language::Image);
        assert_eq!(Language::from_path("LICENSE"), Language::PlainText);
    }

    #[test]
    fn sort_puts_directories_first() {
        let mut root = FileNode::directory("root", "");
        root.children.push(FileNode::file("b.json", "b.json"));
        root.children.push(FileNode::directory("z", "z"));
        root.children.push(FileNode::file("A.json", "A.json"));
        root.sort_recursive();
        let names: Vec<_> = root.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["z", "A.json", "b.json"]);
    }
}
