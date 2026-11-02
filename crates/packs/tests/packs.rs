use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use wither_packs::{
    attach, export_mcaddon, export_mcpack, find_packs, import, install_pack, list_worlds, Install,
    Installed, PackError, PackKind,
};
use zip::write::SimpleFileOptions;

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// A scratch folder that cleans itself up.
struct Temp(PathBuf);

impl Temp {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("wither-packs-{name}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn manifest(uuid: &str, module: &str) -> String {
    format!(
        r#"{{"format_version":2,"header":{{"name":"Test","uuid":"{uuid}","version":[1,0,0]}},"modules":[{{"type":"{module}","uuid":"m-{uuid}","version":[1,0,0]}}]}}"#
    )
}

/// A project with a BP and RP, plus some junk that should never be exported.
fn project(root: &Path) {
    write(&root.join("BP/manifest.json"), &manifest("bp-uuid", "data"));
    write(&root.join("BP/entities/cow.json"), "{}");
    write(
        &root.join("RP/manifest.json"),
        &manifest("rp-uuid", "resources"),
    );
    write(&root.join("RP/textures/cow.png"), "png");
    write(&root.join(".git/config"), "nope");
    write(&root.join("node_modules/x/index.js"), "nope");
}

fn com_mojang(root: &Path) -> Install {
    let install = Install::manual(root);
    let world = root.join("minecraftWorlds/abc=");
    write(&world.join("levelname.txt"), "My World\n");
    write(&world.join("level.dat"), "dat");
    write(
        &world.join("world_behavior_packs.json"),
        r#"[{"pack_id":"other","version":[2,0,0]}]"#,
    );
    install
}

#[test]
fn finds_packs_and_their_kinds() {
    let temp = Temp::new("find");
    project(&temp.0);
    write(&temp.0.join("broken/manifest.json"), "{ nope");
    let found = find_packs(&temp.0).unwrap();
    let rels: Vec<_> = found.packs.iter().map(|p| p.rel.as_str()).collect();
    assert_eq!(rels, ["BP", "RP"]);
    assert_eq!(found.packs[0].manifest.kind, PackKind::Behavior);
    assert_eq!(found.packs[1].manifest.kind, PackKind::Resource);
    assert_eq!(found.broken.len(), 1);
}

#[test]
fn mcaddon_round_trips_and_skips_junk() {
    let temp = Temp::new("roundtrip");
    let src = temp.0.join("src");
    project(&src);
    let packs = find_packs(&src).unwrap().packs;
    let archive = temp.0.join("out.mcaddon");
    export_mcaddon(&packs, &archive).unwrap();

    let target = temp.0.join("imported");
    let dirs = import(&archive, &target).unwrap();
    assert_eq!(dirs, [target.join("BP"), target.join("RP")]);
    assert_eq!(
        fs::read_to_string(target.join("BP/entities/cow.json")).unwrap(),
        "{}"
    );
    assert!(target.join("RP/textures/cow.png").is_file());
    assert!(!target.join(".git").exists());
    assert!(!target.join("BP/node_modules").exists());
}

#[test]
fn single_mcpack_uses_archive_name() {
    let temp = Temp::new("mcpack");
    let src = temp.0.join("src");
    project(&src);
    let packs = find_packs(&src).unwrap().packs;
    let archive = temp.0.join("Cool Pack.mcpack");
    export_mcpack(&packs[0], &archive).unwrap();

    let target = temp.0.join("imported");
    let dirs = import(&archive, &target).unwrap();
    assert_eq!(dirs, [target.join("Cool Pack")]);
    assert!(target.join("Cool Pack/manifest.json").is_file());
}

#[test]
fn nested_mcpacks_inside_mcaddon_get_unpacked() {
    let temp = Temp::new("nested");
    let src = temp.0.join("src");
    project(&src);
    let packs = find_packs(&src).unwrap().packs;
    let inner = temp.0.join("inner.mcpack");
    export_mcpack(&packs[1], &inner).unwrap();

    let outer = temp.0.join("outer.mcaddon");
    let mut zip = zip::ZipWriter::new(File::create(&outer).unwrap());
    zip.start_file("Resources.mcpack", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(&fs::read(&inner).unwrap()).unwrap();
    zip.finish().unwrap();

    let target = temp.0.join("imported");
    let dirs = import(&outer, &target).unwrap();
    assert_eq!(dirs, [target.join("Resources")]);
    assert!(target.join("Resources/textures/cow.png").is_file());
}

#[test]
fn unsafe_entries_are_rejected() {
    let temp = Temp::new("unsafe");
    let archive = temp.0.join("evil.zip");
    let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
    zip.start_file("pack/manifest.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(manifest("x", "data").as_bytes()).unwrap();
    zip.start_file("../escape.txt", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"gotcha").unwrap();
    zip.finish().unwrap();

    let target = temp.0.join("imported");
    assert!(matches!(
        import(&archive, &target),
        Err(PackError::UnsafeEntry(_))
    ));
    assert!(!temp.0.join("escape.txt").exists());
}

#[test]
fn import_refuses_non_empty_folder() {
    let temp = Temp::new("nonempty");
    let src = temp.0.join("src");
    project(&src);
    let archive = temp.0.join("a.mcaddon");
    export_mcaddon(&find_packs(&src).unwrap().packs, &archive).unwrap();
    write(&temp.0.join("busy/keep.txt"), "mine");
    assert!(matches!(
        import(&archive, &temp.0.join("busy")),
        Err(PackError::TargetNotEmpty(_))
    ));
}

#[test]
fn install_replaces_own_copies_only() {
    let temp = Temp::new("install");
    let src = temp.0.join("Demo");
    project(&src);
    let packs = find_packs(&src).unwrap().packs;
    let install = com_mojang(&temp.0.join("com.mojang"));
    let dev = temp.0.join("com.mojang/development_behavior_packs");

    // an old Wither copy under another name and a hand made copy with the same uuid
    let first = install_pack(&install, &packs[0], "Old", &src).unwrap();
    assert!(matches!(first, Installed::Copied { .. }));
    write(
        &dev.join("handmade/manifest.json"),
        &manifest("bp-uuid", "data"),
    );

    let second = install_pack(&install, &packs[0], "Demo", &src).unwrap();
    let Installed::Copied { path, warnings } = second else {
        panic!("expected a copy");
    };
    assert_eq!(path, dev.join("Demo_BP"));
    assert!(path.join("entities/cow.json").is_file());
    assert!(!dev.join("Old_BP").exists());
    assert!(dev.join("handmade").exists());
    assert_eq!(warnings.len(), 1);
}

#[test]
fn install_leaves_foreign_folder_with_same_name() {
    let temp = Temp::new("foreign");
    let src = temp.0.join("Demo");
    project(&src);
    let packs = find_packs(&src).unwrap().packs;
    let install = com_mojang(&temp.0.join("com.mojang"));
    let mine = temp
        .0
        .join("com.mojang/development_behavior_packs/Demo_BP/keep.txt");
    write(&mine, "mine");
    let result = install_pack(&install, &packs[0], "Demo", &src).unwrap();
    assert!(matches!(result, Installed::Skipped(_)));
    assert!(mine.is_file());
}

#[test]
fn attach_appends_and_updates_without_losing_entries() {
    let temp = Temp::new("attach");
    let src = temp.0.join("Demo");
    project(&src);
    let packs = find_packs(&src).unwrap().packs;
    let install = com_mojang(&temp.0.join("com.mojang"));
    let manifests: Vec<_> = packs.iter().map(|p| &p.manifest).collect();

    attach(&install, "abc=", &manifests).unwrap();
    attach(&install, "abc=", &manifests).unwrap();

    let world = temp.0.join("com.mojang/minecraftWorlds/abc=");
    let bp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(world.join("world_behavior_packs.json")).unwrap())
            .unwrap();
    assert_eq!(
        bp,
        serde_json::json!([
            { "pack_id": "other", "version": [2, 0, 0] },
            { "pack_id": "bp-uuid", "version": [1, 0, 0] }
        ])
    );
    let rp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(world.join("world_resource_packs.json")).unwrap())
            .unwrap();
    assert_eq!(
        rp,
        serde_json::json!([{ "pack_id": "rp-uuid", "version": [1, 0, 0] }])
    );
}

#[test]
fn attach_refuses_broken_world_file_and_bad_ids() {
    let temp = Temp::new("attach-bad");
    let src = temp.0.join("Demo");
    project(&src);
    let packs = find_packs(&src).unwrap().packs;
    let install = com_mojang(&temp.0.join("com.mojang"));
    let world = temp.0.join("com.mojang/minecraftWorlds/abc=");
    write(&world.join("world_behavior_packs.json"), "[ broken");
    let manifests = [&packs[0].manifest];
    assert!(matches!(
        attach(&install, "abc=", &manifests),
        Err(PackError::WorldFile { .. })
    ));
    assert_eq!(
        fs::read_to_string(world.join("world_behavior_packs.json")).unwrap(),
        "[ broken"
    );
    assert!(matches!(
        attach(&install, "../abc=", &manifests),
        Err(PackError::WorldNotFound(_))
    ));
}

#[test]
fn lists_worlds_with_names() {
    let temp = Temp::new("worlds");
    let install = com_mojang(&temp.0.join("com.mojang"));
    write(
        &temp
            .0
            .join("com.mojang/minecraftWorlds/not-a-world/readme.txt"),
        "x",
    );
    let worlds = list_worlds(&install).unwrap();
    assert_eq!(worlds.len(), 1);
    assert_eq!(worlds[0].id, "abc=");
    assert_eq!(worlds[0].name, "My World");
    assert!(!worlds[0].has_icon);
}
