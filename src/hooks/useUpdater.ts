import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  availableUpdateAtom,
  updateDetailsAtom,
  updateStatusAtom,
  updateProgressAtom,
  updateErrorAtom,
  updateDialogOpenAtom,
} from '../store/updaterAtoms';
import { editorPrefsAtom, tabsAtom, activeTabIdAtom } from '../store/atoms';
import { persistAppSession } from '../utils/sessionPersist';

export function useUpdater() {
  const [status, setStatus] = useAtom(updateStatusAtom);
  const [details, setDetails] = useAtom(updateDetailsAtom);
  const [progress, setProgress] = useAtom(updateProgressAtom);
  const [error, setError] = useAtom(updateErrorAtom);
  const [dialogOpen, setDialogOpen] = useAtom(updateDialogOpenAtom);
  const setAvailableUpdate = useSetAtom(availableUpdateAtom);
  const availableUpdate = useAtomValue(availableUpdateAtom);

  const [prefs, setPrefs] = useAtom(editorPrefsAtom);
  const tabs = useAtomValue(tabsAtom);
  const activeTabId = useAtomValue(activeTabIdAtom);

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const availableUpdateRef = useRef(availableUpdate);
  const statusRef = useRef(status);
  const prefsRef = useRef(prefs);

  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
  useEffect(() => { availableUpdateRef.current = availableUpdate; }, [availableUpdate]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);

  const checkForUpdates = useCallback(
    async (silent: boolean = false) => {
      // Guard against concurrent checks or interrupting active download/install
      const currentStatus = statusRef.current;
      if (currentStatus === 'downloading' || currentStatus === 'installing' || currentStatus === 'checking') {
        if (!silent) {
          setDialogOpen(true);
        }
        return;
      }

      try {
        if (!silent) {
          setDialogOpen(true);
          setStatus('checking');
          setError(null);
        }

        const update = await check();

        if (update) {
          setAvailableUpdate(update);
          setDetails({
            version: update.version,
            currentVersion: update.currentVersion,
            date: update.date,
            body: update.body,
          });

          // If this version was explicitly skipped by the user, ignore in silent check
          const skippedVersion = prefsRef.current.skippedUpdateVersion;
          if (silent && skippedVersion === update.version) {
            setStatus('idle');
            return;
          }

          setStatus('available');
        } else {
          setAvailableUpdate(null);
          if (!silent) {
            const currentVersion = await getVersion().catch(() => '');
            setDetails({
              version: currentVersion,
              currentVersion,
            });
            setStatus('upToDate');
          } else {
            setStatus('idle');
          }
        }
      } catch (err) {
        console.error('[useUpdater] check error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        if (!silent) {
          setError(msg);
          setStatus('error');
        } else {
          setStatus('idle');
        }
      }
    },
    [setAvailableUpdate, setDetails, setDialogOpen, setError, setStatus]
  );

  const startDownloadAndInstall = useCallback(async () => {
    const update = availableUpdateRef.current;
    if (!update) return;

    try {
      setStatus('downloading');
      setError(null);
      setProgress({ downloaded: 0, total: 0, percentage: 0 });

      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.download((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0;
          setProgress({
            downloaded: 0,
            total: totalBytes,
            percentage: 0,
          });
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          const percentage = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          setProgress({
            downloaded: downloadedBytes,
            total: totalBytes,
            percentage,
          });
        } else if (event.event === 'Finished') {
          setProgress({
            downloaded: totalBytes || downloadedBytes,
            total: totalBytes || downloadedBytes,
            percentage: 100,
          });
        }
      });

      setStatus('installing');

      // Crucial: Persist open tabs and unsaved scratch buffers before install kills or restarts the app!
      try {
        await persistAppSession(tabsRef.current, activeTabIdRef.current);
      } catch (persistErr) {
        console.warn('[useUpdater] session persist warning:', persistErr);
      }

      // Install downloaded package
      await update.install();

      // On macOS and Linux, relaunch the application.
      // On Windows passive install, the installer automatically restarts or prompts.
      try {
        await relaunch();
      } catch (relaunchErr) {
        console.warn('[useUpdater] relaunch triggered or handled by installer:', relaunchErr);
      }
    } catch (err) {
      console.error('[useUpdater] download/install error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
    }
  }, [setError, setProgress, setStatus]);

  const targetVersion = details?.version;
  const skipCurrentVersion = useCallback(() => {
    if (targetVersion) {
      setPrefs((p) => ({ ...p, skippedUpdateVersion: targetVersion }));
    }
    setStatus('idle');
    setDialogOpen(false);
  }, [targetVersion, setDialogOpen, setPrefs, setStatus]);

  return {
    status,
    details,
    progress,
    error,
    dialogOpen,
    setDialogOpen,
    checkForUpdates,
    startDownloadAndInstall,
    skipCurrentVersion,
  };
}

let startupCheckTriggered = false;

/**
 * Runs a silent update check 3 seconds after application mount.
 * Intended to be invoked once at the app root level (App.tsx).
 */
export function useAutoUpdateCheck() {
  const { checkForUpdates } = useUpdater();
  const prefs = useAtomValue(editorPrefsAtom);
  const prefsRef = useRef(prefs);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    if (startupCheckTriggered) return;
    startupCheckTriggered = true;

    const timer = setTimeout(() => {
      if (prefsRef.current.autoCheckUpdates) {
        checkForUpdates(true).catch(console.error);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [checkForUpdates]);
}
