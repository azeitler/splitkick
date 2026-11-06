//! Artifact list per session: files and URLs the agent registered as outputs
//! through the `add_artifact` MCP tool. Every change is one operation applied
//! under the session's metadata lock, like the follow-up list.
//!
//! Versions (#108): registering a target again adds a version. Each version
//! of a file keeps a copy in `sessions/data/<session>/artifacts/`, taken
//! before the lock (it can be large) and recorded under it. Copies no version
//! refers to any more are deleted after the lock.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::commands::emit_worktree_sessions_cache_invalidation;
use super::storage::{get_session_dir, with_existing_metadata_mut};
use super::types::{Artifact, ArtifactVersion};

/// Folder of a session's artifact copies.
pub const SNAPSHOT_DIR: &str = "artifacts";

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ArtifactOp {
    /// Add an artifact. An existing item with the same target gets a new
    /// version and moves to the end instead of being added twice.
    Add {
        title: String,
        target: String,
        #[serde(default)]
        note: Option<String>,
        /// What changed in this version.
        #[serde(default)]
        change: Option<String>,
    },
    Remove {
        id: String,
    },
    Clear,
}

/// A copy of the target file, taken before the metadata lock.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
}

/// What an operation did.
#[derive(Debug, Default, PartialEq)]
pub struct Applied {
    /// The item an `Add` created or updated.
    pub item: Option<Artifact>,
    /// Copies no version refers to any more: delete them.
    pub orphaned: Vec<String>,
}

/// URLs stay as they are; a relative path is resolved in the worktree.
pub fn resolve_target(target: &str, worktree_path: &str) -> String {
    if target.contains("://") || Path::new(target).is_absolute() || worktree_path.is_empty() {
        return target.to_string();
    }
    Path::new(worktree_path)
        .join(target)
        .to_string_lossy()
        .into_owned()
}

/// The local file a target names: a path, or a `file://` URL. None for web URLs.
fn local_file(target: &str) -> Option<PathBuf> {
    if let Some(rest) = target.strip_prefix("file://") {
        return Some(PathBuf::from(percent_decode(rest)));
    }
    if target.contains("://") {
        return None;
    }
    Some(PathBuf::from(target))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn names(versions: &[ArtifactVersion]) -> impl Iterator<Item = String> + '_ {
    versions.iter().filter_map(|v| v.snapshot.clone())
}

/// Apply one operation. `snapshot` is the copy taken for an `Add`.
pub fn apply_artifact_op(
    list: &mut Vec<Artifact>,
    op: ArtifactOp,
    worktree_path: &str,
    snapshot: Option<Snapshot>,
    now_ms: u64,
) -> Result<Applied, String> {
    let trimmed = |s: Option<String>| s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    match op {
        ArtifactOp::Add {
            title,
            target,
            note,
            change,
        } => {
            let title = title.trim();
            if title.is_empty() {
                return Err("Artifact title is empty".to_string());
            }
            let target = target.trim();
            if target.is_empty() {
                return Err("Artifact target is empty".to_string());
            }
            let target = resolve_target(target, worktree_path);
            let existing = list.iter().position(|a| a.target == target);
            let current = existing.map(|pos| &list[pos]);
            let new_sha = snapshot.as_ref().map(|s| s.sha256.clone());
            // A new item, or content that differs from the newest version.
            let new_content = current
                .map(|a| a.versions.last().and_then(|v| v.sha256.clone()) != new_sha)
                .unwrap_or(true);
            let given_note = trimmed(note);
            let current_note = current.and_then(|a| a.note.clone());
            let mut change = trimmed(change);
            // The note describes the artifact. Agents often write what changed
            // into it anyway: for a new version, a different note without a
            // change becomes the change, and the artifact keeps its note.
            let note = if current.is_some()
                && new_content
                && change.is_none()
                && given_note.is_some()
                && given_note != current_note
            {
                change = given_note;
                current_note
            } else {
                given_note.or(current_note)
            };
            let version = |number: u32| ArtifactVersion {
                version: number,
                title: title.to_string(),
                note: note.clone(),
                change: change.clone(),
                snapshot: snapshot.as_ref().map(|s| s.file_name.clone()),
                size: snapshot.as_ref().map(|s| s.size),
                sha256: snapshot.as_ref().map(|s| s.sha256.clone()),
                created_at: now_ms,
            };

            let Some(pos) = existing else {
                let item = Artifact {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: title.to_string(),
                    target,
                    note: note.clone(),
                    created_at: now_ms,
                    versions: vec![version(1)],
                };
                list.push(item.clone());
                return Ok(Applied {
                    item: Some(item),
                    orphaned: vec![],
                });
            };

            let mut item = list.remove(pos);
            // An item saved before versions existed: its state is version 1.
            if item.versions.is_empty() {
                item.versions.push(ArtifactVersion {
                    version: 1,
                    title: item.title.clone(),
                    note: item.note.clone(),
                    change: None,
                    snapshot: None,
                    size: None,
                    sha256: None,
                    created_at: item.created_at,
                });
            }
            let mut orphaned = vec![];
            let last = item.versions.last_mut().expect("at least one version");
            if !new_content && change.is_none() {
                // Nothing new to keep: update the names in place.
                last.title = title.to_string();
                last.note = note.clone();
                orphaned.extend(snapshot.map(|s| s.file_name));
            } else {
                let number = last.version + 1;
                item.versions.push(version(number));
            }
            item.title = title.to_string();
            item.note = note.clone();
            list.push(item.clone());
            Ok(Applied {
                item: Some(item),
                orphaned,
            })
        }
        ArtifactOp::Remove { id } => {
            let mut orphaned = vec![];
            list.retain(|a| {
                if a.id == id {
                    orphaned.extend(names(&a.versions));
                    false
                } else {
                    true
                }
            });
            Ok(Applied {
                item: None,
                orphaned,
            })
        }
        ArtifactOp::Clear => {
            let orphaned = list.iter().flat_map(|a| names(&a.versions)).collect();
            list.clear();
            Ok(Applied {
                item: None,
                orphaned,
            })
        }
    }
}

/// Copy `source` into `dir` under a new name and hash it. None when the
/// source is not a readable regular file.
pub fn take_snapshot_into(dir: &Path, source: &Path) -> Option<Snapshot> {
    if !source.is_file() {
        return None;
    }
    fs::create_dir_all(dir).ok()?;
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let file_name = format!("{}{ext}", uuid::Uuid::new_v4());
    let dest = dir.join(&file_name);
    let size = match fs::copy(source, &dest) {
        Ok(size) => size,
        Err(e) => {
            log::warn!("Artifact copy of {} failed: {e}", source.display());
            let _ = fs::remove_file(&dest);
            return None;
        }
    };
    let mut hasher = Sha256::new();
    let mut file = fs::File::open(&dest).ok()?;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(_) => {
                let _ = fs::remove_file(&dest);
                return None;
            }
        }
    }
    let sha256 = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Some(Snapshot {
        file_name,
        size,
        sha256,
    })
}

/// The folder of a session's artifact copies.
pub fn snapshot_dir(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    Ok(get_session_dir(app, session_id)?.join(SNAPSHOT_DIR))
}

/// Copy a session's artifact copies to another session (fork).
pub fn copy_snapshots(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            fs::copy(entry.path(), to.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Change a session's artifact list and return the new list.
pub async fn edit_session_artifacts(
    app: AppHandle,
    worktree_id: String,
    worktree_path: String,
    session_id: String,
    op: ArtifactOp,
) -> Result<Vec<Artifact>, String> {
    let dir = snapshot_dir(&app, &session_id)?;
    let snapshot = match &op {
        ArtifactOp::Add { target, .. } => {
            let target = resolve_target(target.trim(), &worktree_path);
            match local_file(&target) {
                Some(source) => {
                    let dir = dir.clone();
                    tokio::task::spawn_blocking(move || take_snapshot_into(&dir, &source))
                        .await
                        .map_err(|e| format!("Artifact copy failed: {e}"))?
                }
                None => None,
            }
        }
        _ => None,
    };
    let taken = snapshot.as_ref().map(|s| s.file_name.clone());

    let result = with_existing_metadata_mut(&app, &session_id, |metadata| {
        let applied = apply_artifact_op(
            &mut metadata.artifacts,
            op,
            &worktree_path,
            snapshot,
            now_ms(),
        )?;
        Ok::<_, String>((metadata.artifacts.clone(), applied.orphaned))
    })
    .and_then(|inner| inner);
    let (list, orphaned) = match result {
        Ok(done) => done,
        Err(e) => {
            if let Some(name) = taken {
                let _ = fs::remove_file(dir.join(name));
            }
            return Err(e);
        }
    };
    for name in orphaned {
        let _ = fs::remove_file(dir.join(name));
    }
    emit_worktree_sessions_cache_invalidation(&app, &worktree_id);
    Ok(list)
}

/// Absolute folder of a session's artifact copies, for opening a version.
pub async fn get_artifact_snapshot_dir(
    app: AppHandle,
    session_id: String,
) -> Result<String, String> {
    Ok(snapshot_dir(&app, &session_id)?
        .to_string_lossy()
        .into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Absolute on every OS: a hard-coded `/a` is relative on Windows.
    fn abs(name: &str) -> String {
        std::env::temp_dir()
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    fn add(title: &str, target: &str) -> ArtifactOp {
        ArtifactOp::Add {
            title: title.to_string(),
            target: target.to_string(),
            note: None,
            change: None,
        }
    }

    fn snap(name: &str, sha: &str) -> Option<Snapshot> {
        Some(Snapshot {
            file_name: name.to_string(),
            size: 3,
            sha256: sha.to_string(),
        })
    }

    fn apply(list: &mut Vec<Artifact>, op: ArtifactOp, s: Option<Snapshot>, now: u64) -> Applied {
        apply_artifact_op(list, op, &abs("wt"), s, now).unwrap()
    }

    #[test]
    fn add_trims_and_creates_version_one() {
        let mut list = vec![];
        let target = abs("r.html");
        let item = apply(
            &mut list,
            add("  Report \n", &format!(" {target} ")),
            snap("s1.html", "aa"),
            42,
        )
        .item
        .unwrap();
        assert_eq!(item.title, "Report");
        assert_eq!(item.target, target);
        assert_eq!(item.created_at, 42);
        assert_eq!(item.versions.len(), 1);
        assert_eq!(item.versions[0].version, 1);
        assert_eq!(item.versions[0].snapshot.as_deref(), Some("s1.html"));
        assert_eq!(item.versions[0].sha256.as_deref(), Some("aa"));
        assert_eq!(list, vec![item]);
    }

    #[test]
    fn add_rejects_empty_title_or_target() {
        let mut list = vec![];
        let wt = abs("wt");
        assert!(apply_artifact_op(&mut list, add("  ", &abs("a")), &wt, None, 1).is_err());
        assert!(apply_artifact_op(&mut list, add("A", " "), &wt, None, 1).is_err());
        assert!(list.is_empty());
    }

    #[test]
    fn relative_path_resolves_in_worktree() {
        let mut list = vec![];
        let item = apply(&mut list, add("Shot", "tmp/shot.png"), None, 1)
            .item
            .unwrap();
        let expected = Path::new(&abs("wt")).join("tmp/shot.png");
        assert_eq!(item.target, expected.to_string_lossy());
        assert!(Path::new(&item.target).is_absolute());
    }

    #[test]
    fn url_stays_unchanged() {
        let mut list = vec![];
        for url in ["https://x.dev/a", "file:///tmp/a.html"] {
            let item = apply(&mut list, add("Link", url), None, 1).item.unwrap();
            assert_eq!(item.target, url);
        }
    }

    #[test]
    fn new_content_adds_a_version_and_moves_the_item_to_the_end() {
        let mut list = vec![];
        let (a, b) = (abs("a"), abs("b"));
        let first = apply(&mut list, add("Old", &a), snap("s1", "aa"), 1)
            .item
            .unwrap();
        apply(&mut list, add("B", &b), None, 2);
        let applied = apply(
            &mut list,
            ArtifactOp::Add {
                title: "New".to_string(),
                target: a.clone(),
                note: Some("v2".to_string()),
                change: Some("Added a table".to_string()),
            },
            snap("s2", "bb"),
            3,
        );
        let again = applied.item.unwrap();
        assert!(applied.orphaned.is_empty());
        assert_eq!(again.id, first.id);
        assert_eq!(again.created_at, 1, "first registration stays");
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].id, first.id);
        assert_eq!(list[1].title, "New");
        assert_eq!(list[1].note.as_deref(), Some("v2"));
        let versions: Vec<_> = again.versions.iter().map(|v| v.version).collect();
        assert_eq!(versions, vec![1, 2]);
        assert_eq!(again.versions[0].title, "Old");
        assert_eq!(again.versions[1].change.as_deref(), Some("Added a table"));
        assert_eq!(again.versions[1].snapshot.as_deref(), Some("s2"));
        assert_eq!(again.versions[1].created_at, 3);
    }

    #[test]
    fn same_content_adds_no_version_and_drops_the_new_copy() {
        let mut list = vec![];
        let a = abs("a");
        apply(&mut list, add("Old", &a), snap("s1", "aa"), 1);
        let applied = apply(&mut list, add("Renamed", &a), snap("s2", "aa"), 2);
        let item = applied.item.unwrap();
        assert_eq!(applied.orphaned, vec!["s2".to_string()]);
        assert_eq!(item.versions.len(), 1);
        assert_eq!(item.versions[0].title, "Renamed");
        assert_eq!(item.title, "Renamed");
    }

    #[test]
    fn a_new_version_without_a_note_keeps_the_note() {
        let mut list = vec![];
        let a = abs("a");
        apply(
            &mut list,
            ArtifactOp::Add {
                title: "Report".to_string(),
                target: a.clone(),
                note: Some("Build summary".to_string()),
                change: None,
            },
            snap("s1", "aa"),
            1,
        );
        let item = apply(&mut list, add("Report", &a), snap("s2", "bb"), 2)
            .item
            .unwrap();
        assert_eq!(item.note.as_deref(), Some("Build summary"));
        assert_eq!(item.versions[1].note.as_deref(), Some("Build summary"));
    }

    #[test]
    fn a_new_note_on_a_new_version_becomes_its_change() {
        let mut list = vec![];
        let a = abs("a");
        let with_note = |note: &str| ArtifactOp::Add {
            title: "Report".to_string(),
            target: a.clone(),
            note: Some(note.to_string()),
            change: None,
        };
        apply(&mut list, with_note("Build summary"), snap("s1", "aa"), 1);
        let item = apply(&mut list, with_note("Added a table"), snap("s2", "bb"), 2)
            .item
            .unwrap();
        assert_eq!(item.note.as_deref(), Some("Build summary"));
        assert_eq!(item.versions[1].change.as_deref(), Some("Added a table"));
        assert_eq!(item.versions[1].note.as_deref(), Some("Build summary"));

        // Unchanged content: the note is an edit of the description.
        let item = apply(&mut list, with_note("Q3 summary"), snap("s3", "bb"), 3)
            .item
            .unwrap();
        assert_eq!(item.versions.len(), 2);
        assert_eq!(item.note.as_deref(), Some("Q3 summary"));
    }

    #[test]
    fn a_change_note_adds_a_version_even_without_new_content() {
        let mut list = vec![];
        let url = "https://preview.example.dev";
        apply(&mut list, add("Preview", url), None, 1);
        let same = apply(&mut list, add("Preview", url), None, 2).item.unwrap();
        assert_eq!(same.versions.len(), 1, "a URL without a change note");
        let item = apply(
            &mut list,
            ArtifactOp::Add {
                title: "Preview".to_string(),
                target: url.to_string(),
                note: None,
                change: Some("Deployed build 42".to_string()),
            },
            None,
            3,
        )
        .item
        .unwrap();
        assert_eq!(item.versions.len(), 2);
    }

    #[test]
    fn an_item_from_before_versions_keeps_its_state_as_version_one() {
        let a = abs("a");
        let mut list = vec![Artifact {
            id: "old".to_string(),
            title: "Legacy".to_string(),
            target: a.clone(),
            note: Some("n".to_string()),
            created_at: 5,
            versions: vec![],
        }];
        let item = apply(&mut list, add("Legacy", &a), snap("s1", "aa"), 9)
            .item
            .unwrap();
        assert_eq!(item.versions.len(), 2);
        assert_eq!(item.versions[0].created_at, 5);
        assert_eq!(item.versions[0].snapshot, None);
        assert_eq!(item.versions[1].snapshot.as_deref(), Some("s1"));
    }

    #[test]
    fn remove_and_clear_return_the_copies_to_delete() {
        let mut list = vec![];
        let a = apply(&mut list, add("A", &abs("a")), snap("a1", "x"), 1)
            .item
            .unwrap();
        apply(&mut list, add("A", &abs("a")), snap("a2", "y"), 2);
        apply(&mut list, add("B", &abs("b")), snap("b1", "z"), 3);

        let removed = apply(&mut list, ArtifactOp::Remove { id: a.id }, None, 4);
        assert_eq!(removed.orphaned, vec!["a1".to_string(), "a2".to_string()]);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].target, abs("b"));

        let cleared = apply(&mut list, ArtifactOp::Clear, None, 5);
        assert_eq!(cleared.orphaned, vec!["b1".to_string()]);
        assert!(list.is_empty());
    }

    #[test]
    fn take_snapshot_copies_and_hashes_a_file() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("report.html");
        fs::write(&source, b"abc").unwrap();
        let dir = temp.path().join("artifacts");

        let s = take_snapshot_into(&dir, &source).unwrap();
        assert!(s.file_name.ends_with(".html"), "keeps the extension");
        assert_eq!(s.size, 3);
        assert_eq!(
            s.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(fs::read(dir.join(&s.file_name)).unwrap(), b"abc");

        // The copy outlives a change to the file.
        fs::write(&source, b"changed").unwrap();
        assert_eq!(fs::read(dir.join(&s.file_name)).unwrap(), b"abc");
    }

    #[test]
    fn take_snapshot_skips_missing_files_and_folders() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("artifacts");
        assert_eq!(
            take_snapshot_into(&dir, &temp.path().join("gone.txt")),
            None
        );
        assert_eq!(take_snapshot_into(&dir, temp.path()), None);
    }

    #[test]
    fn local_file_reads_paths_and_file_urls_only() {
        assert_eq!(local_file("https://x.dev/a"), None);
        assert_eq!(
            local_file("file:///tmp/my%20doc.md"),
            Some(PathBuf::from("/tmp/my doc.md"))
        );
        assert_eq!(
            local_file("file:///tmp/100%"),
            Some(PathBuf::from("/tmp/100%"))
        );
        let path = abs("x.txt");
        assert_eq!(local_file(&path), Some(PathBuf::from(&path)));
    }

    #[test]
    fn copy_snapshots_copies_every_file() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = (temp.path().join("a"), temp.path().join("b"));
        assert!(
            copy_snapshots(&from, &to).is_ok(),
            "no folder, nothing to do"
        );
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("s1.png"), b"png").unwrap();
        copy_snapshots(&from, &to).unwrap();
        assert_eq!(fs::read(to.join("s1.png")).unwrap(), b"png");
    }

    #[test]
    fn op_deserializes_from_frontend_shape() {
        let op: ArtifactOp =
            serde_json::from_value(serde_json::json!({"kind": "remove", "id": "x"})).unwrap();
        assert_eq!(
            op,
            ArtifactOp::Remove {
                id: "x".to_string()
            }
        );
        let op: ArtifactOp = serde_json::from_value(
            serde_json::json!({"kind": "add", "title": "T", "target": "t", "change": "c"}),
        )
        .unwrap();
        assert!(matches!(
            op,
            ArtifactOp::Add {
                change: Some(_),
                ..
            }
        ));
    }
}
