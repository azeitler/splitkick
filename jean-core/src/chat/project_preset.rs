//! Fit the global system prompt to the project's preset (Coding / Non-coding).
//!
//! Non-coding projects (notes, docs, plain folders) get the global prompt
//! without its coding-only sections. Today that is GitHub issue discovery:
//! searching issues after a change makes no sense where there is no code.
//! The section is removed by heading, so it also leaves custom prompts that
//! kept it from the default.

use tauri::AppHandle;

/// Coding-only sections of the global prompt, by their exact heading line.
const CODING_ONLY_HEADINGS: &[&str] = &["## GitHub Issue and Discussion Discovery"];

/// True when the worktree's project uses the Coding preset.
///
/// Unknown worktrees and load errors count as Coding, so a lookup failure
/// never drops instructions from a code project.
pub fn is_coding_worktree(app: &AppHandle, worktree_id: &str) -> bool {
    let Ok(data) = crate::projects::storage::load_projects_data(app) else {
        return true;
    };
    data.find_worktree(worktree_id)
        .and_then(|worktree| data.find_project(&worktree.project_id))
        .is_none_or(|project| project.is_coding())
}

/// The global prompt for this worktree: unchanged for Coding projects,
/// without the coding-only sections for Non-coding projects.
pub fn global_prompt_for_worktree(app: &AppHandle, worktree_id: &str, prompt: &str) -> String {
    if is_coding_worktree(app, worktree_id) {
        prompt.to_string()
    } else {
        strip_coding_sections(prompt)
    }
}

/// Remove each coding-only section: from its heading line up to the next
/// `#` or `##` heading, or to the end of the prompt.
pub fn strip_coding_sections(prompt: &str) -> String {
    let mut kept: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in prompt.lines() {
        let trimmed = line.trim_end();
        if CODING_ONLY_HEADINGS.contains(&trimmed) {
            skipping = true;
            continue;
        }
        if skipping && (trimmed.starts_with("# ") || trimmed.starts_with("## ")) {
            skipping = false;
        }
        if !skipping {
            kept.push(line);
        }
    }
    kept.join("\n").trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::strip_coding_sections;

    #[test]
    fn removes_the_issue_discovery_section_only() {
        let prompt = "## Core\n- keep\n\n## GitHub Issue and Discussion Discovery\n- search issues\n- report\n\n## Worktree Policy\n- keep too";
        let stripped = strip_coding_sections(prompt);
        assert_eq!(
            stripped,
            "## Core\n- keep\n\n## Worktree Policy\n- keep too"
        );
    }

    #[test]
    fn removes_a_trailing_section_and_keeps_subheadings_inside_it_out() {
        let prompt =
            "## Core\n- keep\n\n## GitHub Issue and Discussion Discovery\n### Details\n- search";
        assert_eq!(strip_coding_sections(prompt), "## Core\n- keep");
    }

    #[test]
    fn leaves_prompts_without_the_section_alone() {
        let prompt = "## Core\n- keep\n### Sub\n- also";
        assert_eq!(strip_coding_sections(prompt), prompt);
    }

    #[test]
    fn strips_the_section_from_the_default_prompt() {
        let stripped = strip_coding_sections(&crate::default_global_system_prompt());
        assert!(!stripped.contains("GitHub Issue and Discussion Discovery"));
        assert!(!stripped.contains("search the current repository's existing GitHub issues"));
        assert!(stripped.contains("## Splitkick Worktree Policy"));
    }
}
