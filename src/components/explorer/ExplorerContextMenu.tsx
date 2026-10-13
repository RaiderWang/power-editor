import React, { useEffect, useRef } from 'react';
import {
  FileText,
  FilePlus,
  FolderPlus,
  Edit2,
  Trash2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import type { ContextMenuTarget } from '../../types/explorer';
import { useTranslation } from '../../i18n';
import { getParentDir } from '../../utils/pathUtils';
import styles from './FileExplorer.module.css';

interface ExplorerContextMenuProps {
  target: ContextMenuTarget | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onStartNewFile: (parentDir: string) => void;
  onStartNewFolder: (parentDir: string) => void;
  onStartRename: (path: string, currentName: string) => void;
  onDelete: (path: string, isDir: boolean, name: string) => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onReveal: (path: string) => void;
}

export const ExplorerContextMenu: React.FC<ExplorerContextMenuProps> = ({
  target,
  onClose,
  onOpenFile,
  onStartNewFile,
  onStartNewFolder,
  onStartRename,
  onDelete,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
}) => {
  const t = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  // Position adjustment to avoid overflowing window viewport
  useEffect(() => {
    if (!target || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    let left = target.x;
    let top = target.y;

    if (left + rect.width > window.innerWidth) {
      left = Math.max(0, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(0, window.innerHeight - rect.height - 8);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [target]);

  // Close on Escape or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!target) return null;

  const targetDir = target.is_dir ? target.path : getParentDir(target.path);

  return (
    <div
      className={styles.contextMenuOverlay}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className={styles.contextMenu}
        style={{ left: target.x, top: target.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {!target.is_dir && (
          <>
            <button
              className={styles.menuItem}
              onClick={() => {
                onOpenFile(target.path);
                onClose();
              }}
            >
              <span className={styles.menuItemLeft}>
                <FileText size={14} />
                {t('explorer.openFile')}
              </span>
            </button>
            <div className={styles.menuSeparator} />
          </>
        )}

        <button
          className={styles.menuItem}
          onClick={() => {
            onStartNewFile(targetDir);
            onClose();
          }}
        >
          <span className={styles.menuItemLeft}>
            <FilePlus size={14} />
            {t('explorer.newFile')}
          </span>
        </button>

        <button
          className={styles.menuItem}
          onClick={() => {
            onStartNewFolder(targetDir);
            onClose();
          }}
        >
          <span className={styles.menuItemLeft}>
            <FolderPlus size={14} />
            {t('explorer.newFolder')}
          </span>
        </button>

        <div className={styles.menuSeparator} />

        <button
          className={styles.menuItem}
          onClick={() => {
            onStartRename(target.path, target.name);
            onClose();
          }}
        >
          <span className={styles.menuItemLeft}>
            <Edit2 size={14} />
            {t('explorer.rename')}
          </span>
        </button>

        <button
          className={styles.menuItem}
          onClick={() => {
            onDelete(target.path, target.is_dir, target.name);
            onClose();
          }}
        >
          <span className={styles.menuItemLeft}>
            <Trash2 size={14} />
            {t('explorer.delete')}
          </span>
        </button>

        <div className={styles.menuSeparator} />

        <button
          className={styles.menuItem}
          onClick={() => {
            onCopyPath(target.path);
            onClose();
          }}
        >
          <span className={styles.menuItemLeft}>
            <Copy size={14} />
            {t('explorer.copyPath')}
          </span>
        </button>

        <button
          className={styles.menuItem}
          onClick={() => {
            onCopyRelativePath(target.path);
            onClose();
          }}
        >
          <span className={styles.menuItemLeft}>
            <Copy size={14} />
            {t('explorer.copyRelativePath')}
          </span>
        </button>

        <div className={styles.menuSeparator} />

        <button
          className={styles.menuItem}
          onClick={() => {
            onReveal(target.path);
            onClose();
          }}
        >
          <span className={styles.menuItemLeft}>
            <ExternalLink size={14} />
            {t('explorer.revealInExplorer')}
          </span>
        </button>
      </div>
    </div>
  );
};
