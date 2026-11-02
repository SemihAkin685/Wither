use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

const MAX_RECENT: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub name: String,
    pub path: String,
    /// Unix seconds, the UI turns it into "2 hours ago".
    pub last_opened: u64,
}

/// Recently opened folders, newest first. Lives in its own file next to the settings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RecentProjects(Vec<RecentProject>);

impl RecentProjects {
    /// A missing file just means nothing was opened yet.
    pub fn load(path: &Path) -> io::Result<Self> {
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(io::Error::other),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error),
        }
    }

    /// Same temp file and rename dance as the settings, so a crash can't truncate it.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, path)
    }

    /// Moves `path` to the front, or adds it there, and drops the oldest past the limit.
    pub fn touch(&mut self, name: &str, path: &str, now: u64) {
        self.0.retain(|p| p.path != path);
        self.0.insert(
            0,
            RecentProject {
                name: name.to_owned(),
                path: path.to_owned(),
                last_opened: now,
            },
        );
        self.0.truncate(MAX_RECENT);
    }

    pub fn contains(&self, path: &str) -> bool {
        self.0.iter().any(|p| p.path == path)
    }

    pub fn iter(&self) -> impl Iterator<Item = &RecentProject> {
        self.0.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn touch_moves_to_front_without_duplicates() {
        let mut recent = RecentProjects::default();
        recent.touch("a", "/a", 1);
        recent.touch("b", "/b", 2);
        recent.touch("a", "/a", 3);
        let paths: Vec<_> = recent.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, ["/a", "/b"]);
        assert_eq!(recent.iter().next().unwrap().last_opened, 3);
    }

    #[test]
    fn touch_keeps_only_the_newest() {
        let mut recent = RecentProjects::default();
        for i in 0..15 {
            recent.touch("p", &format!("/p{i}"), i);
        }
        assert_eq!(recent.iter().count(), MAX_RECENT);
        assert_eq!(recent.iter().next().unwrap().path, "/p14");
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("wither-recent-{}", std::process::id()));
        let file = dir.join("recent.json");
        assert_eq!(RecentProjects::load(&file).unwrap(), RecentProjects::default());

        let mut recent = RecentProjects::default();
        recent.touch("demo", "/demo", 42);
        recent.save(&file).unwrap();
        assert_eq!(RecentProjects::load(&file).unwrap(), recent);
        fs::remove_dir_all(&dir).unwrap();
    }
}
