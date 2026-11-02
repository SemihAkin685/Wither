use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::{PackError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PackKind {
    Behavior,
    Resource,
    Skin,
    Unknown,
}

/// The bits of a manifest.json the install and export code care about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub name: String,
    pub uuid: String,
    pub version: [u32; 3],
    pub kind: PackKind,
}

impl Manifest {
    pub fn load(path: &Path) -> Result<Self> {
        let text = fs::read_to_string(path).map_err(|e| PackError::io(path, e))?;
        Self::parse(&text).map_err(|message| PackError::Manifest {
            path: path.display().to_string(),
            message,
        })
    }

    pub fn parse(text: &str) -> std::result::Result<Self, String> {
        // yeah, Mojang's own samples ship manifests with comments, the game doesn't mind
        let value: Value =
            serde_json::from_str(&strip_comments(text)).map_err(|e| e.to_string())?;
        let header = value.get("header").ok_or("manifest has no header")?;
        let uuid = header
            .get("uuid")
            .and_then(Value::as_str)
            .filter(|u| !u.trim().is_empty())
            .ok_or("header.uuid is missing")?
            .trim()
            .to_owned();
        let version = header
            .get("version")
            .and_then(parse_version)
            .ok_or("header.version must be [major, minor, patch] or \"major.minor.patch\"")?;
        let name = header
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let kind = value
            .get("modules")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|m| m.get("type").and_then(Value::as_str))
            .find_map(kind_of)
            .unwrap_or(PackKind::Unknown);
        Ok(Self {
            name,
            uuid,
            version,
            kind,
        })
    }
}

fn kind_of(module_type: &str) -> Option<PackKind> {
    match module_type {
        "data" | "script" | "javascript" => Some(PackKind::Behavior),
        "resources" => Some(PackKind::Resource),
        "skin_pack" => Some(PackKind::Skin),
        _ => None,
    }
}

// format_version 3 allows a semver string, older ones want an array
fn parse_version(value: &Value) -> Option<[u32; 3]> {
    let parts: Vec<u32> = match value {
        Value::Array(items) => items
            .iter()
            .map(|v| v.as_u64().and_then(|n| u32::try_from(n).ok()))
            .collect::<Option<_>>()?,
        Value::String(text) => {
            // hmm, prerelease tags like 1.0.0-beta just get cut off, the world file only takes numbers
            let core = text.split(['-', '+']).next().unwrap_or_default();
            core.split('.')
                .map(|p| p.trim().parse().ok())
                .collect::<Option<_>>()?
        }
        _ => return None,
    };
    match parts.as_slice() {
        [major, minor, patch] => Some([*major, *minor, *patch]),
        _ => None,
    }
}

/// Drops // and /* */ comments outside of strings.
fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            match c {
                '\\' => {
                    if let Some(next) = chars.next() {
                        out.push(next);
                    }
                }
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                out.push(c);
            }
            ('/', Some('/')) => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut prev = '\0';
                for next in chars.by_ref() {
                    if prev == '*' && next == '/' {
                        break;
                    }
                    prev = next;
                }
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_behavior_pack_with_comments() {
        let manifest = Manifest::parse(
            r#"{
              // leading comment
              "format_version": 2,
              "header": { "name": "Demo // not a comment", "uuid": "abc", "version": [1, 2, 3] },
              /* block */
              "modules": [{ "type": "data", "uuid": "def", "version": [1, 0, 0] }]
            }"#,
        )
        .unwrap();
        assert_eq!(manifest.name, "Demo // not a comment");
        assert_eq!(manifest.version, [1, 2, 3]);
        assert_eq!(manifest.kind, PackKind::Behavior);
    }

    #[test]
    fn reads_string_versions_and_resource_kind() {
        let manifest = Manifest::parse(
            r#"{"format_version":3,"header":{"uuid":"a","version":"2.0.1-beta"},"modules":[{"type":"resources"}]}"#,
        )
        .unwrap();
        assert_eq!(manifest.version, [2, 0, 1]);
        assert_eq!(manifest.kind, PackKind::Resource);
    }

    #[test]
    fn script_only_pack_is_behavior_and_unknown_types_fall_through() {
        let script = Manifest::parse(
            r#"{"header":{"uuid":"a","version":[1,0,0]},"modules":[{"type":"script"}]}"#,
        )
        .unwrap();
        assert_eq!(script.kind, PackKind::Behavior);
        let other = Manifest::parse(
            r#"{"header":{"uuid":"a","version":[1,0,0]},"modules":[{"type":"world_template"}]}"#,
        )
        .unwrap();
        assert_eq!(other.kind, PackKind::Unknown);
    }

    #[test]
    fn missing_uuid_is_an_error() {
        assert!(Manifest::parse(r#"{"header":{"version":[1,0,0]}}"#).is_err());
        assert!(Manifest::parse(r#"{"header":{"uuid":"a","version":[1,0]}}"#).is_err());
    }
}
