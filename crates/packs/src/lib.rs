//! Everything between a pack folder and the game: reading manifests, .mcaddon / .mcpack
//! archives, finding Minecraft installs and their worlds, copying packs into the
//! development folders and starting the game. No Tauri in here so it all tests headless.

mod archive;
mod discover;
mod fsutil;
mod install;
mod launch;
mod manifest;
mod worlds;

use std::io;
use std::path::Path;

use serde::Serialize;

pub use archive::{export_mcaddon, export_mcpack, import, import_target};
pub use discover::{find_packs, Discovery, FoundPack};
pub use install::{detect, install_pack, Install, Installed};
pub use launch::{is_running, launch};
pub use manifest::{Manifest, PackKind};
pub use worlds::{attach, list_worlds, world_icon, World};

#[derive(Debug, thiserror::Error)]
pub enum PackError {
    #[error("{path}: {message}")]
    Manifest { path: String, message: String },
    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: io::Error,
    },
    #[error("{path}: {message}")]
    Zip { path: String, message: String },
    #[error("archive entry {0} points outside the target folder")]
    UnsafeEntry(String),
    #[error("archive is bigger than {} MB once unpacked", archive::MAX_UNPACKED_BYTES / (1024 * 1024))]
    TooBig,
    #[error("{0} is not empty, pick an empty folder to import into")]
    TargetNotEmpty(String),
    #[error("no pack (folder with a manifest.json) found in {0}")]
    NoPacks(String),
    #[error("world {0} was not found")]
    WorldNotFound(String),
    #[error("{path} is not valid JSON, fix or delete it first: {message}")]
    WorldFile { path: String, message: String },
    #[error("no Minecraft launcher found, set a launch command in Settings")]
    LauncherNotFound,
    #[error("could not start {0}: {1}")]
    Launch(String, io::Error),
}

impl PackError {
    pub(crate) fn io(path: &Path, source: io::Error) -> Self {
        Self::Io {
            path: path.display().to_string(),
            source,
        }
    }
}

pub type Result<T> = std::result::Result<T, PackError>;

/// What a test run did, shown line by line in the output log.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    pub installed: Vec<String>,
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
    pub attached_to: Option<String>,
    pub launched: bool,
}
