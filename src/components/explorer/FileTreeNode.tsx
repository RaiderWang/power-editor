import React from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  FileImage,
  FileJson,
  Table,
} from 'lucide-react';
import type { FileEntry, InlineInputState } from '../../types/explorer';
import styles from './FileExplorer.module.css';

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  inlineInput: InlineInputState | null;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onSubmitInline: (value: string) => void;
  onCancelInline: () => void;
}

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  entry,
  depth,
  isExpanded,
  isSelected,
  inlineInput,
  onToggleExpand,
  onSelect,
  onOpenFile,
  onContextMenu,
  onSubmitInline,
  onCancelInline,
}) => {
  const isRenaming = inlineInput?.type === 'rename' && inlineInput.targetPath === entry.path;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(entry.path);
    if (entry.is_dir) {
      onToggleExpand(entry.path);
    } else {
      onOpenFile(entry.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(entry.path);
    onContextMenu(e, entry);
  };

  const handleInputRef = (el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      const dotIdx = entry.name.lastIndexOf('.');
      if (!entry.is_dir && dotIdx > 0) {
        el.setSelectionRange(0, dotIdx);
      } else {
        el.select();
      }
    }
  };

  const renderIcon = () => {
    if (entry.is_dir) {
      return isExpanded ? (
        <FolderOpen size={15} className={styles.folderIcon} />
      ) : (
        <Folder size={15} className={styles.folderIcon} />
      );
    }

    const ext = entry.name.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
      case 'py':
      case 'rs':
      case 'c':
      case 'cpp':
      case 'h':
      case 'hpp':
      case 'java':
      case 'html':
      case 'css':
      case 'sql':
      case 'sh':
      case 'ps1':
        return <FileCode size={14} color="#61afef" />;
      case 'json':
      case 'yaml':
      case 'yml':
      case 'xml':
      case 'toml':
        return <FileJson size={14} color="#e5c07b" />;
      case 'md':
      case 'markdown':
      case 'txt':
      case 'log':
        return <FileText size={14} color="#98c379" />;
      case 'csv':
      case 'tsv':
        return <Table size={14} color="#56b6c2" />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'ico':
        return <FileImage size={14} color="#c678dd" />;
      default:
        return <File size={14} color="var(--app-fg-muted)" />;
    }
  };

  return (
    <div
      className={`${styles.treeRow} ${isSelected ? styles.selected : ''}`}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={entry.path}
    >
      {entry.is_dir ? (
        <span
          className={styles.chevron}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(entry.path);
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      ) : (
        <span className={styles.chevronHidden} />
      )}

      <span className={styles.icon}>{renderIcon()}</span>

      {isRenaming ? (
        <input
          ref={handleInputRef}
          type="text"
          className={styles.inlineInput}
          defaultValue={entry.name}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmitInline(e.currentTarget.value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancelInline();
            }
          }}
          onBlur={(e) => onSubmitInline(e.currentTarget.value)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className={styles.label}>{entry.name}</span>
      )}
    </div>
  );
};
