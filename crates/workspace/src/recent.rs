use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub name: String,
    pub path: String,
    pub last_opened: String,
}

impl RecentProject {
    fn new(name: &str, path: &str, last_opened: &str) -> Self {
        Self {
            name: name.to_owned(),
            path: path.to_owned(),
            last_opened: last_opened.to_owned(),
        }
    }
}

/// Placeholder history until projects are opened from disk.
pub fn sample_recent_projects() -> Vec<RecentProject> {
    vec![
        RecentProject::new("Withered Realms", "~/addons/withered-realms", "2 hours ago"),
        RecentProject::new(
            "Soul Sand Valley+",
            "~/addons/soul-sand-valley",
            "yesterday",
        ),
        RecentProject::new("Nether Tools", "~/addons/nether-tools", "3 days ago"),
    ]
}
