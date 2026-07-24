import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { activeTabAtom, tabsAtom, languageDefsAtom, supportedEncodingsAtom, editorPrefsAtom } from './store/atoms';
import { customKeybindingsAtom, initKeybindingsFromFile } from './store/keybindings';
import { useTranslation } from './i18n';
import { splitLayoutAtom } from './store/splitAtoms';
import { MenuBar } from './components/menubar/MenuBar';
import { Toolbar } from './components/toolbar/Toolbar';
import { TabBar } from './components/tabs/TabBar';
import { Editor } from './components/editor/Editor';
import { EditorPane } from './components/layout/EditorPane';
import { SearchPanel } from './components/editor/SearchPanel';
import { StatusBar } from './components/statusbar/StatusBar';
import { CloseConfirmDialog } from './components/dialogs/CloseConfirmDialog';
import { ExternalChangeDialog } from './components/dialogs/ExternalChangeDialog';
import { KeyboardShortcutsDialog } from './components/dialogs/KeyboardShortcutsDialog';
import { useFile } from './hooks/useFile';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useWindowClose } from './hooks/useWindowClose';
import { usePrefsPersist } from './hooks/usePrefsPersist';
import { useKeybindingDispatcher } from './hooks/useKeybindingDispatcher';
import * as cmd from './store/tauriCommands';
import { listen } from '@tauri-apps/api/event';
import { highlightSearchMatches } from './store/editorViewRegistry';
import type { SearchMatch } from './types';
import './App.css';

export default function App() {
  const activeTab = useAtomValue(activeTabAtom);
  const tabs = useAtomValue(tabsAtom);
  const prefs = useAtomValue(editorPrefsAtom);
  const splitLayout = useAtomValue(splitLayoutAtom);
  const setLanguageDefs = useSetAtom(languageDefsAtom);
  const setSupportedEncodings = useSetAtom(supportedEncodingsAtom);
  const setCustomKeybindings = useSetAtom(customKeybindingsAtom);
  const { newFile, openFile } = useFile();

  useSessionRestore();
  useWindowClose();
  usePrefsPersist();
  useFileWatcher();
  useKeybindingDispatcher();

  useEffect(() => {
    initKeybindingsFromFile().then((data) => {
      if (data) setCustomKeybindings(data);
    });
  }, [setCustomKeybindings]);

  useEffect(() => {
    document.documentElement.lang = prefs.locale;
  }, [prefs.locale]);

  useEffect(() => {
    const unlisten = listen<string>('app:open-file', (event) => {
      if (event.payload) openFile(event.payload).catch(console.error);
    });
    return () => { unlisten.then((f) => f()); };
  }, [openFile]);

  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
      for (const path of event.payload.paths) {
        openFile(path).catch(console.error);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [openFile]);

  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);

  useEffect(() => {
    cmd.loadWordfiles().then((defs) => {
      const langs = defs.flatMap((d) => d.languages);
      setLanguageDefs(langs);
    }).catch(() => {});

    cmd.getSupportedEncodings().then(setSupportedEncodings).catch(console.error);
  }, [setLanguageDefs, setSupportedEncodings]);

  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursorLine(line);
    setCursorCol(col);
  }, []);

  const handleMatchesFound = useCallback(
    (matches: SearchMatch[], current: number, noScroll?: boolean) => {
      if (activeTab) {
        highlightSearchMatches(activeTab.bufferId, matches, current, noScroll).catch(console.error);
      }
    },
    [activeTab],
  );

  // ── Split-handle drag logic ────────────────────────────────────
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const primaryPaneRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const container = splitContainerRef.current;
    const primary = primaryPaneRef.current;
    if (!container || !primary) return;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const rect = container.getBoundingClientRect();
      if (splitLayout === 'horizontal') {
        const ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width));
        primary.style.flex = `0 0 ${ratio * 100}%`;
      } else {
        const ratio = Math.min(0.85, Math.max(0.15, (ev.clientY - rect.top) / rect.height));
        primary.style.flex = `0 0 ${ratio * 100}%`;
      }
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitLayout]);

  return (
    <div className="app" data-theme={prefs.theme}>
      <MenuBar />
      <Toolbar />

      {splitLayout === 'none' ? (
        /* ── Single-pane layout (original) ── */
        <>
          <TabBar />
          <div className="editor-area">
            {tabs.length === 0 ? (
              <WelcomeScreen onNew={newFile} />
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  style={{ display: tab.id === activeTab?.id ? 'contents' : 'none' }}
                >
                  <Editor tab={tab} onCursorChange={handleCursorChange} />
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        /* ── Split-pane layout ── */
        <div
          ref={splitContainerRef}
          className={`editor-area editor-split ${splitLayout === 'horizontal' ? 'editor-split-h' : 'editor-split-v'}`}
        >
          <div ref={primaryPaneRef} className="split-primary">
            <EditorPane
              paneId="primary"
              onCursorChange={handleCursorChange}
            />
          </div>
          <div
            className={`split-handle ${splitLayout === 'horizontal' ? 'split-handle-h' : 'split-handle-v'}`}
            onMouseDown={handleDragStart}
          />
          <EditorPane
            paneId="secondary"
            onCursorChange={handleCursorChange}
          />
        </div>
      )}

      <SearchPanel onMatchesFound={handleMatchesFound} />
      <StatusBar cursorLine={cursorLine} cursorCol={cursorCol} />
      <CloseConfirmDialog />
      <ExternalChangeDialog />
      <KeyboardShortcutsDialog />
    </div>
  );
}

function WelcomeScreen({ onNew }: { onNew: () => void }) {
  const t = useTranslation();
  return (
    <div className="welcome">
      <div className="welcome-content">
        <h1>Power Editor</h1>
        <p>{t('app.tagline')}</p>
        <div className="welcome-actions">
          <button onClick={onNew}>{t('app.newFile')}</button>
          <span className="hint">{t('app.dropHint')}</span>
        </div>
        <ul className="features">
          <li>{t('app.feature.largeFile')}</li>
          <li>{t('app.feature.wordfile')}</li>
          <li>{t('app.feature.encoding')}</li>
          <li>{t('app.feature.tools')}</li>
        </ul>
      </div>
    </div>
  );
}
