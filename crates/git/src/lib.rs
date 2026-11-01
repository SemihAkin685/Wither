//! Thin wrapper around the git CLI. Shelling out keeps us in sync with whatever
//! config, hooks and credential helpers the user already has.

use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git is not installed or not on PATH")]
    NotInstalled,
    #[error("invalid branch name: {0}")]
    InvalidBranch(String),
    #[error("unknown branch: {0}")]
    UnknownBranch(String),
    #[error("the repository has no commits yet, commit something before creating branches")]
    NoCommits,
    #[error("{0}")]
    Failed(String),
    #[error(transparent)]
    Io(std::io::Error),
}

pub type Result<T> = std::result::Result<T, GitError>;

/// What the title bar needs to know about a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub root: String,
    /// Branch name, or the short commit hash when HEAD is detached.
    pub head: String,
    pub detached: bool,
    /// True right after git init. The current branch is only a name until the
    /// first commit, so there is nothing to branch from or switch back to.
    pub unborn: bool,
    pub local_branches: Vec<String>,
    pub remote_branches: Vec<String>,
}

fn run(dir: &Path, args: &[&str]) -> Result<Output> {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        // never hang on a credential prompt, and keep messages in english so they read the same everywhere
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => GitError::NotInstalled,
            _ => GitError::Io(error),
        })
}

fn run_ok(dir: &Path, args: &[&str]) -> Result<String> {
    let output = run(dir, args)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = stderr
        .lines()
        .map(|line| {
            line.trim_start_matches("fatal: ")
                .trim_start_matches("error: ")
        })
        .find(|line| !line.is_empty())
        .unwrap_or("git command failed");
    Err(GitError::Failed(message.to_owned()))
}

fn lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Reads the repository that contains `dir`. Returns `None` when `dir` is missing
/// or not inside a work tree, so callers can offer to create one.
pub fn status(dir: &Path) -> Result<Option<RepoStatus>> {
    if !dir.is_dir() {
        return Ok(None);
    }
    let output = run(dir, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_owned();

    // symbolic-ref also works on an unborn branch right after git init, rev-parse would not
    let symbolic = run(dir, &["symbolic-ref", "--short", "-q", "HEAD"])?;
    let (head, detached) = if symbolic.status.success() {
        (
            String::from_utf8_lossy(&symbolic.stdout).trim().to_owned(),
            false,
        )
    } else {
        (run_ok(dir, &["rev-parse", "--short", "HEAD"])?, true)
    };

    let unborn = !detached
        && !run(dir, &["rev-parse", "--verify", "-q", "HEAD"])?
            .status
            .success();

    let mut local_branches = lines(&run_ok(
        dir,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?);
    if !detached && !local_branches.contains(&head) {
        local_branches.insert(0, head.clone());
    }
    let remote_branches = lines(&run_ok(
        dir,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    )?)
    .into_iter()
    // origin/HEAD is just a pointer, listing it as a branch is noise
    .filter(|b| !b.ends_with("/HEAD") && b.contains('/'))
    .collect();

    Ok(Some(RepoStatus {
        root,
        head,
        detached,
        unborn,
        local_branches,
        remote_branches,
    }))
}

/// Creates an empty repository at `dir`, making the folder first if needed.
pub fn init(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir).map_err(GitError::Io)?;
    run_ok(dir, &["init"])?;
    Ok(())
}

fn validate_branch(dir: &Path, name: &str) -> Result<()> {
    // a leading dash would be parsed as an option by every command below
    if name.is_empty() || name.starts_with('-') {
        return Err(GitError::InvalidBranch(name.to_owned()));
    }
    run_ok(dir, &["check-ref-format", "--branch", name])
        .map(drop)
        .map_err(|_| GitError::InvalidBranch(name.to_owned()))
}

/// Switches to a local branch, or to a remote one by creating a tracking branch.
/// Only names that `status` reported are accepted.
pub fn checkout(dir: &Path, branch: &str) -> Result<()> {
    let repo = status(dir)?.ok_or_else(|| GitError::Failed("not a git repository".into()))?;
    if repo.local_branches.iter().any(|b| b == branch) {
        run_ok(dir, &["switch", branch])?;
    } else if repo.remote_branches.iter().any(|b| b == branch) {
        run_ok(dir, &["switch", "--track", branch])?;
    } else {
        return Err(GitError::UnknownBranch(branch.to_owned()));
    }
    Ok(())
}

/// Creates a branch from the current HEAD and optionally switches to it.
pub fn create_branch(dir: &Path, name: &str, switch: bool) -> Result<()> {
    validate_branch(dir, name)?;
    // switch -c on an unborn HEAD just renames the pending branch, which looks like the old one vanished
    if status(dir)?.is_some_and(|repo| repo.unborn) {
        return Err(GitError::NoCommits);
    }
    if switch {
        run_ok(dir, &["switch", "-c", name])?;
    } else {
        run_ok(dir, &["branch", name])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!(
                "wither-git-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&path);
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn repo_with_commit() -> TempDir {
        let dir = TempDir::new();
        init(&dir.0).unwrap();
        for args in [
            &["symbolic-ref", "HEAD", "refs/heads/master"][..],
            &[
                "-c",
                "user.name=test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "--allow-empty",
                "-m",
                "init",
            ],
        ] {
            run_ok(&dir.0, args).unwrap();
        }
        dir
    }

    #[test]
    fn missing_folder_is_not_a_repo() {
        let dir = TempDir::new();
        assert_eq!(status(&dir.0).unwrap(), None);
    }

    #[test]
    fn init_creates_folder_and_reports_unborn_branch() {
        let dir = TempDir::new();
        let nested = dir.0.join("addon");
        init(&nested).unwrap();
        let repo = status(&nested).unwrap().unwrap();
        assert!(!repo.detached);
        assert!(repo.unborn);
        assert_eq!(repo.local_branches, vec![repo.head.clone()]);
    }

    #[test]
    fn create_and_checkout_branches() {
        let dir = repo_with_commit();
        assert!(!status(&dir.0).unwrap().unwrap().unborn);
        create_branch(&dir.0, "feature/knight", true).unwrap();
        assert_eq!(status(&dir.0).unwrap().unwrap().head, "feature/knight");

        checkout(&dir.0, "master").unwrap();
        let repo = status(&dir.0).unwrap().unwrap();
        assert_eq!(repo.head, "master");
        assert_eq!(repo.local_branches, vec!["feature/knight", "master"]);
    }

    #[test]
    fn refuses_branches_before_first_commit() {
        let dir = TempDir::new();
        init(&dir.0).unwrap();
        let before = status(&dir.0).unwrap().unwrap();
        assert!(matches!(
            create_branch(&dir.0, "feature", true),
            Err(GitError::NoCommits)
        ));
        assert_eq!(status(&dir.0).unwrap().unwrap(), before);
    }

    #[test]
    fn rejects_bad_and_unknown_branches() {
        let dir = repo_with_commit();
        assert!(matches!(
            create_branch(&dir.0, "--force", true),
            Err(GitError::InvalidBranch(_))
        ));
        assert!(matches!(
            create_branch(&dir.0, "bad..name", true),
            Err(GitError::InvalidBranch(_))
        ));
        assert!(matches!(
            checkout(&dir.0, "nope"),
            Err(GitError::UnknownBranch(_))
        ));
    }
}
