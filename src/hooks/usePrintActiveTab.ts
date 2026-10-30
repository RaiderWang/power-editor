import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { message } from '@tauri-apps/plugin-dialog';
import { activeTabAtom, editorPrefsAtom } from '../store/atoms';
import { isMarkdownLanguage } from '../extensions/builtinLanguages';
import { useTranslation } from '../i18n';
import { printTab, PRINT_PLAIN_MAX_BYTES } from '../print/printDocument';
import { getActiveSelection } from '../print/selectionHelper';

export function usePrintActiveTab() {
  const activeTab = useAtomValue(activeTabAtom);
  const prefs = useAtomValue(editorPrefsAtom);
  const t = useTranslation();

  const handlePrint = useCallback(async () => {
    if (!activeTab) return;

    const fileName = activeTab.fileInfo.path
      ? (activeTab.fileInfo.path.split(/[/\\]/).pop() ?? '')
      : (activeTab.untitledName ?? '');

    const isMarkdown = isMarkdownLanguage(activeTab.language);
    const selection = getActiveSelection(activeTab.bufferId);

    const result = await printTab({
      bufferId: activeTab.bufferId,
      filePath: activeTab.fileInfo.path || null,
      fileName,
      isMarkdown,
      totalBytes: activeTab.fileInfo.total_bytes,
      isFullyLoaded: activeTab.fileInfo.is_fully_loaded,
      lineNumbers: prefs.printLineNumbers,
      selection,
      frontmatterLabel: t('preview.frontmatter'),
    });

    if (!result.ok) {
      if (result.reason === 'loading') {
        await message(t('print.loading'), {
          title: t('print.title'),
          kind: 'warning',
        });
      } else if (result.reason === 'too_large') {
        const mb = Math.round(PRINT_PLAIN_MAX_BYTES / 1024 / 1024);
        await message(t('print.tooLarge', { max: mb }), {
          title: t('print.title'),
          kind: 'warning',
        });
      } else if (result.reason === 'empty') {
        await message(t('print.empty'), {
          title: t('print.title'),
          kind: 'info',
        });
      } else if (result.reason === 'error') {
        await message(t('print.failed'), {
          title: t('print.title'),
          kind: 'error',
        });
      }
    }
  }, [activeTab, prefs.printLineNumbers, t]);

  return { handlePrint };
}
