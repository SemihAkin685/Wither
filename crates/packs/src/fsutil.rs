use std::fs;
use std::path::{Path, PathBuf};

use crate::{PackError, Result};

/// Names that never leave the project: version control, build output and dotfiles.
pub(crate) fn is_skipped(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target")
}

/// Turns anything into a folder name that works on every OS. Keeps letters, digits,
/// spaces, dots, dashes and underscores, everything else becomes `_`.
pub(crate) fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    // hmm, Windows hates trailing dots and spaces, and a bare ".." would be a disaster
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == ' ');
    if trimmed.is_empty() {
        "pack".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Every file under `dir` as (relative path with `/` separators, absolute path).
/// Symlinks and skipped names are left out.
pub(crate) fn files_under(dir: &Path) -> Result<Vec<(String, PathBuf)>> {
    let mut out = Vec::new();
    collect(dir, "", &mut out)?;
    out.sort();
    Ok(out)
}

fn collect(dir: &Path, prefix: &str, out: &mut Vec<(String, PathBuf)>) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(|e| PackError::io(dir, e))? {
        let entry = entry.map_err(|e| PackError::io(dir, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_skipped(&name) {
            continue;
        }
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| PackError::io(&path, e))?;
        let rel = format!("{prefix}{name}");
        if kind.is_dir() {
            collect(&path, &format!("{rel}/"), out)?;
        } else if kind.is_file() {
            out.push((rel, path));
        }
    }
    Ok(())
}

pub(crate) fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    for (rel, src) in files_under(from)? {
        let dest = to.join(&rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| PackError::io(parent, e))?;
        }
        fs::copy(&src, &dest).map_err(|e| PackError::io(&dest, e))?;
    }
    Ok(())
}

/// Writes through a temp file next to the target, so a crash leaves the old file intact.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".wither-tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes).map_err(|e| PackError::io(&tmp, e))?;
    fs::rename(&tmp, path).map_err(|e| PackError::io(path, e))
}

/// A child of `parent` named `name` that doesn't exist yet, `name_2`, `name_3`... otherwise.
pub(crate) fn unique_child(parent: &Path, name: &str) -> PathBuf {
    let first = parent.join(name);
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| parent.join(format!("{name}_{n}")))
        .find(|p| !p.exists())
        .expect("ran out of numbers")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_keeps_it_safe() {
        assert_eq!(sanitize("My Pack (BP)"), "My Pack _BP_");
        assert_eq!(sanitize(".."), "pack");
        assert_eq!(sanitize("a/b\\c"), "a_b_c");
        assert_eq!(sanitize("name. "), "name");
    }
}
