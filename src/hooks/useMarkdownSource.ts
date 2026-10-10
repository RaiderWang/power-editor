import { useState, useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { activeTabAtom } from '../store/atoms';
import { previewEligibilityAtom } from '../store/previewAtoms';
import {
  ensureFullyLoaded,
  getEditorView,
  subscribeDocChange,
} from '../store/previewBridge';
import { getFullText } from '../store/tauriCommands';

export interface MarkdownSourceState {
  status: 'ready' | 'not_markdown' | 'loading' | 'too_large';
  content: string;
  bufferId: number;
  filePath: string | null;
  fileName: string;
}

export function useMarkdownSource(): MarkdownSourceState {
  const activeTab = useAtomValue(activeTabAtom);
  const eligibility = useAtomValue(previewEligibilityAtom);

  const [content, setContent] = useState('');
  const [isDocLoading, setIsDocLoading] = useState(false);

  const bufferId = activeTab?.bufferId ?? -1;
  const filePath = activeTab?.fileInfo.path || null;
  const fileName = activeTab
    ? (activeTab.fileInfo.path ? activeTab.fileInfo.path.split(/[/\\]/).pop() ?? '' : activeTab.untitledName ?? '')
    : '';

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive status
  let status: MarkdownSourceState['status'];
  if (!activeTab || !eligibility.canPreview) {
    status = eligibility.reason ?? 'not_markdown';
  } else if (isDocLoading) {
    status = 'loading';
  } else {
    status = 'ready';
  }

  const tabId = activeTab?.id;

  useEffect(() => {
    if (!tabId || bufferId < 0 || !eligibility.canPreview) {
      return;
    }

    const currentBufId = bufferId;
    let isCancelled = false;

    const loadContent = async () => {
      setIsDocLoading(true);

      // Ensure complete document is loaded into CodeMirror
      await ensureFullyLoaded(currentBufId);
      if (isCancelled) return;

      const view = getEditorView(currentBufId);
      let text = '';
      if (view) {
        text = view.state.doc.toString();
      } else {
        try {
          text = await getFullText(currentBufId);
        } catch (err) {
          console.error('[useMarkdownSource] getFullText error:', err);
        }
      }

      if (isCancelled) return;
      setContent(text);
      setIsDocLoading(false);
    };

    void loadContent();

    // Listen to document edits
    const unsubscribe = subscribeDocChange(currentBufId, () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (isCancelled) return;
        const view = getEditorView(currentBufId);
        if (view) {
          setContent(view.state.doc.toString());
        }
      }, 150);
    });

    return () => {
      isCancelled = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      unsubscribe();
    };
  }, [
    tabId,
    bufferId,
    eligibility.canPreview,
  ]);

  return {
    status,
    content: eligibility.canPreview ? content : '',
    bufferId,
    filePath,
    fileName,
  };
}
