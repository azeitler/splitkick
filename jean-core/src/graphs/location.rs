//! Where a graph file lives (project repo, other repo, folder) and committing it.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::model::{GraphLocationInfo, GraphLocationKind};
use crate::platform::wsl_aware_command;

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = wsl_aware_command("git", Some(dir))
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// The nearest existing directory at or above the file's parent.
fn existing_dir(path: &Path) -> Option<PathBuf> {
    path.parent()?
        .ancestors()
        .find(|p| p.is_dir())
        .map(Path::to_path_buf)
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

pub fn repo_root(path: &Path) -> Option<PathBuf> {
    let dir = existing_dir(path)?;
    git(&dir, &["rev-parse", "--show-toplevel"])
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

fn origin_default_branch(root: &Path) -> Option<String> {
    git(
        root,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .ok()
    .map(|s| s.strip_prefix("origin/").unwrap_or(&s).to_string())
    .filter(|s| !s.is_empty())
}

pub fn location_info(app: &AppHandle, path: &str) -> GraphLocationInfo {
    let file = Path::new(path);
    let exists = file.is_file();
    let Some(root) = repo_root(file) else {
        return GraphLocationInfo {
            path: path.to_string(),
            exists,
            location_kind: GraphLocationKind::Folder,
            repo_root: None,
            branch: None,
            default_branch: None,
            project_id: None,
            project_name: None,
            off_default_branch: false,
        };
    };
    let root_canon = canonical(&root);
    let project = crate::projects::storage::load_projects_data(app)
        .ok()
        .and_then(|data| {
            data.projects.into_iter().find(|p| {
                !p.is_folder && !p.path.is_empty() && canonical(Path::new(&p.path)) == root_canon
            })
        });
    let branch = crate::projects::git::get_current_branch(&root.to_string_lossy()).ok();
    let default_branch = project
        .as_ref()
        .map(|p| p.default_branch.clone())
        .filter(|b| !b.is_empty())
        .or_else(|| origin_default_branch(&root))
        .unwrap_or_else(|| "main".to_string());
    let off_default_branch =
        project.is_some() && branch.as_deref().is_some_and(|b| b != default_branch);
    GraphLocationInfo {
        path: path.to_string(),
        exists,
        location_kind: if project.is_some() {
            GraphLocationKind::ProjectRepo
        } else {
            GraphLocationKind::OtherRepo
        },
        repo_root: Some(root.to_string_lossy().to_string()),
        branch,
        default_branch: Some(default_branch),
        project_id: project.as_ref().map(|p| p.id.clone()),
        project_name: project.map(|p| p.name),
        off_default_branch,
    }
}

/// Stage and commit only this file. Returns the new commit sha.
pub fn commit_file(path: &Path, message: &str) -> Result<String, String> {
    let root =
        repo_root(path).ok_or_else(|| "The graph file is not in a git repository".to_string())?;
    // Relative to the root: an absolute path through a symlink (/var → /private/var)
    // would be "outside the repository" for git.
    let canon = canonical(path);
    let file = canon
        .strip_prefix(canonical(&root))
        .unwrap_or(&canon)
        .to_string_lossy()
        .to_string();
    git(&root, &["add", "--", &file])?;
    git(&root, &["commit", "-m", message, "--only", "--", &file])?;
    git(&root, &["rev-parse", "HEAD"])
}
