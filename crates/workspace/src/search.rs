use serde::Serialize;

const MAX_PREVIEW_CHARS: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
    pub match_start: usize,
    pub match_len: usize,
}

/// Case insensitive substring search. Lines and columns are 1 based, while
/// match_start indexes chars inside the trimmed preview so the UI can highlight it.
pub fn search_files<'a>(
    files: impl Iterator<Item = (&'a str, &'a str)>,
    query: &str,
    limit: usize,
) -> Vec<SearchMatch> {
    let needle: Vec<char> = query.trim().to_lowercase().chars().collect();
    if needle.is_empty() {
        return Vec::new();
    }

    let mut matches = Vec::new();
    for (path, text) in files {
        for (line_index, line) in text.lines().enumerate() {
            let lowered: Vec<char> = line.to_lowercase().chars().collect();
            let Some(col) = find(&lowered, &needle) else {
                continue;
            };
            let original: Vec<char> = line.chars().collect();
            let indent = original.iter().take_while(|c| c.is_whitespace()).count();
            let preview: String = original
                .iter()
                .skip(indent)
                .take(MAX_PREVIEW_CHARS)
                .collect();
            matches.push(SearchMatch {
                path: path.to_owned(),
                line: line_index + 1,
                column: col + 1,
                preview,
                match_start: col.saturating_sub(indent),
                match_len: needle.len(),
            });
            if matches.len() >= limit {
                return matches;
            }
        }
    }
    matches
}

fn find(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_case_insensitive_matches_with_positions() {
        let files = [("a.json", "{\n    \"Identifier\": \"wither:boss\"\n}")];
        let found = search_files(files.into_iter(), "identifier", 10);
        assert_eq!(found.len(), 1);
        let m = &found[0];
        assert_eq!((m.line, m.column), (2, 6));
        assert_eq!(m.preview, "\"Identifier\": \"wither:boss\"");
        assert_eq!(m.match_start, 1);
    }

    #[test]
    fn respects_limit_and_blank_queries() {
        let files = [("a", "x\nx\nx")];
        assert_eq!(search_files(files.into_iter(), "x", 2).len(), 2);
        assert!(search_files(files.into_iter(), "   ", 10).is_empty());
    }
}
