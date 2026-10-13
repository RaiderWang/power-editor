export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size?: number;
  readonly: boolean;
}

export interface ContextMenuTarget {
  path: string;
  name: string;
  is_dir: boolean;
  x: number;
  y: number;
}

export interface InlineInputState {
  type: 'new-file' | 'new-folder' | 'rename';
  targetPath: string; // Parent folder path for new items, or existing item path for rename
  initialValue: string;
}
