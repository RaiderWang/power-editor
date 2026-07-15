import type { TFunction } from '../i18n';

export interface SpecialCharDef {
  expr: string;
  labelKey: string;
  char: string;
}

export const SPECIAL_CHAR_DEFS: SpecialCharDef[] = [
  { expr: '^p', labelKey: 'special.newline', char: '\n' },
  { expr: '^t', labelKey: 'special.tab', char: '\t' },
  { expr: '^s', labelKey: 'special.space', char: ' ' },
  { expr: '^^', labelKey: 'special.caret', char: '^' },
];

export function getSpecialCharLabel(def: SpecialCharDef, t: TFunction): string {
  return t(def.labelKey);
}

/**
 * 将特殊字符表达式（^p、^t、^s、^^）展开为实际字符。
 * 仅在非正则模式下调用；正则模式中用户直接使用 \n、\t。
 *
 * 展开顺序：先将 ^^ 替换为临时占位符，最后再还原为 ^，
 * 避免展开其他表达式时二次处理已转义的 ^。
 */
export function expandSpecialChars(str: string): string {
  return str
    .replace(/\^\^/g, '\x00')
    .replace(/\^p/gi, '\n')
    .replace(/\^t/gi, '\t')
    .replace(/\^s/g, ' ')
    .replace(/\x00/g, '^');
}
