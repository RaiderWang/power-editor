/**
 * Case-insensitive path comparison, normalizing backslashes to forward slashes.
 * Suitable for Windows where drive letter case and separator style vary.
 */
export function pathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}
