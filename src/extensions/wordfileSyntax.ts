/**
 * Converts a UltraEdit LanguageDef into a CodeMirror 6 StreamLanguage.
 * This lets any .uew wordfile drive syntax highlighting in the editor.
 */
import { StreamLanguage } from '@codemirror/language';
import type { StringStream } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { LanguageDef } from '../types';

// Maps token() return values to @lezer/highlight Tag objects so that
// syntaxHighlighting(defaultHighlightStyle) and oneDark can apply colors.
const tokenTable = {
  comment: tags.comment,
  string: tags.string,
  keyword: tags.keyword,
  typeName: tags.typeName,
  operatorKeyword: tags.operatorKeyword,
  modifier: tags.modifier,
  function: tags.function(tags.variableName),
  constant: tags.constant(tags.name),
  namespace: tags.namespace,
  special: tags.special(tags.variableName),
  variable: tags.variableName,
  number: tags.number,
  punctuation: tags.punctuation,
};

interface WordfileState {
  inBlockComment: boolean;
  inString: boolean;
  stringChar: string;
}

function buildWordSet(groups: string[][], caseSensitive: boolean): Set<string>[] {
  return groups.map((kws) => {
    const s = new Set<string>();
    for (const kw of kws) {
      s.add(caseSensitive ? kw : kw.toLowerCase());
    }
    return s;
  });
}

export function buildWordfileLanguage(lang: LanguageDef) {
  const wordSets = buildWordSet(lang.keyword_groups, lang.case_sensitive);
  const delimSet = new Set(lang.delimiters.split(''));
  const stringChars = new Set(lang.string_chars);
  const lineComment = lang.line_comment;
  const blockStart = lang.block_comment_start;
  const blockEnd = lang.block_comment_end;

  return StreamLanguage.define<WordfileState>({
    name: lang.name.toLowerCase().replace(/\s+/g, '-'),
    tokenTable,

    startState(): WordfileState {
      return { inBlockComment: false, inString: false, stringChar: '' };
    },

    token(stream: StringStream, state: WordfileState): string | null {
      // ── Inside block comment ──────────────────────────────────
      if (state.inBlockComment) {
        if (blockEnd && stream.match(blockEnd)) {
          state.inBlockComment = false;
        } else {
          stream.next();
        }
        return 'comment';
      }

      // ── Inside string ─────────────────────────────────────────
      if (state.inString) {
        while (!stream.eol()) {
          const ch = stream.next()!;
          if (ch === '\\') {
            stream.next(); // escape
          } else if (ch === state.stringChar) {
            state.inString = false;
            break;
          }
        }
        return 'string';
      }

      // ── Skip whitespace ───────────────────────────────────────
      if (stream.eatSpace()) return null;

      // ── Line comment ──────────────────────────────────────────
      if (lineComment && stream.match(lineComment)) {
        stream.skipToEnd();
        return 'comment';
      }

      // ── Block comment start ───────────────────────────────────
      if (blockStart && stream.match(blockStart)) {
        state.inBlockComment = true;
        return 'comment';
      }

      // ── String start ──────────────────────────────────────────
      const peek = stream.peek();
      if (peek && stringChars.has(peek)) {
        state.inString = true;
        state.stringChar = peek;
        stream.next();
        return 'string';
      }

      // ── Delimiter / punctuation ───────────────────────────────
      if (peek && delimSet.has(peek)) {
        stream.next();
        return 'punctuation';
      }

      // ── Word / keyword ────────────────────────────────────────
      if (stream.match(/^[A-Za-z_$][\w$]*/)) {
        const word = stream.current();
        const key = lang.case_sensitive ? word : word.toLowerCase();
        for (let i = 0; i < wordSets.length; i++) {
          if (wordSets[i].has(key)) {
            // Map keyword group index to a tag name
            return tagName(i);
          }
        }
        return 'variable';
      }

      // ── Numbers ───────────────────────────────────────────────
      if (stream.match(/^0x[0-9a-fA-F]+/) || stream.match(/^\d+\.?\d*/)) {
        return 'number';
      }

      stream.next();
      return null;
    },
  });
}

function tagName(groupIndex: number): string {
  const names = ['keyword', 'typeName', 'operatorKeyword', 'modifier', 'function', 'constant', 'namespace', 'special'];
  return names[groupIndex % names.length];
}
