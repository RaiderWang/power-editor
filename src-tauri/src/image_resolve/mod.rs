//! Resolves image references found in Markdown documents to real files on disk.
//!
//! Plain Markdown resolves images relative to the document. Obsidian-style notes
//! (`![[Readwise/Tweets/attachments/a.jpg]]`) usually use paths relative to the *vault root*
//! (the folder containing `.obsidian`), or just a shortest unique path / bare filename.
//! This module supports all of these.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Upper bound on directory entries visited while searching a vault for a file.
const MAX_SCAN_ENTRIES: usize = 100_000;

/// Directory names never descended into during the vault scan.
const SKIP_DIRS: [&str; 3] = ["node_modules", "target", "dist"];

/// Normalizes separators and strips a leading `./` so a link can be joined onto a directory.
fn normalize_link(link: &str) -> String {
    let mut s = link.trim().replace('\\', "/");
    while let Some(rest) = s.strip_prefix("./") {
        s = rest.to_string();
    }
    s.trim_start_matches('/').to_string()
}

/// Returns the nearest ancestor of `doc_dir` (inclusive) that contains an `.obsidian` folder.
fn find_vault_root(doc_dir: &Path) -> Option<PathBuf> {
    doc_dir
        .ancestors()
        .find(|dir| dir.join(".obsidian").is_dir())
        .map(Path::to_path_buf)
}

/// Lowercase-forward-slash form of a path, used for suffix matching.
fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// Lazily-built index of every file inside a vault, keyed by lowercase file name.
struct VaultIndex {
    by_name: HashMap<String, Vec<PathBuf>>,
}

impl VaultIndex {
    fn build(root: &Path) -> Self {
        let mut by_name: HashMap<String, Vec<PathBuf>> = HashMap::new();
        let mut stack = vec![root.to_path_buf()];
        let mut visited = 0usize;

        while let Some(dir) = stack.pop() {
            let Ok(read_dir) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in read_dir.flatten() {
                visited += 1;
                if visited > MAX_SCAN_ENTRIES {
                    return Self { by_name };
                }
                let name = entry.file_name().to_string_lossy().to_string();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_dir() {
                    if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                        continue;
                    }
                    stack.push(entry.path());
                } else {
                    by_name
                        .entry(name.to_lowercase())
                        .or_default()
                        .push(entry.path());
                }
            }
        }
        Self { by_name }
    }

    /// Finds a file whose path ends with `link` (Obsidian "shortest path" semantics).
    /// Finds a file whose path ends with `link` (Obsidian "shortest path" semantics).
    /// When several match, the one closest to the document wins (deepest common directory depth).
    fn find(&self, link: &str, doc_dir: &Path) -> Option<PathBuf> {
        let link_key = link.to_lowercase();
        let file_name = link_key.rsplit('/').next()?;
        let suffix = format!("/{link_key}");
        let doc_key = path_key(doc_dir);
        let doc_segments: Vec<&str> = doc_key.split('/').filter(|s| !s.is_empty()).collect();

        self.by_name
            .get(file_name)?
            .iter()
            .filter(|p| {
                let key = path_key(p);
                key.ends_with(&suffix) || key == link_key
            })
            .min_by_key(|p| {
                // Prefer files sharing the deepest directory depth with the document.
                let key = path_key(p);
                let cand_dir = key.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
                let cand_segments = cand_dir.split('/').filter(|s| !s.is_empty());
                let common_depth = cand_segments
                    .zip(doc_segments.iter().copied())
                    .take_while(|(a, b)| a == b)
                    .count();
                (usize::MAX - common_depth, key.len())
            })
            .cloned()
    }
}

/// Resolves a single link using direct candidates starting at `doc_dir` and ascending up to
/// `vault_root` (inclusive). If `vault_root` is None, only `doc_dir` is checked to avoid
/// traversing out into the parent filesystem or filesystem root.
fn resolve_direct(link: &str, doc_dir: &Path, vault_root: Option<&Path>) -> Option<PathBuf> {
    for dir in doc_dir.ancestors() {
        let candidate = dir.join(link);
        if candidate.is_file() {
            return Some(candidate);
        }
        if vault_root.map_or(true, |root| dir == root) {
            break;
        }
    }
    None
}

/// Resolves every link in `links` against `doc_path`. Unresolvable links yield `None`.
pub fn resolve_links(doc_path: &str, links: &[String]) -> Vec<Option<String>> {
    let doc_dir = match Path::new(doc_path).parent() {
        Some(dir) => dir.to_path_buf(),
        None => return vec![None; links.len()],
    };

    let vault_root = find_vault_root(&doc_dir);
    let mut index: Option<VaultIndex> = None;
    let mut index_built = false;

    links
        .iter()
        .map(|raw| {
            let link = normalize_link(raw);
            if link.is_empty() {
                return None;
            }
            if let Some(found) = resolve_direct(&link, &doc_dir, vault_root.as_deref()) {
                return Some(found.to_string_lossy().replace('\\', "/"));
            }

            // Fallback: shortest-path / bare filename lookup inside the vault.
            let root = vault_root.as_deref()?;
            if !index_built {
                index = Some(VaultIndex::build(root));
                index_built = true;
            }
            index
                .as_ref()?
                .find(&link, &doc_dir)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        })
        .collect()
}

#[tauri::command]
pub async fn resolve_image_paths(
    doc_path: String,
    links: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_links(&doc_path, &links))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_vault(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pe_img_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".obsidian")).unwrap();
        dir
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    #[test]
    fn resolves_relative_to_document() {
        let vault = temp_vault("doc");
        touch(&vault.join("notes/attach/a.png"));
        let doc = vault.join("notes/n.md");
        let out = resolve_links(doc.to_str().unwrap(), &["attach/a.png".into()]);
        assert!(out[0].as_deref().unwrap().ends_with("notes/attach/a.png"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn resolves_relative_to_vault_root() {
        let vault = temp_vault("root");
        touch(&vault.join("Readwise/Tweets/attachments/x.jpg"));
        let doc = vault.join("PARA-Areas/VPN/note.md");
        fs::create_dir_all(doc.parent().unwrap()).unwrap();
        let out = resolve_links(
            doc.to_str().unwrap(),
            &["Readwise/Tweets/attachments/x.jpg".into()],
        );
        assert!(out[0]
            .as_deref()
            .unwrap()
            .ends_with("Readwise/Tweets/attachments/x.jpg"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn resolves_bare_filename_and_partial_path() {
        let vault = temp_vault("short");
        touch(&vault.join("assets/deep/Pic.PNG"));
        let doc = vault.join("a/b/note.md");
        fs::create_dir_all(doc.parent().unwrap()).unwrap();
        let out = resolve_links(
            doc.to_str().unwrap(),
            &["pic.png".into(), "deep/pic.png".into(), "missing.png".into()],
        );
        assert!(out[0].is_some());
        assert!(out[1].is_some());
        assert!(out[2].is_none());
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn no_vault_means_no_fallback_scan() {
        let dir = std::env::temp_dir().join(format!("pe_img_novault_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        touch(&dir.join("other/z.png"));
        let doc = dir.join("note.md");
        let out = resolve_links(doc.to_str().unwrap(), &["z.png".into()]);
        assert!(out[0].is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn does_not_traverse_outside_vault_or_no_vault_parent() {
        let parent = std::env::temp_dir().join(format!("pe_test_bound_{}", std::process::id()));
        let _ = fs::remove_dir_all(&parent);
        touch(&parent.join("outside.png"));

        // Case 1: file is in parent of vault root
        let vault = parent.join("my_vault");
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        let doc = vault.join("sub/note.md");
        touch(&doc);

        let out = resolve_links(doc.to_str().unwrap(), &["outside.png".into()]);
        assert!(out[0].is_none());

        // Case 2: standalone file outside vault must not inspect parent dir
        let standalone_sub = parent.join("subdir");
        let sub_doc = standalone_sub.join("sub_note.md");
        touch(&sub_doc);
        let out_standalone = resolve_links(sub_doc.to_str().unwrap(), &["outside.png".into()]);
        assert!(out_standalone[0].is_none());

        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn avoids_prefix_collision_in_directory_names() {
        let vault = temp_vault("collision");
        // Candidate A: in sibling directory "notes_archive" (shares "notes" prefix as string)
        touch(&vault.join("notes_archive/deep/pic.png"));
        // Candidate B: at vault root (shared ancestor is vault root)
        touch(&vault.join("pic.png"));

        let doc = vault.join("notes/my_doc.md");
        touch(&doc);

        let out = resolve_links(doc.to_str().unwrap(), &["pic.png".into()]);
        assert!(out[0].is_some());
        assert!(out[0].as_deref().unwrap().ends_with("/pic.png"));
        assert!(!out[0].as_deref().unwrap().contains("notes_archive"));

        let _ = fs::remove_dir_all(&vault);
    }
}

