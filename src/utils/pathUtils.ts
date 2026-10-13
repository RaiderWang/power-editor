/**
 * Case-insensitive path comparison, normalizing backslashes to forward slashes.
 * Suitable for Windows where drive letter case and separator style vary.
 */
export function pathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
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
