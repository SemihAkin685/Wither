use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{self, Cursor, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::discover::FoundPack;
use crate::fsutil::{files_under, sanitize, unique_child};
use crate::{PackError, Result};

/// Imports stop past this, a zip bomb shouldn't be able to fill the disk.
pub(crate) const MAX_UNPACKED_BYTES: u64 = 1024 * 1024 * 1024;

/// Writes one pack as a .mcpack, its files at the archive root.
pub fn export_mcpack(pack: &FoundPack, out: &Path) -> Result<()> {
    write_zip(out, |zip| add_dir(zip, &pack.dir, ""))
}

/// Writes several packs as a .mcaddon, one folder per pack.
pub fn export_mcaddon(packs: &[FoundPack], out: &Path) -> Result<()> {
    let mut used = BTreeSet::new();
    write_zip(out, |zip| {
        for pack in packs {
            let mut folder = pack.folder.clone();
            let mut n = 2;
            while !used.insert(folder.clone()) {
                folder = format!("{}_{n}", pack.folder);
                n += 1;
            }
            add_dir(zip, &pack.dir, &format!("{folder}/"))?;
        }
        Ok(())
    })
}

fn write_zip(out: &Path, fill: impl FnOnce(&mut ZipWriter<File>) -> Result<()>) -> Result<()> {
    // ok so write next to the target and rename at the end, a failed export never leaves half a zip
    let mut tmp = out.as_os_str().to_owned();
    tmp.push(".part");
    let tmp = PathBuf::from(tmp);
    let result = (|| {
        let file = File::create(&tmp).map_err(|e| PackError::io(&tmp, e))?;
        let mut zip = ZipWriter::new(file);
        fill(&mut zip)?;
        zip.finish().map_err(|e| zip_error(out, e))?;
        fs::rename(&tmp, out).map_err(|e| PackError::io(out, e))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn add_dir(zip: &mut ZipWriter<File>, dir: &Path, prefix: &str) -> Result<()> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (rel, path) in files_under(dir)? {
        let name = format!("{prefix}{rel}");
        zip.start_file(&name, options)
            .map_err(|e| zip_error(&path, e))?;
        let mut file = File::open(&path).map_err(|e| PackError::io(&path, e))?;
        io::copy(&mut file, zip).map_err(|e| PackError::io(&path, e))?;
    }
    Ok(())
}

/// Where importing `archive` into a folder the user picked should land: the folder itself
/// when it's empty, otherwise a new subfolder named after the archive.
pub fn import_target(archive: &Path, picked: &Path) -> PathBuf {
    let empty = fs::read_dir(picked).is_ok_and(|mut e| e.next().is_none());
    if empty {
        return picked.to_path_buf();
    }
    let stem = archive
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    unique_child(picked, &sanitize(&stem))
}

/// Unpacks a .mcaddon, .mcpack or .zip into `target`, one folder per pack, and returns the
/// pack folders. `target` has to be empty (or not exist yet) so nothing gets overwritten.
pub fn import(archive: &Path, target: &Path) -> Result<Vec<PathBuf>> {
    if target.exists() {
        let mut entries = fs::read_dir(target).map_err(|e| PackError::io(target, e))?;
        if entries.next().is_some() {
            return Err(PackError::TargetNotEmpty(target.display().to_string()));
        }
    }
    fs::create_dir_all(target).map_err(|e| PackError::io(target, e))?;
    let file = File::open(archive).map_err(|e| PackError::io(archive, e))?;
    let stem = archive
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut budget = MAX_UNPACKED_BYTES;
    let packs = extract(file, archive, &stem, target, true, &mut budget)?;
    if packs.is_empty() {
        return Err(PackError::NoPacks(archive.display().to_string()));
    }
    Ok(packs)
}

struct Entry {
    index: usize,
    path: PathBuf,
}

fn extract<R: Read + Seek>(
    reader: R,
    label: &Path,
    stem: &str,
    target: &Path,
    allow_nested: bool,
    budget: &mut u64,
) -> Result<Vec<PathBuf>> {
    let mut zip = ZipArchive::new(reader).map_err(|e| zip_error(label, e))?;
    let mut files = Vec::new();
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|e| zip_error(label, e))?;
        let raw = entry.name().map(|n| n.to_string()).unwrap_or_default();
        if entry.is_symlink() {
            return Err(PackError::UnsafeEntry(raw));
        }
        let path = entry
            .enclosed_name()
            .and_then(|p| safe_relative(&p))
            .ok_or(PackError::UnsafeEntry(raw))?;
        if !entry.is_dir() {
            files.push(Entry { index, path });
        }
    }

    // a pack root is the shallowest folder holding a manifest.json, anything nested in it is just content
    let mut roots: Vec<PathBuf> = files
        .iter()
        .filter(|e| e.path.file_name().is_some_and(|n| n == "manifest.json"))
        .map(|e| e.path.parent().unwrap_or(Path::new("")).to_path_buf())
        .collect();
    roots.sort_by_key(|r| r.components().count());
    let mut pack_roots: Vec<PathBuf> = Vec::new();
    for root in roots {
        if !pack_roots.iter().any(|p| root.starts_with(p)) {
            pack_roots.push(root);
        }
    }

    let mut out = Vec::new();
    let mut dests = Vec::new();
    for root in &pack_roots {
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| stem.to_owned());
        let dest = unique_child(target, &sanitize(&name));
        fs::create_dir_all(&dest).map_err(|e| PackError::io(&dest, e))?;
        out.push(dest.clone());
        dests.push(dest);
    }

    for entry in &files {
        let owner = pack_roots.iter().position(|r| entry.path.starts_with(r));
        let mut file = zip.by_index(entry.index).map_err(|e| zip_error(label, e))?;
        match owner {
            Some(i) => {
                let rel = entry
                    .path
                    .strip_prefix(&pack_roots[i])
                    .unwrap_or(&entry.path);
                let dest = dests[i].join(rel);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| PackError::io(parent, e))?;
                }
                let mut sink = File::create(&dest).map_err(|e| PackError::io(&dest, e))?;
                copy_limited(&mut file, &mut sink, budget).map_err(|e| match e {
                    CopyError::TooBig => PackError::TooBig,
                    CopyError::Io(e) => PackError::io(&dest, e),
                })?;
            }
            // hmm, some .mcaddon files ship each pack as a .mcpack inside instead of a folder
            None if allow_nested && is_mcpack(&entry.path) => {
                let mut bytes = Vec::new();
                copy_limited(&mut file, &mut bytes, budget).map_err(|e| match e {
                    CopyError::TooBig => PackError::TooBig,
                    CopyError::Io(e) => PackError::io(label, e),
                })?;
                let inner_stem = entry
                    .path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let inner_label = label.join(&entry.path);
                out.extend(extract(
                    Cursor::new(bytes),
                    &inner_label,
                    &inner_stem,
                    target,
                    false,
                    budget,
                )?);
            }
            None => {}
        }
    }
    Ok(out)
}

fn is_mcpack(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("mcpack") || e.eq_ignore_ascii_case("zip"))
}

// enclosed_name already refuses absolute paths and escaping, this also drops `a/../b` style detours
fn safe_relative(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

enum CopyError {
    TooBig,
    Io(io::Error),
}

fn copy_limited(
    from: &mut impl Read,
    to: &mut impl Write,
    budget: &mut u64,
) -> std::result::Result<(), CopyError> {
    // the size in the zip header can lie, so count what actually comes out
    let copied = io::copy(&mut from.take(*budget + 1), to).map_err(CopyError::Io)?;
    if copied > *budget {
        return Err(CopyError::TooBig);
    }
    *budget -= copied;
    Ok(())
}

fn zip_error(path: &Path, error: zip::result::ZipError) -> PackError {
    PackError::Zip {
        path: path.display().to_string(),
        message: error.to_string(),
    }
}
