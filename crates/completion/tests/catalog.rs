use wither_completion::catalog;

#[test]
fn block_components_come_from_bedrock_addon() {
    let catalog = catalog();
    let block = catalog
        .families
        .iter()
        .find(|family| family.name == "block")
        .expect("block family");
    let friction = block
        .components
        .iter()
        .find(|component| component.name == "minecraft:friction")
        .expect("minecraft:friction");
    assert!(!friction.experimental);
}

#[test]
fn every_family_has_components_and_unique_names() {
    for family in catalog().families {
        assert!(
            !family.components.is_empty(),
            "{} has no components",
            family.name
        );
        let mut names: Vec<_> = family.components.iter().map(|c| c.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(
            names.len(),
            family.components.len(),
            "{} repeats a name",
            family.name
        );
    }
}

#[test]
fn manifest_and_vanilla_lists_are_filled() {
    let catalog = catalog();
    assert!(catalog.manifest.module_types.contains(&"data"));
    assert!(catalog.manifest.module_types.contains(&"resources"));
    assert!(!catalog.manifest.module_types.contains(&"invalid"));
    let server = catalog
        .manifest
        .script_modules
        .iter()
        .find(|module| module.name == "@minecraft/server")
        .expect("@minecraft/server");
    assert!(server.versions.iter().any(|version| version == "1.0.0"));
    assert!(catalog.vanilla.items.contains(&"minecraft:diamond"));
    assert!(catalog.vanilla.blocks.contains(&"minecraft:stone"));
    let give = catalog
        .vanilla
        .commands
        .iter()
        .find(|command| command.name == "give")
        .expect("give");
    assert!(give.usage.starts_with("give <"));
}

#[test]
fn the_catalog_serializes_with_camel_case_keys() {
    let json = serde_json::to_value(catalog()).expect("serialize");
    assert!(json["families"][0]["payloadKey"].is_string());
    assert!(json["manifest"]["moduleTypes"].is_array());
}

#[test]
fn the_script_api_follows_world_into_its_events() {
    let catalog = catalog();
    let server = catalog
        .script_api
        .iter()
        .find(|module| module.name == "@minecraft/server")
        .expect("@minecraft/server");
    let world = server
        .exports
        .iter()
        .find(|export| export.name == "world")
        .expect("world");
    assert_eq!(world.type_name.as_deref(), Some("World"));
    let ty = |name: &str| server.types.iter().find(|ty| ty.name == name).expect(name);
    let after = ty("World")
        .members
        .iter()
        .find(|member| member.name == "afterEvents")
        .expect("afterEvents");
    assert_eq!(after.returns.as_deref(), Some("WorldAfterEvents"));
    let subscribe = ty("PlayerJoinAfterEventSignal")
        .members
        .iter()
        .find(|member| member.name == "subscribe")
        .expect("subscribe");
    assert_eq!(
        subscribe.callback.as_deref(),
        Some(&[Some("PlayerJoinAfterEvent".to_owned())][..])
    );
    let players = ty("World")
        .members
        .iter()
        .find(|member| member.name == "getPlayers")
        .expect("getPlayers");
    assert_eq!(
        (players.returns.as_deref(), players.many),
        (Some("Player"), true)
    );
}
