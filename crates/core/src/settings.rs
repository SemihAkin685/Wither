use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const UI_FONT_SIZE_RANGE: (u8, u8) = (11, 18);
pub const EDITOR_FONT_SIZE_RANGE: (u8, u8) = (10, 24);
pub const TAB_SIZE_RANGE: (u8, u8) = (1, 8);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

// serde(default) so a settings file from an older build still loads, missing keys just get defaults
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Theme,
    pub ui_font_size: u8,
    pub editor_font_size: u8,
    pub show_line_numbers: bool,
    pub tab_size: u8,
    pub highlight_current_line: bool,
    pub suggestions: bool,
    /// A com.mojang folder to test in, empty means use the detected installs.
    pub minecraft_install: String,
    /// Command that starts the game, empty means pick one for this OS.
    pub launch_command: String,
    /// Where the last "Test in game" went, so the next run is one click.
    pub last_test_target: Option<TestTarget>,
}

/// An install (by id) and optionally a world folder in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestTarget {
    pub install: String,
    pub world: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            ui_font_size: 13,
            editor_font_size: 14,
            show_line_numbers: true,
            tab_size: 2,
            highlight_current_line: true,
            suggestions: true,
            minecraft_install: String::new(),
            launch_command: String::new(),
            last_test_target: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub ui_font_size: Option<u8>,
    pub editor_font_size: Option<u8>,
    pub show_line_numbers: Option<bool>,
    pub tab_size: Option<u8>,
    pub highlight_current_line: Option<bool>,
    pub suggestions: Option<bool>,
    pub minecraft_install: Option<String>,
    pub launch_command: Option<String>,
}

impl Settings {
    /// Reads settings from a JSON file. A missing file is a first launch, so that's just
    /// the defaults. A broken one is an error, the caller decides whether to fall back.
    pub fn load(path: &Path) -> io::Result<Self> {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error),
        };
        let mut settings: Self = serde_json::from_str(&text).map_err(io::Error::other)?;
        // hmm, the file is user editable, so run it through the same clamps as a patch
        settings.clamp();
        Ok(settings)
    }

    /// Writes the settings as pretty JSON. Goes through a temp file and a rename so a crash
    /// mid write can't leave a half written file behind.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, path)
    }

    /// Merges a partial update from the frontend. Sizes get clamped so a bad
    /// value can't make the UI unusable.
    pub fn apply(&mut self, patch: SettingsPatch) {
        if let Some(theme) = patch.theme {
            self.theme = theme;
        }
        if let Some(size) = patch.ui_font_size {
            self.ui_font_size = size;
        }
        if let Some(size) = patch.editor_font_size {
            self.editor_font_size = size;
        }
        if let Some(show) = patch.show_line_numbers {
            self.show_line_numbers = show;
        }
        if let Some(size) = patch.tab_size {
            self.tab_size = size;
        }
        if let Some(highlight) = patch.highlight_current_line {
            self.highlight_current_line = highlight;
        }
        if let Some(suggestions) = patch.suggestions {
            self.suggestions = suggestions;
        }
        if let Some(path) = patch.minecraft_install {
            self.minecraft_install = path.trim().to_owned();
        }
        if let Some(command) = patch.launch_command {
            self.launch_command = command.trim().to_owned();
        }
        self.clamp();
    }

    fn clamp(&mut self) {
        self.ui_font_size = self
            .ui_font_size
            .clamp(UI_FONT_SIZE_RANGE.0, UI_FONT_SIZE_RANGE.1);
        self.editor_font_size = self
            .editor_font_size
            .clamp(EDITOR_FONT_SIZE_RANGE.0, EDITOR_FONT_SIZE_RANGE.1);
        self.tab_size = self.tab_size.clamp(TAB_SIZE_RANGE.0, TAB_SIZE_RANGE.1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_only_touches_given_fields() {
        let mut settings = Settings::default();
        settings.apply(SettingsPatch {
            theme: Some(Theme::Light),
            ..Default::default()
        });
        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(
            settings.editor_font_size,
            Settings::default().editor_font_size
        );
    }

    #[test]
    fn apply_clamps_font_sizes() {
        let mut settings = Settings::default();
        settings.apply(SettingsPatch {
            ui_font_size: Some(2),
            editor_font_size: Some(200),
            ..Default::default()
        });
        assert_eq!(settings.ui_font_size, UI_FONT_SIZE_RANGE.0);
        assert_eq!(settings.editor_font_size, EDITOR_FONT_SIZE_RANGE.1);
    }

    #[test]
    fn patch_deserializes_camel_case() {
        let patch: SettingsPatch =
            serde_json::from_str(r#"{"theme":"light","editorFontSize":16}"#).unwrap();
        assert_eq!(patch.theme, Some(Theme::Light));
        assert_eq!(patch.editor_font_size, Some(16));
        assert_eq!(patch.ui_font_size, None);
    }

    #[test]
    fn apply_clamps_tab_size() {
        let mut settings = Settings::default();
        settings.apply(SettingsPatch {
            tab_size: Some(0),
            ..Default::default()
        });
        assert_eq!(settings.tab_size, TAB_SIZE_RANGE.0);
    }

    #[test]
    fn old_settings_json_fills_in_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"theme":"light"}"#).unwrap();
        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.tab_size, Settings::default().tab_size);
        assert!(settings.suggestions);
        assert!(settings.minecraft_install.is_empty());
        assert_eq!(settings.last_test_target, None);
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("wither-settings-{}", std::process::id()));
        let path = dir.join("settings.json");
        let mut settings = Settings::default();
        settings.apply(SettingsPatch {
            theme: Some(Theme::Light),
            tab_size: Some(4),
            suggestions: Some(false),
            ..Default::default()
        });
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap(), settings);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn load_missing_file_gives_defaults() {
        let path = std::env::temp_dir().join("wither-settings-does-not-exist.json");
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
    }

    #[test]
    fn load_clamps_hand_edited_values() {
        let dir =
            std::env::temp_dir().join(format!("wither-settings-clamp-{}", std::process::id()));
        let path = dir.join("settings.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, r#"{"uiFontSize":99,"tabSize":40}"#).unwrap();
        let settings = Settings::load(&path).unwrap();
        assert_eq!(settings.ui_font_size, UI_FONT_SIZE_RANGE.1);
        assert_eq!(settings.tab_size, TAB_SIZE_RANGE.1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
