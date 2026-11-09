//! Resolves Obsidian-style note links (`[[entities/Foo]]`) and relative Markdown links
//! (`[x](../notes/a.md)`) clicked in the preview / editor to real files on disk.
//!
//! Lookup semantics are shared with image resolution (`super::resolve_candidate_lists`):
//! document folder, parent folders up to the vault root, then a vault-wide shortest-path search.
//!
//! The caller passes the link target WITHOUT any `#heading` suffix (note names may legitimately
//! contain `#`, e.g. `C#.md`, so we never strip it here).

use super::resolve_candidate_lists;

/// True when `target` already names a Markdown file (`.md` / `.markdown`, case-insensitive).
fn has_markdown_extension(target: &str) -> bool {
    let lower = target.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// Ordered alternatives for one link target.
///
/// Note names often contain dots (`2026.11.09`, `v1.2`, `Dr.Strange`), so we must NOT use
/// `Path::extension()` to decide whether `.md` is missing. Anything that is not already a
/// Markdown file is tried as `<target>.md` first and then verbatim (`data.json`, `diagram.png`).
fn note_candidates(target: &str) -> Vec<String> {
    let target = target.trim();
    if target.is_empty() {
        return Vec::new();
    }
    if has_markdown_extension(target) {
        vec![target.to_string()]
    } else {
        vec![format!("{target}.md"), target.to_string()]
    }
}

/// Resolves every note link target against `doc_path`. Unresolvable targets yield `None`.
pub fn resolve_note_targets(doc_path: &str, targets: &[String]) -> Vec<Option<String>> {
    let lists: Vec<Vec<String>> = targets.iter().map(|t| note_candidates(t)).collect();
    resolve_candidate_lists(doc_path, &lists)
}

#[tauri::command]
pub async fn resolve_note_links(
    doc_path: String,
    targets: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_note_targets(&doc_path, &targets))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temp_dir(tag: &str, with_vault: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pe_note_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        if with_vault {
            fs::create_dir_all(dir.join(".obsidian")).unwrap();
        }
        dir
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    fn resolve_one(doc: &Path, target: &str) -> Option<String> {
        resolve_note_targets(doc.to_str().unwrap(), &[target.to_string()])
            .into_iter()
            .next()
            .unwrap()
    }

    #[test]
    fn candidates_for_dotted_note_names() {
        assert_eq!(note_candidates("2026.11.09"), vec!["2026.11.09.md", "2026.11.09"]);
        assert_eq!(note_candidates("v1.2"), vec!["v1.2.md", "v1.2"]);
        assert_eq!(note_candidates("a.MD"), vec!["a.MD"]);
        assert_eq!(note_candidates("a.markdown"), vec!["a.markdown"]);
        assert_eq!(note_candidates(" data.json "), vec!["data.json.md", "data.json"]);
        assert!(note_candidates("  ").is_empty());
    }

    #[test]
    fn resolves_vault_relative_note_without_extension() {
        let vault = temp_dir("vault_rel", true);
        touch(&vault.join("entities/司徒玄.md"));
        let doc = vault.join("daily/today.md");
        touch(&doc);
        let out = resolve_one(&doc, "entities/司徒玄").unwrap();
        assert!(out.ends_with("entities/司徒玄.md"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn resolves_shortest_path_bare_name() {
        let vault = temp_dir("bare", true);
        touch(&vault.join("a/b/Note.md"));
        let doc = vault.join("c/doc.md");
        touch(&doc);
        assert!(resolve_one(&doc, "note").unwrap().ends_with("a/b/Note.md"));
        assert!(resolve_one(&doc, "missing").is_none());
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn dotted_note_names_get_md_appended() {
        let vault = temp_dir("dotted", true);
        touch(&vault.join("2026.11.09.md"));
        touch(&vault.join("v1.2.md"));
        touch(&vault.join("Dr.Strange.md"));
        touch(&vault.join("data.json"));
        let doc = vault.join("n.md");
        touch(&doc);
        assert!(resolve_one(&doc, "2026.11.09").unwrap().ends_with("2026.11.09.md"));
        assert!(resolve_one(&doc, "v1.2").unwrap().ends_with("v1.2.md"));
        assert!(resolve_one(&doc, "Dr.Strange").unwrap().ends_with("Dr.Strange.md"));
        assert!(resolve_one(&doc, "data.json").unwrap().ends_with("data.json"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn explicit_md_extension_is_not_doubled() {
        let vault = temp_dir("explicit", true);
        touch(&vault.join("x/a.md"));
        let doc = vault.join("n.md");
        touch(&doc);
        assert!(resolve_one(&doc, "x/a.md").unwrap().ends_with("x/a.md"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn markdown_note_wins_over_same_named_non_note() {
        let vault = temp_dir("prefer_md", true);
        touch(&vault.join("topic.md"));
        touch(&vault.join("topic"));
        let doc = vault.join("n.md");
        touch(&doc);
        assert!(resolve_one(&doc, "topic").unwrap().ends_with("topic.md"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn folds_parent_segments_and_dedups_paths() {
        let vault = temp_dir("dotdot", true);
        touch(&vault.join("other/a.md"));
        let doc = vault.join("sub/n.md");
        touch(&doc);
        let out = resolve_one(&doc, "../other/a.md").unwrap();
        assert!(!out.contains(".."), "path must be normalised: {out}");
        assert!(out.ends_with("/other/a.md"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn rejects_escape_from_vault() {
        let parent = temp_dir("escape", false);
        let vault = parent.join("vault");
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        touch(&parent.join("outside.md"));
        let doc = vault.join("sub/n.md");
        touch(&doc);
        assert!(resolve_one(&doc, "../../outside.md").is_none());
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn allows_parent_links_without_vault() {
        let dir = temp_dir("novault", false);
        touch(&dir.join("other/a.md"));
        let doc = dir.join("sub/n.md");
        touch(&doc);
        let out = resolve_one(&doc, "../other/a.md").unwrap();
        assert!(out.ends_with("/other/a.md") && !out.contains(".."));
        let _ = fs::remove_dir_all(&dir);
    }
}
