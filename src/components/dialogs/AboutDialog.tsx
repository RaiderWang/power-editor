import React, { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
import { useTranslation } from '../../i18n';
import styles from './AboutDialog.module.css';

interface AboutDialogProps {
  onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ onClose }) => {
  const t = useTranslation();
  const [version, setVersion] = useState<string>('...');

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('?'));
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.appIcon}>⚡</div>
          <h2 className={styles.appName}>Power Editor</h2>
          <p className={styles.version}>v{version}</p>
        </div>
        <p className={styles.tagline}>{t('app.tagline')}</p>
        <div className={styles.divider} />
        <div className={styles.developer}>
          <span className={styles.developerName}>Rick Wang</span>
          <button
            className={styles.developerHandle}
            onClick={() => open('https://x.com/leirenwangz').catch(console.error)}
          >
            @leirenwangz
          </button>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnClose} onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
