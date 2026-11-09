import React, { useEffect } from 'react';
import { useAtom } from 'jotai';
import { toastAtom } from '../../store/toastAtoms';
import styles from './ToastHost.module.css';

const TOAST_DURATION_MS = 3500;

/** Renders the current non-blocking toast (bottom-center) and dismisses it automatically. */
export const ToastHost: React.FC = () => {
  const [toast, setToast] = useAtom(toastAtom);
  const toastId = toast?.id ?? null;

  useEffect(() => {
    if (toastId === null) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toastId, setToast]);

  if (!toast) return null;

  return (
    <div className={styles.host} role="status" aria-live="polite">
      <div className={styles.toast} onClick={() => setToast(null)}>
        {toast.message}
      </div>
    </div>
  );
};
