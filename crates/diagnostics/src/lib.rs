//! Problems in a workspace's packs, as the game would report them. Every folder holding a
//! manifest.json is opened as a pack, all packs are stacked together and loaded with
//! bedrock_addon, and each finding is mapped back to a workspace file and a line and column.

use std::collections::HashMap;

use bedrock_addon::diagnostic::{
    Diagnostic, JsonPath, JsonPathSegment, Severity as AddonSeverity, Span,
};
use bedrock_addon::json::{blank_bom, parse_at, span_at, JsonSlice, Value};
use bedrock_addon::load::LoadOptions;
use bedrock_addon::molang::MolangCheck;
use bedrock_addon::pack::{
    OpenError, OpenOptions, Pack, PackIdVersion, PackOrigin, PackRepository, PackSelection,
    PackType, WorldPacks,
};
use bedrock_addon::storage::PackPath;
use serde::Serialize;

const MANIFEST: &str = "manifest.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// One finding in one workspace file. Lines and columns are 1 based, the end is exclusive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub severity: Severity,
    pub message: String,
    /// Where inside the JSON document, like minecraft:block/components. Empty at the root.
    pub json_path: String,
}

/// A pack folder found in the workspace, "" when the manifest sits at the root.
struct PackDir<'a> {
    prefix: &'a str,
    files: Vec<(&'a str, &'a str)>,
}

/// Checks every pack in `files` (workspace path, contents) and returns what the game would
/// complain about, errors first. Files outside any pack are not looked at.
pub fn check<'a>(files: impl IntoIterator<Item = (&'a str, &'a str)>) -> Vec<Problem> {
    let files: Vec<(&str, &str)> = files.into_iter().collect();
    let texts: HashMap<&str, &str> = files.iter().copied().collect();
    let mut out = Problems {
        texts: &texts,
        problems: Vec::new(),
    };

    let mut repository = PackRepository::new();
    let mut prefixes: HashMap<PackIdVersion, &str> = HashMap::new();
    for dir in pack_dirs(&files) {
        match open(&dir) {
            Ok(pack) => {
                for finding in pack.report().diagnostics.iter() {
                    out.push(dir.prefix, finding);
                }
                prefixes.entry(pack.id().clone()).or_insert(dir.prefix);
                repository.add_pack(pack, PackOrigin::World);
            }
            Err(error) => out.open_error(dir.prefix, &error),
        }
    }

    let selection = every_pack(&repository);
    let options = LoadOptions {
        // with a molang check every molang field gets compiled while the stacks load
        molang: Some(std::sync::Arc::new(MolangCheck::new())),
        ..LoadOptions::default()
    };
    let stacks = repository.stacks(&selection, options);
    for finding in stacks.load_all().iter() {
        // yeah, a finding with no pack is about the base game layer, which we never stack
        let Some(prefix) = finding
            .location
            .pack
            .as_ref()
            .and_then(|pack| prefixes.get(pack.id()))
        else {
            continue;
        };
        out.push(prefix, finding);
    }

    // the game never reads some json (files outside a pack, ignored files) and some readers
    // report a syntax error without a position, so every json file gets its own syntax pass.
    // a file that doesn't parse only shows that, the rest would just be fallout from it
    for &(path, text) in &files {
        if !is_json(path) {
            continue;
        }
        if let Some(syntax) = json_syntax(path, text) {
            out.problems.retain(|p| p.path != path);
            out.problems.push(syntax);
        }
    }

    let mut problems = out.problems;
    problems.sort_by(|a, b| {
        (a.severity, &a.path, a.line, a.column).cmp(&(b.severity, &b.path, b.line, b.column))
    });
    problems.dedup();
    problems
}

/// Groups files under the deepest folder holding a manifest.json.
fn pack_dirs<'a>(files: &[(&'a str, &'a str)]) -> Vec<PackDir<'a>> {
    let mut dirs: Vec<PackDir<'a>> = files
        .iter()
        .filter_map(|(path, _)| {
            let prefix = path.strip_suffix(MANIFEST)?;
            (prefix.is_empty() || prefix.ends_with('/')).then_some(PackDir {
                prefix,
                files: Vec::new(),
            })
        })
        .collect();
    // longest prefix first, so a nested pack wins over the folder around it
    dirs.sort_by_key(|dir| std::cmp::Reverse(dir.prefix.len()));
    for &(path, text) in files {
        if let Some(dir) = dirs.iter_mut().find(|dir| path.starts_with(dir.prefix)) {
            dir.files.push((&path[dir.prefix.len()..], text));
        }
    }
    dirs
}

fn open(dir: &PackDir<'_>) -> Result<Pack, OpenError> {
    let files = dir.files.iter().filter_map(|&(path, text)| {
        let path = PackPath::new(path).ok()?;
        Some((path, text.as_bytes().to_vec()))
    });
    Pack::from_files(files, &OpenOptions::default())
}

/// Turns on every behavior and resource pack, the way a test world with all of them applied would.
fn every_pack(repository: &PackRepository) -> WorldPacks {
    let of_type = |kind: PackType| {
        repository
            .packs()
            .filter(|pack| pack.pack_type() == kind)
            .map(|pack| PackSelection {
                pack_id: pack.id().uuid,
                version: pack.id().version.clone(),
                subpack: None,
            })
            .collect()
    };
    WorldPacks {
        behavior: of_type(PackType::Behavior),
        resource: of_type(PackType::Resource),
    }
}

fn at_span(path: String, text: &str, span: Span, severity: Severity, message: String) -> Problem {
    let (line, column) = span.line_col(text);
    let (end_line, end_column) = Span {
        offset: span.offset.saturating_add(span.len),
        len: 0,
    }
    .line_col(text);
    Problem {
        path,
        line,
        column,
        end_line,
        end_column,
        severity,
        message,
        json_path: String::new(),
    }
}

/// The syntax error in a json file, read the way the game reads json (comments and trailing
/// commas are fine).
fn json_syntax(path: &str, text: &str) -> Option<Problem> {
    // hmm, these helpers are doc(hidden) in bedrock_addon, fine while the rev is pinned.
    // blank_bom keeps offsets pointing into the file as written
    let bytes = blank_bom(text.as_bytes());
    let read = std::str::from_utf8(&bytes).ok()?;
    let error = parse_at::<Value>(JsonSlice::new(read)).err()?;
    let message = format!("Invalid JSON: {}", error.error);
    Some(at_span(
        path.to_owned(),
        text,
        error.span,
        Severity::Error,
        message,
    ))
}

/// Where `path` is in `text`, for findings that come with a JSON path but no byte span. When the
/// last steps aren't in the file (a missing member, a value the reader made up like the `value`
/// of a shorthand) it falls back to the deepest part that is.
fn locate(text: &str, path: &JsonPath) -> Option<Span> {
    let segments: Vec<JsonPathSegment<'_>> = path.segments().collect();
    if segments.is_empty() {
        return None;
    }
    let bytes = blank_bom(text.as_bytes());
    let read = std::str::from_utf8(&bytes).ok()?;
    (1..=segments.len()).rev().find_map(|depth| {
        let mut prefix = JsonPath::new();
        for segment in &segments[..depth] {
            match segment {
                JsonPathSegment::Key(key) => prefix.push(key),
                JsonPathSegment::Index(index) => prefix.push_index(*index),
            }
        }
        span_at(JsonSlice::new(read), &prefix)
    })
}

fn is_json(path: &str) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, ext)| ext.eq_ignore_ascii_case("json"))
}

struct Problems<'a> {
    texts: &'a HashMap<&'a str, &'a str>,
    problems: Vec<Problem>,
}

impl Problems<'_> {
    fn push(&mut self, prefix: &str, finding: &Diagnostic) {
        // ok so info is lints and lines the game only logs sometimes, mostly noise without the
        // vanilla packs underneath, same cut shulker makes by default
        let severity = match finding.severity {
            AddonSeverity::Error => Severity::Error,
            AddonSeverity::Warning => Severity::Warning,
            AddonSeverity::Info | AddonSeverity::Debug => return,
        };
        let file = finding
            .location
            .path
            .as_ref()
            .map_or(MANIFEST, PackPath::as_str);
        let path = format!("{prefix}{file}");
        let text = self.texts.get(path.as_str()).copied().unwrap_or("");
        let mut message = finding.code.to_string();
        if let Some(detail) = finding.detail.as_deref() {
            message.push_str(&detail.to_string());
        }
        let span = finding
            .location
            .span
            .or_else(|| locate(text, &finding.location.json_path))
            .unwrap_or_default();
        let problem = at_span(path, text, span, severity, message);
        self.problems.push(Problem {
            json_path: finding.location.json_path.to_string(),
            ..problem
        });
    }

    fn open_error(&mut self, prefix: &str, error: &OpenError) {
        if let OpenError::InvalidManifest { report, .. } = error {
            for finding in report.diagnostics.iter() {
                self.push(prefix, finding);
            }
            if report.diagnostics.has_errors() {
                return;
            }
        }
        self.problems.push(Problem {
            path: format!("{prefix}{MANIFEST}"),
            line: 1,
            column: 1,
            end_line: 1,
            end_column: 1,
            severity: Severity::Error,
            message: error.to_string(),
            json_path: String::new(),
        });
    }
}
