use wither_diagnostics::{check, Problem, Severity};

fn sample_files() -> Vec<(String, String)> {
    wither_workspace::sample::bedrock_workspace()
        .text_files()
        .map(|(path, text)| (path.to_owned(), text.to_owned()))
        .collect()
}

fn check_owned(files: &[(String, String)]) -> Vec<Problem> {
    check(
        files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str())),
    )
}

fn edit(files: &mut [(String, String)], path: &str, change: impl FnOnce(&str) -> String) {
    let (_, text) = files.iter_mut().find(|(p, _)| p == path).expect("file");
    *text = change(text);
}

#[test]
fn the_sample_workspace_is_clean() {
    assert_eq!(check_owned(&sample_files()), []);
}

#[test]
fn a_json_typo_is_an_error_where_it_was_typed() {
    let mut files = sample_files();
    edit(
        &mut files,
        "behavior_pack/entities/wither_knight.json",
        |text| text.replacen("\"minecraft:entity\"", "\"minecraft:entity\" oops", 1),
    );
    let problems = check_owned(&files);
    let [problem] = problems.as_slice() else {
        panic!("one problem, got {problems:?}");
    };
    assert_eq!(problem.path, "behavior_pack/entities/wither_knight.json");
    assert_eq!(problem.severity, Severity::Error);
    assert_eq!((problem.line, problem.column), (3, 22));
    assert!(
        problem.message.starts_with("Invalid JSON"),
        "{}",
        problem.message
    );
}

#[test]
fn a_script_syntax_error_is_reported() {
    let mut files = sample_files();
    edit(&mut files, "behavior_pack/scripts/main.js", |text| {
        format!("{text}\nconst broken = ;\n")
    });
    let problems = check_owned(&files);
    assert!(
        problems
            .iter()
            .any(|p| p.path == "behavior_pack/scripts/main.js" && p.severity == Severity::Error),
        "{problems:?}"
    );
}

#[test]
fn json_outside_a_pack_is_still_syntax_checked() {
    let lenient = "{\n  // a comment\n  \"a\": [1, 2,],\n}";
    assert_eq!(check([("notes/config.json", lenient)]), []);

    let problems = check([("notes/config.json", "{\n  \"a\": }")]);
    let [problem] = problems.as_slice() else {
        panic!("one problem, got {problems:?}");
    };
    assert_eq!((problem.line, problem.column), (2, 8));
}

#[test]
fn a_broken_manifest_is_reported_on_the_manifest() {
    let mut files = sample_files();
    edit(&mut files, "resource_pack/manifest.json", |_| {
        "{}".to_owned()
    });
    let problems = check_owned(&files);
    assert!(
        problems
            .iter()
            .any(|p| p.path == "resource_pack/manifest.json" && p.severity == Severity::Error),
        "{problems:?}"
    );
}

#[test]
fn a_finding_without_a_span_lands_on_its_json_path() {
    let mut files = sample_files();
    edit(
        &mut files,
        "behavior_pack/items/withered_blade.json",
        |text| {
            text.replacen(
                "\"minecraft:max_stack_size\": 1",
                "\"minecraft:max_stack_size\": 500",
                1,
            )
        },
    );
    let problems = check_owned(&files);
    let [problem] = problems.as_slice() else {
        panic!("one problem, got {problems:?}");
    };
    assert_eq!((problem.line, problem.column), (10, 35));
    assert_eq!((problem.end_line, problem.end_column), (10, 38));
}
