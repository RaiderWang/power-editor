import React, { useCallback, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  FilePlus,
  FolderOpen,
  Save,
  Search,
  WrapText,
  Columns2,
  Sun,
  Moon,
  ALargeSmall,
  Minus,
  Plus,
} from 'lucide-react';
import {
  activeTabAtom,
  editorPrefsAtom,
  columnModeAtom,
  searchOpenAtom,
  searchTriggerAtom,
  supportedEncodingsAtom,
  tabsAtom,
  languageDefsAtom,
} from '../../store/atoms';
import { customKeybindingsAtom, getEffectiveShortcut } from '../../store/keybindings';
import { useFile } from '../../hooks/useFile';
import { getTabSaveDefaultPath } from '../../utils/tabFileName';
import * as cmd from '../../store/tauriCommands';
import { useTranslation } from '../../i18n';
import styles from './Toolbar.module.css';
import { open, save } from '@tauri-apps/plugin-dialog';

export const Toolbar: React.FC = () => {
  const activeTab = useAtomValue(activeTabAtom);
  const [prefs, setPrefs] = useAtom(editorPrefsAtom);
  const [columnMode, setColumnMode] = useAtom(columnModeAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);
  const setSearchTrigger = useSetAtom(searchTriggerAtom);
  const openSearch = useCallback(() => { setSearchOpen(true); setSearchTrigger((n) => n + 1); }, [setSearchOpen, setSearchTrigger]);
  const encodings = useAtomValue(supportedEncodingsAtom);
  const langDefs = useAtomValue(languageDefsAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const customs = useAtomValue(customKeybindingsAtom);
  const sk = useCallback((id: string) => {
    const s = getEffectiveShortcut(id, customs);
    return s ? ` (${s})` : '';
  }, [customs]);
  const t = useTranslation();
  const { openFile, newFile, saveFile, saveFileAs } = useFile();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Derive current language display name from tab.language + langDefs
  const currentLangName = useMemo(() => {
    if (!activeTab?.language) return '';
    const def = langDefs.find((d) => d.extensions.includes(activeTab.language!));
    return def ? def.name : '';
  }, [activeTab, langDefs]);

  const handleLanguageChange = useCallback((name: string) => {
    if (!activeTab) return;
    if (!name) {
      setTabs((prev) => prev.map((t) => t.id === activeTab.id ? { ...t, language: null } : t));
      return;
    }
    const def = langDefs.find((d) => d.name === name);
    if (def && def.extensions.length > 0) {
      setTabs((prev) => prev.map((t) => t.id === activeTab.id ? { ...t, language: def.extensions[0] } : t));
    }
  }, [activeTab, langDefs, setTabs]);

  const showError = useCallback((msg: string) => {
    console.error('[Toolbar]', msg);
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  }, []);

  const handleNewFile = useCallback(() => {
    newFile().catch((err) => showError(t('toolbar.newFail', { err: String(err) })));
  }, [newFile, showError, t]);

  const handleOpen = useCallback(async () => {
    try {
      const selected = await open({ multiple: false });
      if (typeof selected === 'string' && selected) {
        await openFile(selected);
      }
    } catch (err) {
      showError(t('toolbar.openFail', { err: String(err) }));
    }
  }, [openFile, showError, t]);

  const handleSave = useCallback(async () => {
    if (!activeTab) return;
    try {
      if (!activeTab.fileInfo.path) {
        const savePath = await save({ defaultPath: getTabSaveDefaultPath(activeTab) });
        if (savePath) await saveFileAs(activeTab.id, savePath);
      } else {
        await saveFile(activeTab.id);
      }
    } catch (err) {
      showError(t('toolbar.saveFail', { err: String(err) }));
    }
  }, [activeTab, saveFile, saveFileAs, showError, t]);

  const handleEncoding = useCallback(async (enc: string) => {
    if (!activeTab) return;
    try {
      // change_encoding converts the current buffer content to the new encoding
      // (updates save target encoding without re-reading from disk).
      const info = await cmd.changeEncoding(activeTab.bufferId, enc);
      setTabs((prev) =>
        prev.map((t) =>
          t.bufferId === activeTab.bufferId
            ? { ...t, fileInfo: info }
            : t
        )
      );
    } catch (err) {
      showError(t('toolbar.encodingFail', { err: String(err) }));
    }
  }, [activeTab, setTabs, showError, t]);

  const handleLineEnding = useCallback(async (le: 'LF' | 'CRLF') => {
    if (!activeTab) return;
    try {
      const info = await cmd.convertLineEndings(activeTab.bufferId, le);
      setTabs((prev) =>
        prev.map((tab) => (tab.bufferId === activeTab.bufferId ? { ...tab, fileInfo: info } : tab))
      );
    } catch (err) {
      showError(t('toolbar.lineEndingFail', { err: String(err) }));
    }
  }, [activeTab, setTabs, showError, t]);

  const adjustFontSize = useCallback((delta: number) => {
    setPrefs((p) => ({ ...p, fontSize: Math.min(48, Math.max(8, p.fontSize + delta)) }));
  }, [setPrefs]);

  const toggleTheme = useCallback(() => {
    setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }));
  }, [setPrefs]);

  return (
    <div className={styles.toolbar}>
      <button className={styles.btn} onClick={handleNewFile} title={`${t('toolbar.new')}${sk('file.new')}`}>
        <FilePlus size={16} />
      </button>
      <button className={styles.btn} onClick={handleOpen} title={`${t('toolbar.open')}${sk('file.open')}`}>
        <FolderOpen size={16} />
      </button>
      <button className={styles.btn} onClick={handleSave} title={`${t('toolbar.save')}${sk('file.save')}`} disabled={!activeTab}>
        <Save size={16} />
      </button>

      <div className={styles.separator} />

      <button className={styles.btn} onClick={openSearch} title={`${t('toolbar.findReplace')}${sk('search.find')}`}>
        <Search size={16} />
      </button>

      <div className={styles.separator} />

      <button
        className={`${styles.btn} ${prefs.lineWrap ? styles.active : ''}`}
        onClick={() => setPrefs((p) => ({ ...p, lineWrap: !p.lineWrap }))}
        title={t('toolbar.lineWrap')}
      >
        <WrapText size={16} />
      </button>

      <button
        className={`${styles.btn} ${columnMode ? styles.active : ''}`}
        onClick={() => setColumnMode((v) => !v)}
        title={t('toolbar.columnMode')}
      >
        <Columns2 size={16} />
      </button>

      <div className={styles.separator} />

      <div className={styles.fontSizeGroup} title={t('toolbar.fontSize')}>
        <ALargeSmall size={15} className={styles.groupIcon} />
        <button className={styles.iconBtn} onClick={() => adjustFontSize(-1)} title={t('toolbar.fontSizeDown')}>
          <Minus size={12} />
        </button>
        <span className={styles.fontSizeValue}>{prefs.fontSize}</span>
        <button className={styles.iconBtn} onClick={() => adjustFontSize(1)} title={t('toolbar.fontSizeUp')}>
          <Plus size={12} />
        </button>
      </div>

      <button
        className={styles.btn}
        onClick={toggleTheme}
        title={prefs.theme === 'dark' ? t('toolbar.toLight') : t('toolbar.toDark')}
      >
        {prefs.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div className={styles.separator} />

      {activeTab && (
        <>
          <select
            className={styles.select}
            value={activeTab.fileInfo.encoding}
            onChange={(e) => handleEncoding(e.target.value)}
            title={t('toolbar.encoding')}
          >
            {encodings.map((enc) => (
              <option key={enc} value={enc}>{enc}</option>
            ))}
          </select>

          <select
            className={styles.select}
            value={activeTab.fileInfo.line_ending === 'CRLF' ? 'CRLF' : 'LF'}
            onChange={(e) => handleLineEnding(e.target.value as 'LF' | 'CRLF')}
            title={t('toolbar.lineEnding')}
          >
            <option value="LF">LF</option>
            <option value="CRLF">CRLF</option>
          </select>

          <select
            className={styles.select}
            value={currentLangName}
            onChange={(e) => handleLanguageChange(e.target.value)}
            title={t('toolbar.language')}
            style={{ maxWidth: 100 }}
          >
            <option value="">Plain Text</option>
            {langDefs.map((def) => (
              <option key={def.name} value={def.name}>{def.name}</option>
            ))}
          </select>
        </>
      )}

      {/* 错误提示 */}
      {errorMsg && (
        <span className={styles.errorMsg} title={errorMsg}>
          ⚠ {errorMsg}
        </span>
      )}
    </div>
  );
};
