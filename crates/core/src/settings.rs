use serde::{Deserialize, Serialize};

pub const UI_FONT_SIZE_RANGE: (u8, u8) = (11, 18);
pub const EDITOR_FONT_SIZE_RANGE: (u8, u8) = (10, 24);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub ui_font_size: u8,
    pub editor_font_size: u8,
    pub show_line_numbers: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            ui_font_size: 13,
            editor_font_size: 14,
            show_line_numbers: true,
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
}

impl Settings {
    /// Merges a partial update from the frontend. Font sizes get clamped so a bad
    /// value can't make the UI unusable.
    pub fn apply(&mut self, patch: SettingsPatch) {
        if let Some(theme) = patch.theme {
            self.theme = theme;
        }
        if let Some(size) = patch.ui_font_size {
            self.ui_font_size = size.clamp(UI_FONT_SIZE_RANGE.0, UI_FONT_SIZE_RANGE.1);
        }
        if let Some(size) = patch.editor_font_size {
            self.editor_font_size = size.clamp(EDITOR_FONT_SIZE_RANGE.0, EDITOR_FONT_SIZE_RANGE.1);
        }
        if let Some(show) = patch.show_line_numbers {
            self.show_line_numbers = show;
        }
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
}
