use serde::Serialize;

pub const APP_NAME: &str = "Wither";
pub const APP_TAGLINE: &str = "A Minecraft: Bedrock Edition IDE designed for the addon developers";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tagline: String,
}

impl AppInfo {
    pub fn current() -> Self {
        Self {
            name: APP_NAME.to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            tagline: APP_TAGLINE.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_uses_wither_branding() {
        let info = AppInfo::current();
        assert_eq!(info.name, "Wither");
        assert!(!info.version.is_empty());
    }
}
