/**
 * Normalize path for safe cross-platform comparison:
 * - Strips Windows extended-length and UNC extended prefixes (\\?\UNC\ -> //, \\?\ -> '')
 * - Unifies backslashes to forward slashes
 * - Trims trailing slashes while preserving root '/'
 * - Converts to lower case
 */
export function normalizePath(p: string): string {
  if (!p) return '';
  const noUnc = p.replace(/^(\\\\[?]\\UNC\\|\/\/\?\/UNC\/)/i, '//');
  const noPrefix = noUnc.replace(/^(\\\\[?]\\|\/\/\?\/)/, '');
  const unified = noPrefix.replace(/\\/g, '/');
  const trimmed = unified.length > 1 ? unified.replace(/\/+$/, '') : unified;
  return trimmed.toLowerCase();
}

/**
 * Case-insensitive path comparison, normalizing separators and Windows prefixes.
 * Suitable for Windows where drive letter case and separator style vary.
 */
export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/**
 * Join parent and child paths using the parent's separator convention.
 */
export function joinPath(parent: string, child: string): string {
  const isBackslash = parent.includes('\\') || (!parent.includes('/') && navigator.userAgent.includes('Windows'));
  const sep = isBackslash ? '\\' : '/';
  const trimmedParent = parent.endsWith('\\') || parent.endsWith('/') ? parent.slice(0, -1) : parent;
  const trimmedChild = child.startsWith('\\') || child.startsWith('/') ? child.slice(1) : child;
  return `${trimmedParent}${sep}${trimmedChild}`;
}

/**
 * Get base name of a path (file or folder name).
 */
export function getBaseName(path: string): string {
  const norm = path.replace(/[\\/]+$/, '');
  const parts = norm.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Get parent directory of a path.
 */
export function getParentDir(path: string): string {
  const norm = path.replace(/[\\/]+$/, '');
  const lastIdx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  if (lastIdx <= 0) return norm;
  return norm.slice(0, lastIdx);
}

/**
 * Get relative path from base to target.
 */
export function getRelativePath(base: string, target: string): string {
  const cleanBase = base.replace(/^(\\\\[?]\\UNC\\|\/\/\?\/UNC\/)/i, '//').replace(/^(\\\\[?]\\|\/\/\?\/)/, '').replace(/\\/g, '/').replace(/\/+$/, '');
  const cleanTarget = target.replace(/^(\\\\[?]\\UNC\\|\/\/\?\/UNC\/)/i, '//').replace(/^(\\\\[?]\\|\/\/\?\/)/, '').replace(/\\/g, '/');
  if (cleanTarget.toLowerCase().startsWith(cleanBase.toLowerCase())) {
    const rel = cleanTarget.slice(cleanBase.length);
    return rel.startsWith('/') ? rel.slice(1) : rel;
  }
  return target;
}

/**
 * Check whether `targetPath` is inside `folderPath` (or equals `folderPath`).
 * Uses path-segment boundary matching so `C:/foo` never matches `C:/foobar/a.txt`.
 */
export function isPathInsideFolder(targetPath: string, folderPath: string): boolean {
  if (!targetPath || !folderPath) return false;
  const normTarget = normalizePath(targetPath);
  const normFolder = normalizePath(folderPath);
  if (!normTarget || !normFolder) return false;
  if (normFolder === '/') return true;
  return normTarget === normFolder || normTarget.startsWith(`${normFolder}/`);
}
