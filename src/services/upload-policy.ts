import { constants, readFileSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import { KankaError } from "../client/errors.js";

// Local file reads for kanka_entity_image. The path comes from the model, so it is
// untrusted: only regular image files whose realpath sits under an operator-configured
// root are read. The roots file is the scope boundary and must not be writable by an
// agent. Nothing here logs or echoes file contents.

export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** KANKA_UPLOAD_MAX_BYTES is clamped to this. */
export const MAX_UPLOAD_BYTES_CEILING = 50 * 1024 * 1024;
export const DEFAULT_UPLOAD_ROOTS_FILE = join(homedir(), ".config", "kanka-mcp", "upload-roots");
const ROOTS_FILE_DISPLAY = "~/.config/kanka-mcp/upload-roots";

/**
 * O_NOFOLLOW refuses a final-component symlink swapped in after realpath. O_NONBLOCK
 * keeps a FIFO swapped in after the stat check from pinning a libuv thread.
 */
export const UPLOAD_OPEN_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export interface UploadSettings {
  /** Absolute directory paths as configured; symlinks are resolved at check time. */
  roots: string[];
  maxBytes: number;
  source: "env" | "file" | "none";
  /** Home directory for the root and protected-path rules. Defaults to os.homedir(). */
  homeDir?: string;
}

export interface UploadFile {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  size: number;
}

/** Test seam for filesystem races. Not reachable from tool input. */
export interface UploadReadHooks {
  beforeOpen?: () => void | Promise<void>;
  afterOpen?: () => void | Promise<void>;
}

const EXTENSION_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw.trim())) return undefined;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function absoluteEntries(entries: string[]): string[] {
  return entries.map((e) => e.trim()).filter((e) => e.length > 0 && isAbsolute(e));
}

/**
 * Upload roots come from KANKA_UPLOAD_ROOTS (split on the platform path delimiter) or,
 * when that is unset or empty, from the roots file: one absolute path per line, blank
 * lines and `#` comments ignored. Relative entries are dropped. Called on every upload,
 * so edits to the roots file apply without a restart.
 */
export function loadUploadSettings(
  opts: { env?: Record<string, string | undefined>; rootsFile?: string } = {},
): UploadSettings {
  const env = opts.env ?? process.env;
  const maxBytes = Math.min(
    parsePositiveInt(env.KANKA_UPLOAD_MAX_BYTES) ?? DEFAULT_UPLOAD_MAX_BYTES,
    MAX_UPLOAD_BYTES_CEILING,
  );

  const fromEnv = env.KANKA_UPLOAD_ROOTS;
  if (fromEnv && fromEnv.trim().length > 0) {
    return { roots: absoluteEntries(fromEnv.split(delimiter)), maxBytes, source: "env" };
  }

  let text: string;
  try {
    text = readFileSync(opts.rootsFile ?? DEFAULT_UPLOAD_ROOTS_FILE, "utf8");
  } catch {
    return { roots: [], maxBytes, source: "none" };
  }
  const roots = absoluteEntries(text.split(/\r?\n/).filter((line) => !line.trim().startsWith("#")));
  return { roots, maxBytes, source: roots.length > 0 ? "file" : "none" };
}

/** Identify an allowed image type from its leading bytes. */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  const b = bytes;
  const ascii = (start: number, text: string): boolean =>
    b.length >= start + text.length && [...text].every((ch, i) => b[start + i] === ch.charCodeAt(0));

  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return undefined;
}

function refuse(message: string, details?: unknown): KankaError {
  return new KankaError("UPLOAD_REFUSED", message, details === undefined ? {} : { details });
}

function noRootsMessage(prefix: string): string {
  return (
    `${prefix} Image uploads read only from allowlisted directories. ` +
    `Set KANKA_UPLOAD_ROOTS to one or more absolute directories separated by "${delimiter}" ` +
    `(needs a server restart), or list one absolute directory per line in ${ROOTS_FILE_DISPLAY} ` +
    `(read on every call).`
  );
}

/** True when `target` is strictly inside `root`, compared by path segment. */
function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === "" || isAbsolute(rel)) return false;
  return rel.split(sep)[0] !== "..";
}

function isWithinOrEqual(root: string, target: string): boolean {
  return relative(root, target) === "" || isWithin(root, target);
}

async function realpathOrUndefined(p: string): Promise<string | undefined> {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}

interface ResolvedRoots {
  /** Accepted roots as configured, for messages. */
  configured: string[];
  /** Accepted roots, lexically resolved and realpath'd. */
  lexical: string[];
  real: string[];
  rejected: string[];
  /** ~/.config/kanka-mcp in every spelling we can find. */
  protectedDirs: string[];
}

async function resolveRoots(settings: UploadSettings): Promise<ResolvedRoots> {
  const home = resolve(settings.homeDir ?? homedir());
  const homeReal = (await realpathOrUndefined(home)) ?? home;
  const configDir = join(home, ".config", "kanka-mcp");
  const protectedDirs = [
    ...new Set([
      configDir,
      join(homeReal, ".config", "kanka-mcp"),
      (await realpathOrUndefined(configDir)) ?? configDir,
    ]),
  ];

  const tooBroad = (p: string): boolean =>
    parse(p).root === p ||
    p === home ||
    p === homeReal ||
    protectedDirs.some((dir) => isWithinOrEqual(p, dir));

  const out: ResolvedRoots = { configured: [], lexical: [], real: [], rejected: [], protectedDirs };
  for (const root of settings.roots) {
    const lexical = resolve(root);
    const real = await realpathOrUndefined(lexical);
    if (real === undefined) continue; // a missing root allows nothing
    if (tooBroad(lexical) || tooBroad(real)) {
      out.rejected.push(root);
      continue;
    }
    out.configured.push(root);
    out.lexical.push(lexical);
    out.real.push(real);
  }
  return out;
}

export async function readUploadFile(
  filePath: string,
  settings: UploadSettings,
  hooks: UploadReadHooks = {},
): Promise<UploadFile> {
  if (settings.roots.length === 0) {
    throw refuse(noRootsMessage("No upload roots are configured."));
  }
  if (!isAbsolute(filePath) || filePath.includes("\0")) {
    throw refuse("file_path must be an absolute path.");
  }

  const roots = await resolveRoots(settings);
  if (roots.real.length === 0) {
    if (roots.rejected.length > 0) {
      throw refuse(
        noRootsMessage(
          `Upload roots rejected as too broad: ${roots.rejected.join(", ")}. A root may not be /, the home directory, or ~/.config/kanka-mcp or any directory that contains it.`,
        ),
      );
    }
    throw refuse(noRootsMessage("None of the configured upload roots exist."));
  }

  // One message for outside-root, missing, unreadable and protected paths, so the
  // tool cannot be used to probe which files exist.
  const notAllowed = (): KankaError =>
    refuse(
      `file_path is not a readable file inside a configured upload root. Allowed roots: ${roots.configured.join(", ")}.`,
      { allowed_roots: roots.configured },
    );
  const allowedReal = (p: string): boolean =>
    roots.real.some((root) => isWithin(root, p)) &&
    !roots.protectedDirs.some((dir) => isWithinOrEqual(dir, p));

  // Lexical check first: paths outside every root never reach the filesystem.
  const lexical = resolve(filePath);
  if (![...roots.lexical, ...roots.real].some((root) => isWithin(root, lexical))) {
    throw notAllowed();
  }

  let real: string;
  try {
    real = await realpath(filePath);
  } catch {
    throw notAllowed();
  }
  // Symlinks are resolved, so a link inside a root that points elsewhere fails here.
  if (!allowedReal(real)) throw notAllowed();

  const expectedMime = EXTENSION_MIME[extname(real).toLowerCase()];
  if (!expectedMime) {
    throw refuse("Only .png, .jpg, .jpeg, .gif and .webp files can be uploaded.");
  }

  // Refuse FIFOs, devices and directories before open, which could block on a FIFO.
  let pre;
  try {
    pre = await stat(real);
  } catch {
    throw notAllowed();
  }
  if (!pre.isFile()) throw refuse("file_path is not a regular file.");

  await hooks.beforeOpen?.();

  let handle;
  try {
    handle = await open(real, UPLOAD_OPEN_FLAGS);
  } catch {
    throw refuse("file_path cannot be opened.");
  }
  try {
    await hooks.afterOpen?.();
    const fst = await handle.stat({ bigint: true });
    if (!fst.isFile()) throw refuse("file_path is not a regular file.");
    // A hard link inside a root can alias any file on the same volume.
    if (fst.nlink > 1n) throw refuse("file_path has more than one hard link.");

    // Re-resolve and confirm the path still names the file we opened, inside a root.
    let again: string;
    let current;
    try {
      again = await realpath(filePath);
      current = await stat(again, { bigint: true });
    } catch {
      throw refuse("file_path changed while it was being read.");
    }
    if (!allowedReal(again) || current.dev !== fst.dev || current.ino !== fst.ino) {
      throw refuse("file_path changed while it was being read.");
    }

    const size = Number(fst.size);
    const limit = Math.min(settings.maxBytes, MAX_UPLOAD_BYTES_CEILING);
    if (size === 0) throw refuse("file_path is empty.");
    if (size > limit) {
      throw refuse(`File is ${size} bytes, over the upload limit of ${limit} bytes (KANKA_UPLOAD_MAX_BYTES).`);
    }

    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const data = bytes.subarray(0, offset);

    const sniffed = sniffImageMime(data);
    if (!sniffed) {
      throw refuse("File content is not a PNG, JPEG, GIF or WebP image.");
    }
    if (sniffed !== expectedMime) {
      throw refuse(`File extension says ${expectedMime} but the content is ${sniffed}.`);
    }
    return { bytes: data, filename: basename(real), mimeType: sniffed, size: data.length };
  } finally {
    await handle.close();
  }
}
