import React, { useState, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { activeTabAtom } from '../../store/atoms';
import { explorerRefreshTriggerAtom } from '../../store/explorerAtoms';
import { FileTreeNode } from './FileTreeNode';
import { ExplorerContextMenu } from './ExplorerContextMenu';
import type { FileEntry, ContextMenuTarget, InlineInputState } from '../../types/explorer';
import * as cmd from '../../store/tauriCommands';
import { useExplorer } from '../../hooks/useExplorer';
import { useFile } from '../../hooks/useFile';
import { pathsEqual } from '../../utils/pathUtils';
import { FolderPlus, FilePlus } from 'lucide-react';
import styles from './FileExplorer.module.css';

interface FileTreeProps {
  rootPath: string;
  inlineInput: InlineInputState | null;
  onClearInlineInput: () => void;
  onStartNewFile: (parentDir: string) => void;
  onStartNewFolder: (parentDir: string) => void;
  onStartRename: (path: string, currentName: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({
  rootPath,
  inlineInput,
  onClearInlineInput,
  onStartNewFile,
  onStartNewFolder,
  onStartRename,
}) => {
  const activeTab = useAtomValue(activeTabAtom);
  const refreshTrigger = useAtomValue(explorerRefreshTriggerAtom);
  const {
    expandedFolders,
    selectedPath,
    setSelectedPath,
    toggleFolderExpansion,
    createNewFile,
    createNewDirectory,
    renameItem,
    deleteItem,
    revealPath,
    copyPath,
    copyRelativePath,
  } = useExplorer();
  const { openFile } = useFile();

  const [dirChildren, setDirChildren] = useState<Record<string, FileEntry[]>>({});
  const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTarget | null>(null);

  // Sync selected path with active tab if path is within root
  useEffect(() => {
    if (activeTab?.fileInfo.path) {
      setSelectedPath(activeTab.fileInfo.path);
    }
  }, [activeTab?.fileInfo.path, setSelectedPath]);

  // Fetch root items whenever rootPath or refreshTrigger changes
  useEffect(() => {
    let active = true;
    cmd.listDirectory(rootPath)
      .then((entries) => {
        if (active) {
          setDirChildren((prev) => ({ ...prev, [rootPath]: entries }));
        }
      })
      .catch((err) => {
        console.error('[FileTree] listDirectory root failed:', err);
      });
    return () => {
      active = false;
    };
  }, [rootPath, refreshTrigger]);

  // When expanded folders change or tree refreshes, load expanded subdirectories
  useEffect(() => {
    let active = true;
    for (const folder of expandedFolders) {
      cmd.listDirectory(folder)
        .then((entries) => {
          if (active) {
            setDirChildren((prev) => ({ ...prev, [folder]: entries }));
          }
        })
        .catch((err) => {
          console.error('[FileTree] listDirectory subfolder failed:', err);
        });
    }
    return () => {
      active = false;
    };
  }, [expandedFolders, refreshTrigger]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    setContextMenuTarget({
      path: entry.path,
      name: entry.name,
      is_dir: entry.is_dir,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const handleEmptyAreaContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuTarget({
      path: rootPath,
      name: rootPath.split(/[\\/]/).pop() || rootPath,
      is_dir: true,
      x: e.clientX,
      y: e.clientY,
    });
  }, [rootPath]);

  const handleCommitInline = useCallback((val: string) => {
    if (!inlineInput) return;
    const trimmed = val.trim();
    if (!trimmed) {
      onClearInlineInput();
      return;
    }

    if (inlineInput.type === 'rename') {
      renameItem(inlineInput.targetPath, trimmed);
    } else if (inlineInput.type === 'new-file') {
      createNewFile(inlineInput.targetPath, trimmed);
    } else if (inlineInput.type === 'new-folder') {
      createNewDirectory(inlineInput.targetPath, trimmed);
    }
    onClearInlineInput();
  }, [inlineInput, renameItem, createNewFile, createNewDirectory, onClearInlineInput]);

  // Render a directory branch recursively
  const renderBranch = (parentPath: string, depth: number): React.ReactNode => {
    const entries = dirChildren[parentPath] || [];
    const isTargetingThisParent =
      inlineInput &&
      (inlineInput.type === 'new-file' || inlineInput.type === 'new-folder') &&
      pathsEqual(inlineInput.targetPath, parentPath);

    return (
      <React.Fragment key={parentPath}>
        {/* Inline input row for new file/folder under this directory */}
        {isTargetingThisParent && (
          <div
            className={styles.treeRow}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={styles.chevronHidden} />
            <span className={styles.icon}>
              {inlineInput.type === 'new-folder' ? (
                <FolderPlus size={15} className={styles.folderIcon} />
              ) : (
                <FilePlus size={14} color="#61afef" />
              )}
            </span>
            <input
              key={`${inlineInput.type}-${inlineInput.targetPath}`}
              ref={(el) => el?.focus()}
              type="text"
              className={styles.inlineInput}
              placeholder={inlineInput.type === 'new-folder' ? 'folder name' : 'file name'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCommitInline(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onClearInlineInput();
                }
              }}
              onBlur={(e) => handleCommitInline(e.currentTarget.value)}
            />
          </div>
        )}

        {entries.map((entry) => {
          const isExpanded = entry.is_dir && expandedFolders.some((p) => pathsEqual(p, entry.path));
          const isSelected = !!selectedPath && pathsEqual(selectedPath, entry.path);

          return (
            <React.Fragment key={entry.path}>
              <FileTreeNode
                entry={entry}
                depth={depth}
                isExpanded={isExpanded}
                isSelected={isSelected}
                inlineInput={inlineInput}
                onToggleExpand={toggleFolderExpansion}
                onSelect={setSelectedPath}
                onOpenFile={openFile}
                onContextMenu={handleContextMenu}
                onSubmitInline={handleCommitInline}
                onCancelInline={onClearInlineInput}
              />
              {entry.is_dir && isExpanded && renderBranch(entry.path, depth + 1)}
            </React.Fragment>
          );
        })}
      </React.Fragment>
    );
  };

  return (
    <div
      className={styles.treeContainer}
      onContextMenu={handleEmptyAreaContextMenu}
      onClick={() => setSelectedPath(null)}
    >
      {renderBranch(rootPath, 0)}

      <ExplorerContextMenu
        target={contextMenuTarget}
        onClose={() => setContextMenuTarget(null)}
        onOpenFile={openFile}
        onStartNewFile={onStartNewFile}
        onStartNewFolder={onStartNewFolder}
        onStartRename={onStartRename}
        onDelete={deleteItem}
        onCopyPath={copyPath}
        onCopyRelativePath={copyRelativePath}
        onReveal={revealPath}
      />
    </div>
  );
};
