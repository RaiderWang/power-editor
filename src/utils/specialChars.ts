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
 * 单次从左到右扫描：^^ 优先匹配并还原为 ^，不会被后续字符二次展开。
 * ^p / ^t 不区分大小写，^s 区分大小写（与原行为一致）。
 */
export function expandSpecialChars(str: string): string {
  return str.replace(/\^(\^|[pPtT]|s)/g, (_m, c: string) => {
    switch (c) {
      case '^': return '^';
      case 'p':
      case 'P': return '\n';
      case 't':
      case 'T': return '\t';
      default: return ' ';
    }
  });
}
