//! "Initialize Git" for an existing folder: a default `.gitignore`, an
//! optional first commit with content, and a warning for cloud-sync folders.
//! See `docs/developer/plain-projects.md`.

use serde::Serialize;
use std::path::Path;

use crate::platform::wsl_aware_command;

/// Written as `.gitignore` when the folder has none. Kept short: OS junk,
/// editor/temp files, and a commented block for large binaries.
pub const DEFAULT_GITIGNORE: &str = "\
# Created by Splitkick when this folder became a git repository.

# OS files
.DS_Store
.AppleDouble
.LSOverride
._*
.Spotlight-V100
.Trashes
Thumbs.db
ehthumbs.db
desktop.ini
$RECYCLE.BIN/

# Editor and temp files
*~
*.swp
*.swo
*.tmp
*.bak
.~lock.*#
~$*

# Large binaries: remove the \"# \" in front of a line to stop tracking them.
# *.pdf
# *.zip
# *.dmg
# *.iso
# *.mp4
# *.mov
# *.psd
";

/// Stop counting files after this many, so a huge folder does not block the
/// dialog. The preview then shows "more than N files".
const PREVIEW_FILE_LIMIT: u64 = 20_000;

/// What the "Initialize Git" dialog shows before anything changes on disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitInitPreview {
    /// Files the first commit would add (after `.gitignore`).
    pub file_count: u64,
    /// Their total size in bytes.
    pub total_bytes: u64,
    /// True when counting stopped at the limit.
    pub truncated: bool,
    /// The folder already has a `.gitignore` (kept unchanged).
    pub has_gitignore: bool,
    /// Cloud-sync service the folder is inside of, e.g. "iCloud Drive".
    pub sync_provider: Option<String>,
}

/// Name of the cloud-sync service that `path` is inside of, from the path
/// alone. Git inside a synced folder can corrupt `.git` across machines.
pub fn sync_folder_provider(path: &Path) -> Option<&'static str> {
    let mut previous = String::new();
    // Split on both separators, so a Windows path is checked the same way on
    // every OS (and in tests).
    let path = path.to_string_lossy().to_lowercase();
    for part in path.split(['/', '\\']) {
        let part = part.to_string();
        // macOS File Provider folders: ~/Library/CloudStorage/Dropbox-Name etc.
        let in_cloud_storage = previous == "cloudstorage";
        let provider = if part == "mobile documents" && previous == "library"
            || part == "icloud drive"
            || part == "iclouddrive"
            || part == "com~apple~clouddocs"
            || in_cloud_storage && part.starts_with("icloud")
        {
            Some("iCloud Drive")
        } else if part == "dropbox"
            || part.starts_with("dropbox (")
            || in_cloud_storage && part.starts_with("dropbox")
        {
            Some("Dropbox")
        } else if part == "onedrive"
            || part.starts_with("onedrive - ")
            || in_cloud_storage && part.starts_with("onedrive")
        {
            Some("OneDrive")
        } else if part == "google drive"
            || part == "my drive"
            || in_cloud_storage && part.starts_with("googledrive")
        {
            Some("Google Drive")
        } else {
            None
        };
        if provider.is_some() {
            return provider;
        }
        previous = part;
    }
    None
}

/// Count what the first commit would add, honoring the folder's own
/// `.gitignore` or, when it has none, [`DEFAULT_GITIGNORE`].
pub fn inspect_git_init_folder(path: &str) -> Result<GitInitPreview, String> {
    let root = Path::new(path);
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }
    let has_gitignore = root.join(".gitignore").is_file();

    let mut defaults = ignore::gitignore::GitignoreBuilder::new(root);
    if !has_gitignore {
        for line in DEFAULT_GITIGNORE.lines() {
            defaults
                .add_line(None, line)
                .map_err(|e| format!("Invalid default .gitignore line: {e}"))?;
        }
    }
    let defaults = defaults
        .build()
        .map_err(|e| format!("Failed to build .gitignore rules: {e}"))?;

    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .git_global(false)
        .git_exclude(false)
        .ignore(false)
        .parents(false)
        .filter_entry(move |entry| {
            let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
            entry.file_name() != ".git"
                && !defaults
                    .matched_path_or_any_parents(entry.path(), is_dir)
                    .is_ignore()
        })
        .build();

    let mut preview = GitInitPreview {
        file_count: 0,
        total_bytes: 0,
        truncated: false,
        has_gitignore,
        sync_provider: sync_folder_provider(root).map(str::to_string),
    };
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if preview.file_count >= PREVIEW_FILE_LIMIT {
            preview.truncated = true;
            break;
        }
        preview.file_count += 1;
        preview.total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
    }
    Ok(preview)
}

fn run_git(path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    wsl_aware_command("git", Some(path))
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git {}: {e}", args.join(" ")))
}

/// Initialize git in an existing folder (without adding to project list).
///
/// 1. Creates the folder if needed; refuses a repository that has commits.
/// 2. `git init` (skipped when `.git` exists without commits).
/// 3. Writes [`DEFAULT_GITIGNORE`] when the folder has no `.gitignore`.
/// 4. With `commit_all`: `git add .` and "Initial commit". Without it (or
///    when nothing is left to add): an empty "Initial commit".
///
/// Returns the path on success, so the caller can then `add_project`.
pub async fn init_git_in_folder(path: String, commit_all: bool) -> Result<String, String> {
    log::trace!("Initializing git in existing folder: {path}, commit_all: {commit_all}");

    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        std::fs::create_dir_all(path_obj)
            .map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    if !path_obj.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    let already_git_repo = path_obj.join(".git").exists();
    if already_git_repo {
        let has_commits = run_git(path_obj, &["rev-parse", "HEAD"])
            .map(|o| o.status.success())
            .unwrap_or(false);
        if has_commits {
            return Err("Directory is already a git repository with commits".to_string());
        }
        log::trace!("Git repo exists but has no commits, will create initial commit");
    } else {
        let output = run_git(path_obj, &["init"])?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git init failed: {stderr}"));
        }
    }

    let gitignore = path_obj.join(".gitignore");
    if !gitignore.exists() {
        std::fs::write(&gitignore, DEFAULT_GITIGNORE)
            .map_err(|e| format!("Failed to write .gitignore: {e}"))?;
    }

    let mut committed = false;
    if commit_all {
        let add_output = run_git(path_obj, &["add", "."])?;
        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr);
            return Err(format!("git add failed: {stderr}"));
        }
        let commit_output = run_git(path_obj, &["commit", "-m", "Initial commit"])?;
        if commit_output.status.success() {
            committed = true;
        } else {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            let stdout = String::from_utf8_lossy(&commit_output.stdout);
            // Git outputs "nothing to commit" to stdout, not stderr
            if !(stderr.contains("nothing to commit") || stdout.contains("nothing to commit")) {
                return Err(format!("git commit failed: {stderr}"));
            }
            log::warn!("No files to commit, creating empty initial commit");
        }
    }

    if !committed {
        let empty_commit = run_git(
            path_obj,
            &["commit", "--allow-empty", "-m", "Initial commit"],
        )?;
        if !empty_commit.status.success() {
            let stderr = String::from_utf8_lossy(&empty_commit.stderr);
            return Err(format!("git commit failed: {stderr}"));
        }
    }

    log::trace!("Successfully initialized git in {path}");
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Commits need an identity; CI machines have none configured.
    fn set_test_git_identity() {
        for (key, value) in [
            ("GIT_AUTHOR_NAME", "Splitkick Test"),
            ("GIT_AUTHOR_EMAIL", "test@example.com"),
            ("GIT_COMMITTER_NAME", "Splitkick Test"),
            ("GIT_COMMITTER_EMAIL", "test@example.com"),
        ] {
            std::env::set_var(key, value);
        }
    }

    fn git_stdout(path: &Path, args: &[&str]) -> String {
        let output = run_git(path, args).expect("run git");
        assert!(output.status.success(), "git {args:?} failed");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn sample_folder() -> tempfile::TempDir {
        let temp = tempfile::tempdir().expect("temp dir");
        std::fs::write(temp.path().join("notes.md"), "hello").unwrap();
        std::fs::write(temp.path().join(".DS_Store"), "junk").unwrap();
        std::fs::create_dir(temp.path().join("docs")).unwrap();
        std::fs::write(temp.path().join("docs").join("scan.pdf"), "pdf").unwrap();
        std::fs::write(temp.path().join("docs").join("draft.md~"), "old").unwrap();
        temp
    }

    #[test]
    fn sync_folder_provider_detects_the_cloud_sync_folders() {
        let cases = [
            (
                "/Users/a/Library/Mobile Documents/com~apple~CloudDocs/Notes",
                Some("iCloud Drive"),
            ),
            (
                "/Users/a/Library/Mobile Documents/iCloud~md~obsidian/Documents/vault",
                Some("iCloud Drive"),
            ),
            ("C:\\Users\\a\\iCloudDrive\\work", Some("iCloud Drive")),
            ("/Users/a/Dropbox/Clients", Some("Dropbox")),
            (
                "/Users/a/Library/CloudStorage/Dropbox-Personal/x",
                Some("Dropbox"),
            ),
            (
                "/Users/a/Library/CloudStorage/OneDrive-Firma/x",
                Some("OneDrive"),
            ),
            ("C:\\Users\\a\\OneDrive\\Documents", Some("OneDrive")),
            (
                "/Users/a/Library/CloudStorage/GoogleDrive-a@example.com/My Drive/x",
                Some("Google Drive"),
            ),
            ("/Users/a/Google Drive/x", Some("Google Drive")),
            ("/Users/a/LocalProjects/app", None),
            ("/Users/a/Projects/dropbox-clone", None),
            ("/Users/a/Projects/onedrive-sync-tool", None),
            ("C:\\Users\\a\\OneDrive - Firma\\x", Some("OneDrive")),
            ("/Users/a/Library/Application Support/x", None),
        ];
        for (path, expected) in cases {
            assert_eq!(
                sync_folder_provider(&PathBuf::from(path)),
                expected,
                "path: {path}"
            );
        }
    }

    #[test]
    fn inspect_counts_files_after_the_default_gitignore() {
        let temp = sample_folder();
        let preview = inspect_git_init_folder(temp.path().to_str().unwrap()).unwrap();
        // notes.md + docs/scan.pdf; .DS_Store and draft.md~ are ignored.
        assert_eq!(preview.file_count, 2);
        assert_eq!(preview.total_bytes, 8);
        assert!(!preview.has_gitignore);
        assert!(!preview.truncated);
    }

    #[test]
    fn inspect_honors_an_existing_gitignore() {
        let temp = sample_folder();
        std::fs::write(temp.path().join(".gitignore"), "docs/\n").unwrap();
        let preview = inspect_git_init_folder(temp.path().to_str().unwrap()).unwrap();
        // .gitignore, notes.md, .DS_Store (the user's file does not ignore it).
        assert_eq!(preview.file_count, 3);
        assert!(preview.has_gitignore);
    }

    #[tokio::test]
    async fn init_writes_gitignore_and_commits_all_files() {
        set_test_git_identity();
        let temp = sample_folder();
        let path = temp.path().to_str().unwrap().to_string();

        init_git_in_folder(path.clone(), true).await.unwrap();

        let gitignore = std::fs::read_to_string(temp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore, DEFAULT_GITIGNORE);
        let tracked = git_stdout(temp.path(), &["ls-files"]);
        let mut tracked: Vec<&str> = tracked.lines().collect();
        tracked.sort();
        assert_eq!(tracked, vec![".gitignore", "docs/scan.pdf", "notes.md"]);
    }

    #[tokio::test]
    async fn init_without_content_commit_makes_an_empty_initial_commit() {
        set_test_git_identity();
        let temp = sample_folder();
        let path = temp.path().to_str().unwrap().to_string();

        init_git_in_folder(path, false).await.unwrap();

        assert!(temp.path().join(".gitignore").is_file());
        assert_eq!(git_stdout(temp.path(), &["ls-files"]), "");
        assert_eq!(
            git_stdout(temp.path(), &["log", "--format=%s"]),
            "Initial commit"
        );
    }

    #[tokio::test]
    async fn init_keeps_an_existing_gitignore() {
        set_test_git_identity();
        let temp = sample_folder();
        std::fs::write(temp.path().join(".gitignore"), "docs/\n").unwrap();
        let path = temp.path().to_str().unwrap().to_string();

        init_git_in_folder(path.clone(), true).await.unwrap();

        let gitignore = std::fs::read_to_string(temp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore, "docs/\n");
        let error = init_git_in_folder(path, true).await.unwrap_err();
        assert!(error.contains("already a git repository"));
    }
}
