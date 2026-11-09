//! Purely lexical path normalisation (no filesystem access, symlinks untouched).
//!
//! `Path::join("../x")` keeps the `..` segment, so a link such as `../other/a.md` would come
//! back as `E:/vault/sub/../other/a.md`. The frontend compares paths as strings, so the same
//! file would open in two tabs. We fold `.` and `..` here instead of using `canonicalize`
//! (which adds `\\?\` prefixes on Windows and resolves symlinks).

use std::path::{Component, Path, PathBuf};

/// Folds `.` and `..` components without touching the filesystem.
pub fn lexical_normalize(path: &Path) -> PathBuf {
    let mut parts: Vec<Component> = Vec::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(Component::Normal(_)) => {
                    parts.pop();
                }
                // `..` above a root/prefix is meaningless; drop it.
                Some(Component::RootDir) | Some(Component::Prefix(_)) => {}
                _ => parts.push(comp),
            },
            other => parts.push(other),
        }
    }
    parts.iter().map(|c| c.as_os_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_parent_and_current_segments() {
        let out = lexical_normalize(Path::new("/vault/sub/../other/./a.md"));
        assert_eq!(out, PathBuf::from("/vault/other/a.md"));
    }

    #[test]
    fn keeps_leading_parent_segments_of_relative_paths() {
        let out = lexical_normalize(Path::new("../../a.md"));
        assert_eq!(out, PathBuf::from("../../a.md"));
    }

    #[test]
    fn does_not_escape_root() {
        let out = lexical_normalize(Path::new("/a/../../b.md"));
        assert_eq!(out, PathBuf::from("/b.md"));
    }
}
