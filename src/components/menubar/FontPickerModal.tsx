import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import styles from './FontPickerModal.module.css';

const PRESET_FONTS: Array<{ name: string; css: string }> = [
  { name: 'Consolas', css: 'Consolas, monospace' },
  { name: 'Cascadia Code', css: '"Cascadia Code", monospace' },
  { name: 'Cascadia Mono', css: '"Cascadia Mono", monospace' },
  { name: 'JetBrains Mono', css: '"JetBrains Mono", monospace' },
  { name: 'Fira Code', css: '"Fira Code", monospace' },
  { name: 'Source Code Pro', css: '"Source Code Pro", monospace' },
  { name: 'Courier New', css: '"Courier New", monospace' },
  { name: 'Monaco', css: 'Monaco, monospace' },
  { name: 'Menlo', css: 'Menlo, monospace' },
  { name: 'DejaVu Sans Mono', css: '"DejaVu Sans Mono", monospace' },
];

/** 用 Canvas measureText 检测字体是否真正可用（与 monospace 对比宽度）。 */
function isFontAvailable(fontName: string): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const testStr = 'mmmmmmmmmmlli';
    ctx.font = `16px monospace`;
    const baseWidth = ctx.measureText(testStr).width;
    ctx.font = `16px "${fontName}", monospace`;
    const testWidth = ctx.measureText(testStr).width;
    return testWidth !== baseWidth;
  } catch {
    return false;
  }
}

interface Props {
  currentFont: string;
  onApply: (fontFamily: string) => void;
  onClose: () => void;
}

export const FontPickerModal: React.FC<Props> = ({ currentFont, onApply, onClose }) => {
  const [selected, setSelected] = useState<string>(currentFont);
  const [custom, setCustom] = useState('');
  const t = useTranslation();

  const effective = custom.trim() ? `${custom.trim()}, monospace` : selected;

  // 检测每个预设字体是否在当前系统可用（仅计算一次）
  const availabilityMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const { name } of PRESET_FONTS) {
      map.set(name, isFontAvailable(name));
    }
    return map;
  }, []);

  const handlePreset = (css: string) => {
    setSelected(css);
    setCustom('');
  };

  const handleCustomChange = (v: string) => {
    setCustom(v);
    setSelected('');
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>{t('font.title')}</div>

        <div className={styles.body}>
          <div className={styles.fontList}>
            {PRESET_FONTS.map(({ name, css }) => {
              const available = availabilityMap.get(name) ?? false;
              return (
                <div
                  key={name}
                  className={`${styles.fontOption} ${selected === css && !custom ? styles.selected : ''} ${!available ? styles.unavailable : ''}`}
                  onClick={() => handlePreset(css)}
                  title={available ? undefined : t('font.unavailableHint')}
                >
                  <span className={styles.fontName}>
                    {name}
                    {!available && <span className={styles.unavailableBadge}>{t('font.unavailableBadge')}</span>}
                  </span>
                  <span className={styles.fontPreview} style={{ fontFamily: css }}>
                    AaBbCc 0123
                  </span>
                </div>
              );
            })}
          </div>

          <div>
            <div className={styles.customLabel}>{t('font.customLabel')}</div>
            <input
              className={styles.customInput}
              type="text"
              placeholder={t('font.customPlaceholder')}
              value={custom}
              onChange={(e) => handleCustomChange(e.target.value)}
            />
          </div>

          <div>
            <div className={styles.customLabel}>{t('font.previewLabel')}</div>
            <div className={styles.preview} style={{ fontFamily: effective }}>
              {t('font.previewText')}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.btnCancel} onClick={onClose}>{t('common.cancel')}</button>
          <button className={styles.btnApply} onClick={() => onApply(effective)}>{t('font.apply')}</button>
        </div>
      </div>
    </div>
  );
};
