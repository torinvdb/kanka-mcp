import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function readOAuthTokens(path: string): OAuthTokens | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as OAuthTokens;
    if (
      typeof parsed.accessToken === "string" &&
      typeof parsed.refreshToken === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeOAuthTokens(path: string, tokens: OAuthTokens): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(tokens, null, 2), { encoding: "utf8" });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort */
  }
}

export function deleteOAuthTokens(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}
