//! Regenerates data/script_api.json from the game's script module metadata, the
//! docs/script_modules folder a dedicated server writes (or metadata/script_modules from
//! Mojang's bedrock-samples).
//!
//! cargo run -p wither-completion --example script_api -- <script_modules/@minecraft> [out.json]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use bedrock_addon::families::script::meta::ModuleMetadata;
use wither_completion::script_api::module_api;

fn main() {
    let mut args = std::env::args_os().skip(1);
    let Some(dir) = args.next().map(PathBuf::from) else {
        eprintln!("usage: script_api <script_modules/@minecraft> [out.json]");
        std::process::exit(2);
    };
    let out = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("data/script_api.json"));

    // file stem is "<module>_<version>", the module name gets its scope back
    let mut files: BTreeMap<(String, String), PathBuf> = BTreeMap::new();
    for entry in std::fs::read_dir(&dir).expect("read metadata folder") {
        let path = entry.expect("read entry").path();
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some((module, version)) = stem.rsplit_once('_') else {
            continue;
        };
        if path.extension().is_some_and(|ext| ext == "json") {
            files.insert((format!("@minecraft/{module}"), version.to_owned()), path);
        }
    }

    // ok so packs import the public name, the declarations sit in "<name>-bindings" of the
    // same version when there is one. editor and private modules aren't for packs
    let mut newest: BTreeMap<&str, &str> = BTreeMap::new();
    for (name, version) in files.keys() {
        if name.contains("bindings") || name.contains("editor") || version.contains('-') {
            continue;
        }
        let slot = newest.entry(name).or_insert(version);
        if numeric(version) > numeric(slot) {
            *slot = version;
        }
    }

    let mut modules = Vec::new();
    for (name, version) in newest {
        let bindings = (format!("{name}-bindings"), version.to_owned());
        let path = files
            .get(&bindings)
            .unwrap_or(&files[&(name.to_owned(), version.to_owned())]);
        let bytes = std::fs::read(path).expect("read module file");
        match ModuleMetadata::parse(&samples_shape(&bytes)) {
            Ok(ModuleMetadata::Native(native)) => {
                eprintln!("{name} {version} from {}", path.display());
                modules.push(module_api(name, version, &native));
            }
            Ok(_) => eprintln!("skipping {name} {version}, {} is a stub", path.display()),
            Err(error) => eprintln!("skipping {name} {version}: {error}"),
        }
    }
    let json = serde_json::to_string(&modules).expect("serialize");
    std::fs::write(&out, json + "\n").expect("write output");
    eprintln!("wrote {}", out.display());
}

/// hmm, the reader follows bedrock-samples, a server's docs folder adds `minecraft_version`
/// and `version` at the top which the strict reader refuses, so they go before parsing
fn samples_shape(bytes: &[u8]) -> Vec<u8> {
    let mut json: serde_json::Value = serde_json::from_slice(bytes).expect("module file is json");
    if let Some(object) = json.as_object_mut() {
        object.remove("minecraft_version");
        object.remove("version");
    }
    serde_json::to_vec(&json).expect("serialize")
}

fn numeric(version: &str) -> Vec<u32> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}
