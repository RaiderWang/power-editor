import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  activeTabAtom,
  columnModeAtom,
  editorPrefsAtom,
  languageDefsAtom,
  searchOpenAtom,
  searchTriggerAtom,
  supportedEncodingsAtom,
  tabsAtom,
} from '../../store/atoms';
import { splitLayoutAtom, secondaryActiveTabIdAtom } from '../../store/splitAtoms';
import { customKeybindingsAtom, keybindingsDialogOpenAtom, getEffectiveShortcut } from '../../store/keybindings';
import { useFile } from '../../hooks/useFile';
import * as cmd from '../../store/tauriCommands';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { recentFilesAtom } from '../../store/recentFiles';
import { favoriteFilesAtom, toggleFavorite, saveFavoriteFiles } from '../../store/favoriteFiles';
import { FontPickerModal } from './FontPickerModal';
import { RenameDialog } from '../dialogs/RenameDialog';
import { CsvToFixedWidthDialog } from '../dialogs/CsvToFixedWidthDialog';
import { AboutDialog } from '../dialogs/AboutDialog';
import { getTabSaveDefaultPath } from '../../utils/tabFileName';
import { deleteCurrentLine, transformCase } from '../../store/editorViewRegistry';
import { useTranslation } from '../../i18n';
import type { Locale } from '../../store/editorPrefs';
import styles from './MenuBar.module.css';

const IS_WINDOWS = navigator.userAgent.includes('Windows');

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type MenuItem =
  | { kind: 'item'; label: string; shortcut?: string; checked?: boolean; disabled?: boolean; onClick: () => void }
  | { kind: 'sep' }
  | { kind: 'sectionLabel'; label: string }
  | { kind: 'scrollList'; items: ScrollListItem[] }
  | { kind: 'submenu'; label: string; items: SubMenuItem[] };

interface ScrollListItem {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface SubMenuItem {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

// ─────────────────────────────────────────────
// DropdownPanel
// ─────────────────────────────────────────────

interface DropdownPanelProps {
  items: MenuItem[];
  offsetLeft: number;
  onClose: () => void;
}

const DropdownPanel: React.FC<DropdownPanelProps> = ({ items, offsetLeft, onClose }) => {
  const [openSubmenuIdx, setOpenSubmenuIdx] = useState<number | null>(null);

  return (
    <div className={styles.dropdown} style={{ left: offsetLeft }} onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) => {
        if (item.kind === 'sep') {
          return <div key={i} className={styles.dropdownSeparator} />;
        }
        if (item.kind === 'sectionLabel') {
          return <div key={i} className={styles.dropdownSectionLabel}>{item.label}</div>;
        }
        if (item.kind === 'scrollList') {
          return (
            <div key={i} className={styles.dropdownScrollList}>
              {item.items.map((si, j) => (
                <button
                  key={j}
                  className={`${styles.dropdownItem} ${si.checked ? styles.checked : ''}`}
                  disabled={si.disabled}
                  onClick={() => { si.onClick(); onClose(); }}
                >
                  {si.label}
                </button>
              ))}
            </div>
          );
        }
        if (item.kind === 'submenu') {
          const isOpen = openSubmenuIdx === i;
          return (
            <div
              key={i}
              className={styles.submenuWrapper}
              onMouseEnter={() => setOpenSubmenuIdx(i)}
              onMouseLeave={() => setOpenSubmenuIdx(null)}
            >
              <button className={`${styles.dropdownItem} ${styles.submenuTrigger}`}>
                {item.label}
                <span className={styles.submenuArrow}>▶</span>
              </button>
              {isOpen && (
                <div className={styles.submenuPanel}>
                  {item.items.map((si, j) => (
                    <button
                      key={j}
                      className={styles.dropdownItem}
                      disabled={si.disabled}
                      onClick={() => { if (!si.disabled) { si.onClick(); onClose(); } }}
                      title={si.label}
                    >
                      {si.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            key={i}
            className={`${styles.dropdownItem} ${item.checked ? styles.checked : ''}`}
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.label}
            {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────
// MenuBar
// ─────────────────────────────────────────────

export const MenuBar: React.FC = () => {
  const activeTab = useAtomValue(activeTabAtom);
  const [prefs, setPrefs] = useAtom(editorPrefsAtom);
  const [columnMode, setColumnMode] = useAtom(columnModeAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);
  const setSearchTrigger = useSetAtom(searchTriggerAtom);
  const openSearch = useCallback(() => { setSearchOpen(true); setSearchTrigger((n) => n + 1); }, [setSearchOpen, setSearchTrigger]);
  const encodings = useAtomValue(supportedEncodingsAtom);
  const langDefs = useAtomValue(languageDefsAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const setLangDefs = useSetAtom(languageDefsAtom);

  const t = useTranslation();
  const { openFile, newFile, closeTab, saveFile, saveFileAs, renameFile } = useFile();
  const recentFiles = useAtomValue(recentFilesAtom);
  const [favoriteFiles, setFavoriteFiles] = useAtom(favoriteFilesAtom);

  const [splitLayout, setSplitLayout] = useAtom(splitLayoutAtom);
  const [, setSecondaryActiveTabId] = useAtom(secondaryActiveTabIdAtom);

  const customs = useAtomValue(customKeybindingsAtom);
  const setKeybindingsDialogOpen = useSetAtom(keybindingsDialogOpenAtom);
  const shortcut = useCallback((id: string) => getEffectiveShortcut(id, customs), [customs]);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState<'registered' | 'needs_update' | 'not_registered'>('not_registered');
  const barRef = useRef<HTMLDivElement>(null);

  // Track button positions for dropdown offset
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const getOffset = (name: string): number => {
    const btn = btnRefs.current[name];
    const bar = barRef.current;
    if (!btn || !bar) return 0;
    return btn.offsetLeft;
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Shared handlers ──────────────────────────────────

  const handleNewFile = useCallback(() => {
    newFile().catch(console.error);
  }, [newFile]);

  const handleOpen = useCallback(async () => {
    try {
      const selected = await open({ multiple: false });
      if (typeof selected === 'string' && selected) {
        await openFile(selected);
      }
    } catch (err) {
      console.error('[MenuBar] open failed:', err);
    }
  }, [openFile]);

  const handleOpenRecent = useCallback(async (path: string) => {
    try {
      await openFile(path);
    } catch (err) {
      await message(t('dialog.openError', { path, err: String(err) }), { title: t('dialog.openFailed'), kind: 'error' });
    }
  }, [openFile, t]);

  const handleOpenFavorite = useCallback(async (path: string) => {
    try {
      await openFile(path);
    } catch {
      const remove = await ask(
        t('dialog.openErrorFav', { path }),
        { title: t('dialog.openFailed'), kind: 'error', okLabel: t('dialog.removeFav'), cancelLabel: t('dialog.keep') },
      );
      if (remove) {
        setFavoriteFiles((prev) => {
          const next = prev.filter((p) => p !== path);
          saveFavoriteFiles(next);
          return next;
        });
      }
    }
  }, [openFile, setFavoriteFiles, t]);

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
      console.error('[MenuBar] save failed:', err);
    }
  }, [activeTab, saveFile, saveFileAs]);

  const handleSaveAs = useCallback(async () => {
    if (!activeTab) return;
    try {
      const savePath = await save({
        defaultPath: getTabSaveDefaultPath(activeTab),
      });
      if (savePath) await saveFileAs(activeTab.id, savePath);
    } catch (err) {
      console.error('[MenuBar] save-as failed:', err);
    }
  }, [activeTab, saveFileAs]);

  const handleCloseTab = useCallback(() => {
    if (activeTab) closeTab(activeTab.id).catch(console.error);
  }, [activeTab, closeTab]);

  const handleToggleFavorite = useCallback(() => {
    const path = activeTab?.fileInfo.path;
    if (!path) return;
    setFavoriteFiles((prev) => {
      const next = toggleFavorite(prev, path);
      saveFavoriteFiles(next);
      return next;
    });
  }, [activeTab, setFavoriteFiles]);

  const handleCopyFilePath = useCallback(async () => {
    const path = activeTab?.fileInfo.path;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      console.error('[MenuBar] copy file path failed:', err);
    }
  }, [activeTab]);

  const handleDeleteLine = useCallback(() => {
    if (!activeTab) return;
    deleteCurrentLine(activeTab.bufferId);
  }, [activeTab]);

  const handleToUpperCase = useCallback(() => {
    if (!activeTab) return;
    transformCase(activeTab.bufferId, 'upper');
  }, [activeTab]);

  const handleToLowerCase = useCallback(() => {
    if (!activeTab) return;
    transformCase(activeTab.bufferId, 'lower');
  }, [activeTab]);

  // Load Explorer integration status on Windows
  useEffect(() => {
    if (!IS_WINDOWS) return;
    cmd.checkExplorerIntegration()
      .then((s) => setIntegrationStatus(s as typeof integrationStatus))
      .catch(console.error);
  }, []);

  const handleRegisterIntegration = useCallback(async () => {
    try {
      const current = await cmd.checkExplorerIntegration();
      if (current === 'registered') {
        await message(t('dialog.explorerAlready'), { title: t('dialog.explorerTitle'), kind: 'info' });
        return;
      }
      await cmd.registerExplorerIntegration();
      setIntegrationStatus('registered');
      await message(t('dialog.explorerSuccess'), { title: t('dialog.explorerTitle'), kind: 'info' });
    } catch (err) {
      await message(t('dialog.explorerRegFail', { err: String(err) }), { title: t('dialog.explorerTitle'), kind: 'error' });
    }
  }, [t]);

  const handleUnregisterIntegration = useCallback(async () => {
    try {
      await cmd.unregisterExplorerIntegration();
      setIntegrationStatus('not_registered');
      await message(t('dialog.explorerUnregDone'), { title: t('dialog.explorerTitle'), kind: 'info' });
    } catch (err) {
      await message(t('dialog.explorerUnregFail', { err: String(err) }), { title: t('dialog.explorerTitle'), kind: 'error' });
    }
  }, [t]);

  const handleEncoding = useCallback(async (enc: string) => {
    if (!activeTab) return;
    try {
      const info = await cmd.changeEncoding(activeTab.bufferId, enc);
      setTabs((prev) =>
        prev.map((t) => (t.bufferId === activeTab.bufferId ? { ...t, fileInfo: info } : t))
      );
    } catch (err) {
      console.error('[MenuBar] encoding failed:', err);
    }
  }, [activeTab, setTabs]);

  const handleLineEnding = useCallback(async (le: 'LF' | 'CRLF') => {
    if (!activeTab) return;
    try {
      const info = await cmd.convertLineEndings(activeTab.bufferId, le);
      setTabs((prev) =>
        prev.map((t) => (t.bufferId === activeTab.bufferId ? { ...t, fileInfo: info } : t))
      );
    } catch (err) {
      console.error('[MenuBar] line-ending failed:', err);
    }
  }, [activeTab, setTabs]);

  const handleLanguage = useCallback((name: string) => {
    if (!activeTab) return;
    if (!name) {
      setTabs((prev) => prev.map((t) => t.id === activeTab.id ? { ...t, language: null } : t));
      return;
    }
    const def = langDefs.find((d) => d.name === name);
    if (def && def.extensions.length > 0) {
      setTabs((prev) =>
        prev.map((t) => t.id === activeTab.id ? { ...t, language: def.extensions[0] } : t)
      );
    }
  }, [activeTab, langDefs, setTabs]);

  const handleImportWordfile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'UltraEdit Wordfile', extensions: ['uew'] }],
      });
      if (typeof selected !== 'string' || !selected) return;
      const def = await cmd.saveImportedWordfile(selected);
      setLangDefs((prev) => {
        const incoming = def.languages;
        // replace existing by name, append new
        const merged = [...prev];
        for (const lang of incoming) {
          const idx = merged.findIndex((l) => l.name === lang.name);
          if (idx >= 0) merged[idx] = lang;
          else merged.push(lang);
        }
        return merged;
      });
    } catch (err) {
      console.error('[MenuBar] import wordfile failed:', err);
    }
  }, [setLangDefs]);

  // ── Current language display name ────────────────────

  const currentLangName = useMemo(() => {
    if (!activeTab?.language) return '';
    const def = langDefs.find((d) => d.extensions.includes(activeTab.language!));
    return def ? def.name : '';
  }, [activeTab, langDefs]);

  const currentEncoding = activeTab?.fileInfo.encoding ?? '';
  const currentLineEnding = activeTab?.fileInfo.line_ending === 'CRLF' ? 'CRLF' : 'LF';

  // ── Menu definitions ─────────────────────────────────

  const isCurrentFavorited = !!(activeTab?.fileInfo.path && favoriteFiles.includes(activeTab.fileInfo.path));

  const handleSetLocale = useCallback((locale: Locale) => {
    setPrefs((p) => ({ ...p, locale }));
  }, [setPrefs]);

  const settingsSubmenuItems: SubMenuItem[] = [
    { label: t('menu.file.keybindSettings'), onClick: () => setKeybindingsDialogOpen(true) },
    ...(IS_WINDOWS ? [
      {
        label: integrationStatus === 'registered'
          ? t('menu.file.explorerIntegrated')
          : integrationStatus === 'needs_update'
            ? t('menu.file.explorerUpdate')
            : t('menu.file.explorerIntegrate'),
        onClick: handleRegisterIntegration,
      },
      {
        label: t('menu.file.explorerUnregister'),
        disabled: integrationStatus === 'not_registered',
        onClick: handleUnregisterIntegration,
      },
    ] : []),
  ];

  const languageSubmenuItems: SubMenuItem[] = [
    { label: `${t('menu.file.langZh')}${prefs.locale === 'zh-CN' ? ' ✓' : ''}`, onClick: () => handleSetLocale('zh-CN') },
    { label: `${t('menu.file.langEn')}${prefs.locale === 'en-US' ? ' ✓' : ''}`, onClick: () => handleSetLocale('en-US') },
  ];

  const fileMenu: MenuItem[] = [
    { kind: 'item', label: t('menu.file.new'), shortcut: shortcut('file.new'), onClick: handleNewFile },
    { kind: 'item', label: t('menu.file.open'), shortcut: shortcut('file.open'), onClick: handleOpen },
    { kind: 'sep' },
    {
      kind: 'submenu',
      label: t('menu.file.recentOpen'),
      items: recentFiles.length > 0
        ? recentFiles.map((p) => ({ label: p, onClick: () => handleOpenRecent(p) }))
        : [{ label: t('menu.file.noRecords'), disabled: true, onClick: () => {} }],
    },
    {
      kind: 'item',
      label: isCurrentFavorited ? t('menu.file.unfavorite') : t('menu.file.favorite'),
      checked: isCurrentFavorited,
      disabled: !activeTab?.fileInfo.path,
      onClick: handleToggleFavorite,
    },
    {
      kind: 'submenu',
      label: t('menu.file.favoriteFiles'),
      items: favoriteFiles.length > 0
        ? favoriteFiles.map((p) => ({ label: p, onClick: () => handleOpenFavorite(p) }))
        : [{ label: t('menu.file.noRecords'), disabled: true, onClick: () => {} }],
    },
    { kind: 'sep' },
    { kind: 'item', label: t('menu.file.save'), shortcut: shortcut('file.save'), disabled: !activeTab, onClick: handleSave },
    { kind: 'item', label: t('menu.file.saveAs'), shortcut: shortcut('file.saveAs'), disabled: !activeTab, onClick: handleSaveAs },
    { kind: 'sep' },
    { kind: 'item', label: t('menu.file.closeTab'), shortcut: shortcut('file.closeTab'), disabled: !activeTab, onClick: handleCloseTab },
    { kind: 'sep' },
    { kind: 'submenu', label: t('menu.file.settings'), items: settingsSubmenuItems },
    { kind: 'submenu', label: t('menu.file.langLabel'), items: languageSubmenuItems },
  ];

  const editMenu: MenuItem[] = [
    { kind: 'item', label: t('menu.edit.findReplace'), shortcut: shortcut('search.find'), onClick: openSearch },
    { kind: 'item', label: t('menu.edit.deleteLine'), shortcut: shortcut('edit.deleteLine'), disabled: !activeTab, onClick: handleDeleteLine },
    { kind: 'sep' },
    { kind: 'item', label: t('menu.edit.toUpperCase'), shortcut: shortcut('edit.toUpperCase'), disabled: !activeTab, onClick: handleToUpperCase },
    { kind: 'item', label: t('menu.edit.toLowerCase'), shortcut: shortcut('edit.toLowerCase'), disabled: !activeTab, onClick: handleToLowerCase },
    { kind: 'sep' },
    {
      kind: 'item',
      label: t('menu.edit.rename'),
      disabled: !activeTab,
      onClick: () => setShowRenameDialog(true),
    },
    {
      kind: 'item',
      label: t('menu.edit.copyPath'),
      shortcut: shortcut('edit.copyPath'),
      disabled: !activeTab?.fileInfo.path,
      onClick: () => { handleCopyFilePath().catch(console.error); },
    },
    { kind: 'sep' },
    {
      kind: 'item',
      label: t('menu.edit.csvToFixed'),
      disabled: !activeTab,
      onClick: () => setShowCsvDialog(true),
    },
  ];

  const viewMenu: MenuItem[] = [
    {
      kind: 'item',
      label: t('menu.view.lineWrap'),
      shortcut: shortcut('view.lineWrap'),
      checked: prefs.lineWrap,
      onClick: () => setPrefs((p) => ({ ...p, lineWrap: !p.lineWrap })),
    },
    {
      kind: 'item',
      label: t('menu.view.columnMode'),
      shortcut: shortcut('view.columnMode'),
      checked: columnMode,
      onClick: () => setColumnMode((v) => !v),
    },
    { kind: 'sep' },
    {
      kind: 'item',
      label: t('menu.view.fontSizeUp'),
      shortcut: shortcut('view.fontSizeUp'),
      onClick: () => setPrefs((p) => ({ ...p, fontSize: Math.min(48, p.fontSize + 1) })),
    },
    {
      kind: 'item',
      label: t('menu.view.fontSizeDown'),
      shortcut: shortcut('view.fontSizeDown'),
      onClick: () => setPrefs((p) => ({ ...p, fontSize: Math.max(8, p.fontSize - 1) })),
    },
    {
      kind: 'item',
      label: t('menu.view.selectFont'),
      onClick: () => setShowFontPicker(true),
    },
    { kind: 'sep' },
    {
      kind: 'item',
      label: prefs.theme === 'dark' ? t('menu.view.toLight') : t('menu.view.toDark'),
      shortcut: shortcut('view.toggleTheme'),
      onClick: () => setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' })),
    },
    { kind: 'sep' },
    {
      kind: 'submenu',
      label: t('menu.view.split'),
      items: [
        {
          label: `${t('menu.view.splitH')}${splitLayout === 'horizontal' ? ' ✓' : ''}`,
          onClick: () => {
            if (splitLayout === 'none') {
              setSecondaryActiveTabId(activeTab?.id ?? null);
            }
            setSplitLayout('horizontal');
          },
        },
        {
          label: `${t('menu.view.splitV')}${splitLayout === 'vertical' ? ' ✓' : ''}`,
          onClick: () => {
            if (splitLayout === 'none') {
              setSecondaryActiveTabId(activeTab?.id ?? null);
            }
            setSplitLayout('vertical');
          },
        },
        {
          label: t('menu.view.closeSplit'),
          disabled: splitLayout === 'none',
          onClick: () => {
            setSplitLayout('none');
            setSecondaryActiveTabId(null);
          },
        },
      ],
    },
  ];

  const noTab = !activeTab;

  const formatMenu: MenuItem[] = [
    { kind: 'sectionLabel', label: t('menu.format.encoding') },
    {
      kind: 'scrollList',
      items: encodings.map((enc) => ({
        label: enc,
        checked: enc === currentEncoding,
        disabled: noTab,
        onClick: () => handleEncoding(enc),
      })),
    },
    { kind: 'sep' },
    { kind: 'sectionLabel', label: t('menu.format.lineEnding') },
    { kind: 'item', label: 'LF (Unix)', checked: currentLineEnding === 'LF', disabled: noTab, onClick: () => handleLineEnding('LF') },
    { kind: 'item', label: 'CRLF (Windows)', checked: currentLineEnding === 'CRLF', disabled: noTab, onClick: () => handleLineEnding('CRLF') },
  ];

  const languageMenu: MenuItem[] = [
    { kind: 'item', label: 'Plain Text', checked: !currentLangName, disabled: noTab, onClick: () => handleLanguage('') },
    ...langDefs.map<MenuItem>((def) => ({
      kind: 'item',
      label: def.name,
      checked: def.name === currentLangName,
      disabled: noTab,
      onClick: () => handleLanguage(def.name),
    })),
    { kind: 'sep' },
    { kind: 'item', label: t('menu.language.importWordfile'), onClick: handleImportWordfile },
  ];

  // ── Menu list ────────────────────────────────────────

  const helpMenu: MenuItem[] = [
    { kind: 'item', label: t('menu.help.about'), onClick: () => setShowAboutDialog(true) },
  ];

  const menus: Array<{ name: string; label: string; items: MenuItem[] }> = [
    { name: 'file', label: t('menu.file'), items: fileMenu },
    { name: 'edit', label: t('menu.edit'), items: editMenu },
    { name: 'view', label: t('menu.view'), items: viewMenu },
    { name: 'format', label: t('menu.format'), items: formatMenu },
    { name: 'language', label: t('menu.language'), items: languageMenu },
    { name: 'help', label: t('menu.help'), items: helpMenu },
  ];

  const toggle = (name: string) => setOpenMenu((prev) => (prev === name ? null : name));

  return (
    <>
      <div className={styles.menubar} ref={barRef}>
        {menus.map(({ name, label, items }) => {
          const isOpen = openMenu === name;
          return (
            <React.Fragment key={name}>
              <button
                ref={(el) => { btnRefs.current[name] = el; }}
                className={`${styles.menuTrigger} ${isOpen ? styles.open : ''}`}
                onClick={() => toggle(name)}
              >
                {label}
              </button>
              {isOpen && (
                <DropdownPanel
                  items={items}
                  offsetLeft={getOffset(name)}
                  onClose={() => setOpenMenu(null)}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {showFontPicker && (
        <FontPickerModal
          currentFont={prefs.fontFamily}
          onApply={(font) => {
            setPrefs((p) => ({ ...p, fontFamily: font }));
            setShowFontPicker(false);
          }}
          onClose={() => setShowFontPicker(false)}
        />
      )}

      {showRenameDialog && activeTab && (
        <RenameDialog
          tab={activeTab}
          onConfirm={(newFileName) => renameFile(activeTab.id, newFileName)}
          onClose={() => setShowRenameDialog(false)}
        />
      )}

      {showCsvDialog && activeTab && (
        <CsvToFixedWidthDialog
          tab={activeTab}
          onClose={() => setShowCsvDialog(false)}
        />
      )}

      {showAboutDialog && (
        <AboutDialog onClose={() => setShowAboutDialog(false)} />
      )}
    </>
  );
};
