import React, { useState, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  RefreshCw,
  ChevronsDownUp,
  X,
} from 'lucide-react';
import { useExplorer } from '../../hooks/useExplorer';
import { useTranslation } from '../../i18n';
import { getBaseName } from '../../utils/pathUtils';
import { FileTree } from './FileTree';
import type { InlineInputState } from '../../types/explorer';
import styles from './FileExplorer.module.css';

export const FileExplorer: React.FC = () => {
  const {
    currentFolderPath,
    sidebarWidth,
    selectedPath,
    openFolder,
    closeFolder,
    refreshTree,
    collapseAllFolders,
  } = useExplorer();
  const t = useTranslation();

  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null);

  const folderName = currentFolderPath ? getBaseName(currentFolderPath) : '';

  const handleStartNewFile = useCallback((parentDir: string) => {
    setInlineInput({
      type: 'new-file',
      targetPath: parentDir,
      initialValue: '',
    });
  }, []);

  const handleStartNewFolder = useCallback((parentDir: string) => {
    setInlineInput({
      type: 'new-folder',
      targetPath: parentDir,
      initialValue: '',
    });
  }, []);

  const handleStartRename = useCallback((path: string, currentName: string) => {
    setInlineInput({
      type: 'rename',
      targetPath: path,
      initialValue: currentName,
    });
  }, []);

  const handleHeaderNewFile = () => {
    if (!currentFolderPath) return;
    const targetDir = selectedPath || currentFolderPath;
    handleStartNewFile(targetDir);
  };

  const handleHeaderNewFolder = () => {
    if (!currentFolderPath) return;
    const targetDir = selectedPath || currentFolderPath;
    handleStartNewFolder(targetDir);
  };

  return (
    <aside className={styles.sidebar} style={{ width: sidebarWidth }}>
      <div className={styles.header}>
        <div className={styles.titleWrapper} title={currentFolderPath || t('explorer.title')}>
          <Folder size={14} className={styles.folderIcon} />
          <span className={styles.title}>
            {currentFolderPath ? folderName : t('explorer.title')}
          </span>
        </div>

        {currentFolderPath && (
          <div className={styles.headerActions}>
            <button
              className={styles.actionBtn}
              onClick={handleHeaderNewFile}
              title={t('explorer.newFile')}
            >
              <FilePlus size={14} />
            </button>
            <button
              className={styles.actionBtn}
              onClick={handleHeaderNewFolder}
              title={t('explorer.newFolder')}
            >
              <FolderPlus size={14} />
            </button>
            <button
              className={styles.actionBtn}
              onClick={refreshTree}
              title={t('explorer.refresh')}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className={styles.actionBtn}
              onClick={collapseAllFolders}
              title={t('explorer.collapseAll')}
            >
              <ChevronsDownUp size={14} />
            </button>
            <button
              className={styles.actionBtn}
              onClick={closeFolder}
              title={t('menu.file.closeFolder')}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {currentFolderPath ? (
        <FileTree
          rootPath={currentFolderPath}
          inlineInput={inlineInput}
          onClearInlineInput={() => setInlineInput(null)}
          onStartNewFile={handleStartNewFile}
          onStartNewFolder={handleStartNewFolder}
          onStartRename={handleStartRename}
        />
      ) : (
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>{t('explorer.noFolder')}</p>
          <button className={styles.openFolderBtn} onClick={openFolder}>
            <FolderOpen size={16} />
            <span>{t('explorer.openFolder')}</span>
          </button>
        </div>
      )}
    </aside>
  );
};
