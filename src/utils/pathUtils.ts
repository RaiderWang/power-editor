/**
 * Case-insensitive path comparison, normalizing backslashes to forward slashes.
 * Suitable for Windows where drive letter case and separator style vary.
 */
export function pathsEqual(a: string, b: string): boolean {
  const cleanA = a.replace(/^(\\\\[?]\\|\/\/\?\/)/, '').replace(/\\/g, '/').toLowerCase();
  const cleanB = b.replace(/^(\\\\[?]\\|\/\/\?\/)/, '').replace(/\\/g, '/').toLowerCase();
  return cleanA === cleanB;
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
  const normBase = base.replace(/\\/g, '/').replace(/\/+$/, '');
  const normTarget = target.replace(/\\/g, '/');
  if (normTarget.toLowerCase().startsWith(normBase.toLowerCase())) {
    const rel = normTarget.slice(normBase.length);
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
  const cleanTarget = targetPath.replace(/^(\\\\[?]\\|\/\/\?\/)/, '');
  const cleanFolder = folderPath.replace(/^(\\\\[?]\\|\/\/\?\/)/, '');
  const normTarget = cleanTarget.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const normFolder = cleanFolder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!normTarget || !normFolder) return false;
  return normTarget === normFolder || normTarget.startsWith(`${normFolder}/`);
}
