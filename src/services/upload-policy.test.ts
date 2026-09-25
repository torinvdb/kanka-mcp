import { execFileSync } from "node:child_process";
import {
  chmodSync,
  constants,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KankaError } from "../client/errors.js";
import {
  DEFAULT_UPLOAD_MAX_BYTES,
  MAX_UPLOAD_BYTES_CEILING,
  UPLOAD_OPEN_FLAGS,
  loadUploadSettings,
  readUploadFile,
  sniffImageMime,
  type UploadSettings,
} from "./upload-policy.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("IHDR-fake-png-body"),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jfif-body")]);
const GIF = Buffer.from("GIF89a-fake-gif-body");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x10, 0, 0, 0]),
  Buffer.from("WEBPVP8 body"),
]);

let base: string;
let root: string;
let home: string;
const posix = process.platform !== "win32";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "kanka-upload-policy-"));
  root = join(base, "root");
  mkdirSync(root);
  mkdirSync(join(base, "rootX"));
  mkdirSync(join(base, "outside"));
  writeFileSync(join(root, "art.png"), PNG);
  writeFileSync(join(root, "photo.jpeg"), JPEG);
  writeFileSync(join(root, "anim.gif"), GIF);
  writeFileSync(join(root, "still.webp"), WEBP);
  writeFileSync(join(root, "fake.png"), "not an image at all");
  writeFileSync(join(root, "mislabeled.jpg"), PNG);
  writeFileSync(join(root, "notes.txt"), PNG);
  writeFileSync(join(root, "empty.png"), Buffer.alloc(0));
  writeFileSync(join(root, "big.png"), Buffer.concat([PNG, Buffer.alloc(200)]));
  writeFileSync(join(base, "rootX", "art.png"), PNG);
  writeFileSync(join(base, "outside", "secret.png"), PNG);
  symlinkSync(join(base, "outside", "secret.png"), join(root, "escape.png"));
  symlinkSync(join(root, "art.png"), join(root, "alias.png"));
  symlinkSync(join(base, "outside"), join(root, "linked-dir"));
  mkdirSync(join(root, "dir.png"));
  // A fake home so the ~/.config/kanka-mcp rules never touch the real one.
  home = join(base, "home");
  mkdirSync(join(home, ".config", "kanka-mcp", "images"), { recursive: true });
  writeFileSync(join(home, ".config", "kanka-mcp", "images", "token-shaped.png"), PNG);
  writeFileSync(join(base, "outside", "hardlink-source.png"), PNG);
  linkSync(join(base, "outside", "hardlink-source.png"), join(root, "hardlink.png"));
  if (posix) execFileSync("mkfifo", [join(root, "pipe.png")]);
  mkdirSync(join(root, "locked"));
  writeFileSync(join(root, "locked", "inner.png"), PNG);
  chmodSync(join(root, "locked"), 0o000);
});

afterAll(() => {
  chmodSync(join(root, "locked"), 0o755);
  rmSync(base, { recursive: true, force: true });
});

function settings(overrides: Partial<UploadSettings> = {}): UploadSettings {
  return { roots: [root], maxBytes: DEFAULT_UPLOAD_MAX_BYTES, source: "env", homeDir: home, ...overrides };
}

async function refusal(p: Promise<unknown>): Promise<KankaError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(KankaError);
  expect((err as KankaError).code).toBe("UPLOAD_REFUSED");
  return err as KankaError;
}

describe("loadUploadSettings", () => {
  it("reads roots from KANKA_UPLOAD_ROOTS, split on the path delimiter", () => {
    const s = loadUploadSettings({
      env: { KANKA_UPLOAD_ROOTS: "/a/art:/b/more" },
      rootsFile: join(base, "does-not-exist"),
    });
    expect(s.roots).toEqual(["/a/art", "/b/more"]);
    expect(s.source).toBe("env");
    expect(s.maxBytes).toBe(DEFAULT_UPLOAD_MAX_BYTES);
  });

  it("prefers the env var over the roots file", () => {
    const file = join(base, "roots-both");
    writeFileSync(file, "/from/file\n");
    const s = loadUploadSettings({ env: { KANKA_UPLOAD_ROOTS: "/from/env" }, rootsFile: file });
    expect(s.roots).toEqual(["/from/env"]);
  });

  it("falls back to the roots file, skipping blanks, comments and relative lines", () => {
    const file = join(base, "roots-file");
    writeFileSync(file, "# Galactic Game art\n\n  /art/creatures  \nrelative/path\n# /commented/out\n/art/races\n");
    const s = loadUploadSettings({ env: {}, rootsFile: file });
    expect(s.roots).toEqual(["/art/creatures", "/art/races"]);
    expect(s.source).toBe("file");
  });

  it("treats an empty KANKA_UPLOAD_ROOTS as unset", () => {
    const file = join(base, "roots-empty-env");
    writeFileSync(file, "/art\n");
    const s = loadUploadSettings({ env: { KANKA_UPLOAD_ROOTS: "" }, rootsFile: file });
    expect(s.roots).toEqual(["/art"]);
  });

  it("returns no roots when neither the env var nor the file is present", () => {
    const s = loadUploadSettings({ env: {}, rootsFile: join(base, "missing") });
    expect(s.roots).toEqual([]);
    expect(s.source).toBe("none");
  });

  it("honours KANKA_UPLOAD_MAX_BYTES and ignores an invalid value", () => {
    const missing = join(base, "missing");
    expect(loadUploadSettings({ env: { KANKA_UPLOAD_MAX_BYTES: "2048" }, rootsFile: missing }).maxBytes).toBe(2048);
    expect(loadUploadSettings({ env: { KANKA_UPLOAD_MAX_BYTES: "abc" }, rootsFile: missing }).maxBytes).toBe(
      DEFAULT_UPLOAD_MAX_BYTES,
    );
    expect(loadUploadSettings({ env: { KANKA_UPLOAD_MAX_BYTES: "-5" }, rootsFile: missing }).maxBytes).toBe(
      DEFAULT_UPLOAD_MAX_BYTES,
    );
    expect(DEFAULT_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("clamps KANKA_UPLOAD_MAX_BYTES to 50 MiB", () => {
    const s = loadUploadSettings({ env: { KANKA_UPLOAD_MAX_BYTES: "999999999" }, rootsFile: join(base, "missing") });
    expect(MAX_UPLOAD_BYTES_CEILING).toBe(50 * 1024 * 1024);
    expect(s.maxBytes).toBe(MAX_UPLOAD_BYTES_CEILING);
  });
});

describe("sniffImageMime", () => {
  it("recognises png, jpeg, gif and webp signatures", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(GIF)).toBe("image/gif");
    expect(sniffImageMime(Buffer.from("GIF87a..."))).toBe("image/gif");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });

  it("rejects everything else", () => {
    expect(sniffImageMime(Buffer.from("<svg xmlns=...>"))).toBeUndefined();
    expect(sniffImageMime(Buffer.from("RIFF\0\0\0\0WAVE"))).toBeUndefined();
    expect(sniffImageMime(Buffer.alloc(0))).toBeUndefined();
  });
});

describe("readUploadFile", () => {
  it("accepts an image under an allowlisted root", async () => {
    const f = await readUploadFile(join(root, "art.png"), settings());
    expect(f.filename).toBe("art.png");
    expect(f.mimeType).toBe("image/png");
    expect(Buffer.from(f.bytes).equals(PNG)).toBe(true);
  });

  it("accepts jpeg, gif and webp by content", async () => {
    expect((await readUploadFile(join(root, "photo.jpeg"), settings())).mimeType).toBe("image/jpeg");
    expect((await readUploadFile(join(root, "anim.gif"), settings())).mimeType).toBe("image/gif");
    expect((await readUploadFile(join(root, "still.webp"), settings())).mimeType).toBe("image/webp");
  });

  it("accepts a symlink that stays inside the root", async () => {
    const f = await readUploadFile(join(root, "alias.png"), settings());
    expect(f.mimeType).toBe("image/png");
  });

  it("refuses when no roots are configured and says how to configure them", async () => {
    const err = await refusal(readUploadFile(join(root, "art.png"), settings({ roots: [], source: "none" })));
    expect(err.message).toContain("KANKA_UPLOAD_ROOTS");
    expect(err.message).toContain("~/.config/kanka-mcp/upload-roots");
  });

  it("refuses when every configured root is missing", async () => {
    const err = await refusal(readUploadFile(join(root, "art.png"), settings({ roots: [join(base, "nope")] })));
    expect(err.message).toContain("KANKA_UPLOAD_ROOTS");
  });

  it("refuses a file outside every root", async () => {
    await refusal(readUploadFile(join(base, "outside", "secret.png"), settings()));
  });

  it("refuses a .. traversal that leaves the root", async () => {
    await refusal(readUploadFile(join(root, "..", "outside", "secret.png"), settings()));
  });

  it("refuses a symlink inside the root that points outside it", async () => {
    const err = await refusal(readUploadFile(join(root, "escape.png"), settings()));
    expect(err.message).not.toContain("outside");
  });

  it("refuses a file reached through a symlinked directory that points outside the root", async () => {
    await refusal(readUploadFile(join(root, "linked-dir", "secret.png"), settings()));
  });

  it("refuses a prefix sibling (/x/rootX is not under /x/root)", async () => {
    await refusal(readUploadFile(join(base, "rootX", "art.png"), settings()));
  });

  it("refuses a relative path", async () => {
    await refusal(readUploadFile("root/art.png", settings()));
  });

  it("gives a missing outside path and an existing outside path the same refusal", async () => {
    const missing = await refusal(readUploadFile(join(base, "outside", "no-such.png"), settings()));
    const present = await refusal(readUploadFile(join(base, "outside", "secret.png"), settings()));
    expect(missing.message).toBe(present.message);
    expect(missing.details).toEqual(present.details);
  });

  it("gives a missing file inside a root the same refusal as an outside path", async () => {
    const missing = await refusal(readUploadFile(join(root, "missing.png"), settings()));
    const outside = await refusal(readUploadFile(join(base, "outside", "secret.png"), settings()));
    expect(missing.message).toBe(outside.message);
  });

  it.skipIf(!posix || isRoot)("gives an unreadable directory (EACCES) the same refusal as an outside path", async () => {
    const denied = await refusal(readUploadFile(join(root, "locked", "inner.png"), settings()));
    const outside = await refusal(readUploadFile(join(base, "outside", "secret.png"), settings()));
    expect(denied.message).toBe(outside.message);
  });

  it.skipIf(!posix)("refuses a FIFO without blocking on open", async () => {
    const err = await refusal(readUploadFile(join(root, "pipe.png"), settings()));
    expect(err.message).toMatch(/regular file/);
  });

  it("refuses a hard link (nlink > 1), which could alias a file outside the root", async () => {
    const err = await refusal(readUploadFile(join(root, "hardlink.png"), settings()));
    expect(err.message).toMatch(/hard link/i);
  });

  it("opens with O_NOFOLLOW and O_NONBLOCK", () => {
    expect(UPLOAD_OPEN_FLAGS & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect(UPLOAD_OPEN_FLAGS & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
  });

  it("the open flags refuse a symlink as the final component", async () => {
    await expect(open(join(root, "alias.png"), UPLOAD_OPEN_FLAGS)).rejects.toMatchObject({ code: "ELOOP" });
  });

  it("refuses when the file is swapped for an outside symlink between resolve and open", async () => {
    const target = join(root, "swap-before.png");
    writeFileSync(target, PNG);
    const err = await refusal(
      readUploadFile(target, settings(), {
        beforeOpen: () => {
          unlinkSync(target);
          symlinkSync(join(base, "outside", "secret.png"), target);
        },
      }),
    );
    expect(err.message).toMatch(/cannot be opened/);
  });

  it("refuses when the path is swapped to a different file after open", async () => {
    const target = join(root, "swap-after.png");
    const other = join(root, "swap-other.png");
    writeFileSync(target, PNG);
    writeFileSync(other, PNG);
    const err = await refusal(
      readUploadFile(target, settings(), {
        afterOpen: () => renameSync(other, target),
      }),
    );
    expect(err.message).toMatch(/changed/);
  });

  it("refuses a directory", async () => {
    await refusal(readUploadFile(join(root, "dir.png"), settings()));
  });

  it("refuses bad magic bytes behind an image extension, without echoing the content", async () => {
    const err = await refusal(readUploadFile(join(root, "fake.png"), settings()));
    expect(err.message).not.toContain("not an image at all");
    expect(JSON.stringify(err.details ?? null)).not.toContain("not an image at all");
  });

  it("refuses a disallowed extension even when the bytes are an image", async () => {
    await refusal(readUploadFile(join(root, "notes.txt"), settings()));
  });

  it("refuses an extension that disagrees with the content", async () => {
    await refusal(readUploadFile(join(root, "mislabeled.jpg"), settings()));
  });

  it("refuses an empty file", async () => {
    await refusal(readUploadFile(join(root, "empty.png"), settings()));
  });

  it("refuses a file over the size cap", async () => {
    const err = await refusal(readUploadFile(join(root, "big.png"), settings({ maxBytes: 64 })));
    expect(err.message).toContain("64");
  });

  describe("root and protected-path rules", () => {
    it.each([
      ["/", () => "/"],
      ["the home directory", () => home],
      ["an ancestor of ~/.config/kanka-mcp", () => join(home, ".config")],
      ["~/.config/kanka-mcp itself", () => join(home, ".config", "kanka-mcp")],
    ])("rejects %s as an upload root", async (_label, r) => {
      const err = await refusal(readUploadFile(join(root, "art.png"), settings({ roots: [r()] })));
      expect(err.message).toMatch(/too broad|rejected/i);
    });

    it("still uses the acceptable roots when one root is rejected", async () => {
      const f = await readUploadFile(join(root, "art.png"), settings({ roots: ["/", root] }));
      expect(f.mimeType).toBe("image/png");
    });

    it("hard-denies files under ~/.config/kanka-mcp even through a root inside it", async () => {
      const images = join(home, ".config", "kanka-mcp", "images");
      await refusal(readUploadFile(join(images, "token-shaped.png"), settings({ roots: [images] })));
    });
  });
});
