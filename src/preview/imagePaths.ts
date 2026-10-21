import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveImagePaths } from '../store/tauriCommands';

/** Decodes URL-escapes and strips a leading `./` from an image link. */
function cleanRawPath(src: string): string {
  let clean = src.trim();
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // ignore malformed uri
  }
  return clean.replace(/^\.[\\/]/, '');
}

function getBaseDir(filePath: string): string | null {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSep < 0) return null;
  return filePath.slice(0, lastSep).replace(/\\/g, '/');
}

function setAssetSrc(img: HTMLImageElement, absolutePath: string): void {
  try {
    img.src = convertFileSrc(absolutePath.replace(/\\/g, '/'));
  } catch (err) {
    console.warn('[preview] convertFileSrc failed for image:', absolutePath, err);
  }
}

/**
 * Rewrites local image sources to Tauri's asset protocol.
 *
 * - Absolute paths are used as-is.
 * - Relative paths are resolved by the Rust backend (`resolve_image_paths`), which tries the
 *   document folder, every parent folder (covers Obsidian vault-root-relative links such as
 *   `Readwise/Tweets/attachments/a.jpg`) and finally a vault-wide shortest-path lookup.
 * - Links that cannot be found fall back to `<document folder>/<link>` (shows a broken image).
 */
export async function postProcessImages(
  container: HTMLElement,
  currentFilePath: string | null,
): Promise<void> {
  const pending = new Map<string, HTMLImageElement[]>();

  container.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const rawSrc = img.getAttribute('src');
    if (!rawSrc || /^(https?:|data:|asset:|blob:)/i.test(rawSrc)) return;

    const clean = cleanRawPath(rawSrc);
    if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(clean)) {
      setAssetSrc(img, clean);
      return;
    }
    if (!currentFilePath) return;

    const group = pending.get(clean);
    if (group) group.push(img);
    else pending.set(clean, [img]);
  });

  if (!currentFilePath || pending.size === 0) return;

  const links = [...pending.keys()];
  let resolved: (string | null)[] = [];
  try {
    resolved = await resolveImagePaths(currentFilePath, links);
  } catch (err) {
    console.warn('[preview] resolve_image_paths failed:', err);
  }

  const baseDir = getBaseDir(currentFilePath);
  links.forEach((link, i) => {
    const target = resolved[i] ?? (baseDir ? `${baseDir}/${link}` : null);
    if (!target) return;
    pending.get(link)?.forEach((img) => setAssetSrc(img, target));
  });
}
