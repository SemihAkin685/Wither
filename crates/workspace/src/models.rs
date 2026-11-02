//! Finds the geometry file behind an entity, so it can be handed to a model editor.
//!
//! The chain is behavior entity -> client entity (same identifier) -> geometry identifier
//! -> the .geo.json that declares it. Attachables work like client entities.

use serde_json::Value;

const CLIENT_KEYS: &[&str] = &["minecraft:client_entity", "minecraft:attachable"];

/// Workspace path of the model file for `path`, or None when there is nothing to open.
/// A geometry file resolves to itself.
pub(crate) fn model_for<'a>(
    files: impl Iterator<Item = (&'a str, &'a str)> + Clone,
    path: &str,
    text: &str,
) -> Option<String> {
    let doc: Value = serde_json::from_str(text).ok()?;
    if !geometry_ids(&doc).is_empty() {
        return Some(path.to_owned());
    }
    let geometry = if let Some(client) = client_description(&doc) {
        default_geometry(client)?
    } else {
        let identifier = doc
            .pointer("/minecraft:entity/description/identifier")?
            .as_str()?;
        let client = files.clone().find_map(|(p, t)| {
            // cheap filter first, most files never mention the id
            if p == path || !t.contains(identifier) {
                return None;
            }
            let doc: Value = serde_json::from_str(t).ok()?;
            let client = client_description(&doc)?;
            (client.get("identifier")?.as_str()? == identifier)
                .then(|| default_geometry(client))
                .flatten()
        });
        client?
    };
    files
        .filter(|(_, t)| t.contains(geometry.as_str()))
        .find(|(_, t)| {
            serde_json::from_str::<Value>(t).is_ok_and(|doc| geometry_ids(&doc).contains(&geometry))
        })
        .map(|(p, _)| p.to_owned())
}

fn client_description(doc: &Value) -> Option<&Value> {
    CLIENT_KEYS
        .iter()
        .find_map(|key| doc.get(*key)?.get("description"))
}

// "default" is what vanilla uses, otherwise any entry beats nothing
fn default_geometry(description: &Value) -> Option<String> {
    let map = description.get("geometry")?.as_object()?;
    map.get("default")
        .or_else(|| map.values().next())?
        .as_str()
        .map(str::to_owned)
}

/// Geometry identifiers a file declares, in either the 1.12+ or the legacy format.
fn geometry_ids(doc: &Value) -> Vec<String> {
    if let Some(list) = doc.get("minecraft:geometry").and_then(Value::as_array) {
        return list
            .iter()
            .filter_map(|g| g.pointer("/description/identifier")?.as_str())
            .map(str::to_owned)
            .collect();
    }
    // legacy files key models directly, "geometry.foo:geometry.base" inherits from base
    doc.as_object()
        .map(|map| {
            map.keys()
                .filter(|k| k.starts_with("geometry."))
                .map(|k| k.split(':').next().unwrap_or(k).to_owned())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BP: &str = r#"{"minecraft:entity":{"description":{"identifier":"demo:ghost"}}}"#;
    const RP: &str = r#"{"minecraft:client_entity":{"description":{"identifier":"demo:ghost","geometry":{"default":"geometry.ghost"}}}}"#;
    const GEO: &str = r#"{"format_version":"1.12.0","minecraft:geometry":[{"description":{"identifier":"geometry.ghost"}}]}"#;
    const LEGACY: &str =
        r#"{"format_version":"1.8.0","geometry.ghost:geometry.base":{"bones":[]}}"#;

    fn files<'a>(
        list: &'a [(&'a str, &'a str)],
    ) -> impl Iterator<Item = (&'a str, &'a str)> + Clone {
        list.iter().copied()
    }

    #[test]
    fn follows_behavior_entity_to_its_model() {
        let all = [
            ("BP/entities/ghost.json", BP),
            ("RP/entity/ghost.entity.json", RP),
            ("RP/models/entity/ghost.geo.json", GEO),
        ];
        assert_eq!(
            model_for(files(&all), "BP/entities/ghost.json", BP).as_deref(),
            Some("RP/models/entity/ghost.geo.json")
        );
        assert_eq!(
            model_for(files(&all), "RP/entity/ghost.entity.json", RP).as_deref(),
            Some("RP/models/entity/ghost.geo.json")
        );
        assert_eq!(
            model_for(files(&all), "RP/models/entity/ghost.geo.json", GEO).as_deref(),
            Some("RP/models/entity/ghost.geo.json")
        );
    }

    #[test]
    fn understands_legacy_geometry() {
        let all = [("RP/entity/ghost.json", RP), ("RP/models/old.json", LEGACY)];
        assert_eq!(
            model_for(files(&all), "RP/entity/ghost.json", RP).as_deref(),
            Some("RP/models/old.json")
        );
    }

    #[test]
    fn missing_links_give_nothing() {
        let all = [("BP/entities/ghost.json", BP)];
        assert_eq!(model_for(files(&all), "BP/entities/ghost.json", BP), None);
        assert_eq!(model_for(files(&all), "a.json", "not json"), None);
    }
}
