import type { PackInput } from "@lorelum/format";

export type PackEntryKind = "directory" | "file" | "missing" | "other" | "symlink";

export interface PackDirectoryEntry {
  kind: PackEntryKind;
  name: string;
}

export interface PackFileMetadata {
  /** Opaque identity stable for the lifetime of an entry; undefined only when missing. */
  identity: string | undefined;
  kind: PackEntryKind;
  size: number;
}

/** Injectable filesystem boundary for loading an explicitly selected pack. */
export interface PackFileSystem {
  lstat(path: string): Promise<PackFileMetadata>;
  readDirectory(path: string): Promise<readonly PackDirectoryEntry[]>;
  readRegularFile(path: string, maxBytes: number): Promise<string>;
}

export interface PackLoader {
  load(packPath: string): Promise<PackInput>;
}

export class PackLoadError extends Error {
  constructor(
    readonly code: "pack.parse_error" | "pack.path_invalid" | "pack.unreadable",
    message: string,
  ) {
    super(message);
    this.name = "PackLoadError";
  }
}
