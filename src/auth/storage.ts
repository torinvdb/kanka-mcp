import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export function readTokenFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf8").trim();
  return raw.length > 0 ? raw : undefined;
}

export function writeTokenFile(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, token, { encoding: "utf8" });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on platforms that don't support it */
  }
}
