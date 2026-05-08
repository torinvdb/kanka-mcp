import { exec } from "node:child_process";
import { timingSafeEqual } from "node:crypto";

import type { TokenSource } from "../client/http.js";
import { logger } from "../logger.js";
import type { AuthStatus } from "../types.js";
import { startCallbackServer } from "./callback-server.js";
import { generatePkce, generateState } from "./pkce.js";
import {
  deleteOAuthTokens,
  readOAuthTokens,
  writeOAuthTokens,
  type OAuthTokens,
} from "./oauth-storage.js";

export interface OAuthProviderOptions {
  oauthBaseUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  storagePath: string;
  preferredRedirectPort: number | undefined;
}

interface TokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

export interface OAuthLoginResult {
  authenticated: true;
  expiresAt: string;
}

const REFRESH_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1000;

export class OAuthProvider implements TokenSource {
  private tokens: OAuthTokens | undefined;
  private refreshPromise: Promise<OAuthTokens> | undefined;

  constructor(private readonly options: OAuthProviderOptions) {
    this.tokens = readOAuthTokens(options.storagePath);
  }

  hasStoredTokens(): boolean {
    return this.tokens !== undefined;
  }

  async getToken(): Promise<string | undefined> {
    if (!this.tokens) return undefined;
    if (this.tokens.expiresAt - Date.now() < REFRESH_BEFORE_EXPIRY_MS) {
      try {
        await this.refresh();
      } catch (err) {
        logger.warn({ err }, "OAuth refresh failed; access token may be expired");
      }
    }
    return this.tokens?.accessToken;
  }

  async onUnauthorized(): Promise<boolean> {
    if (!this.tokens) return false;
    try {
      await this.refresh();
      return true;
    } catch (err) {
      logger.warn({ err }, "OAuth refresh after 401 failed");
      return false;
    }
  }

  async status(): Promise<AuthStatus> {
    if (!this.tokens) return { authenticated: false, source: "none" };
    return {
      authenticated: true,
      source: "oauth",
      expiresAt: new Date(this.tokens.expiresAt).toISOString(),
    };
  }

  logout(): void {
    this.tokens = undefined;
    deleteOAuthTokens(this.options.storagePath);
  }

  async login(overrides: {
    clientId?: string;
    clientSecret?: string;
  }): Promise<OAuthLoginResult> {
    const clientId = overrides.clientId ?? this.options.clientId;
    const clientSecret = overrides.clientSecret ?? this.options.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error(
        "OAuth client_id and client_secret required. Set KANKA_OAUTH_CLIENT_ID and KANKA_OAUTH_CLIENT_SECRET, or pass them as tool arguments. Register an OAuth app at https://app.kanka.io/settings/api?clients=1.",
      );
    }

    const callback = await startCallbackServer(this.options.preferredRedirectPort);
    try {
      const pkce = generatePkce();
      const state = generateState();
      const authorizeUrl = new URL(`${this.options.oauthBaseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("redirect_uri", callback.redirectUri);
      authorizeUrl.searchParams.set("scope", "");
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
      authorizeUrl.searchParams.set("code_challenge_method", pkce.method);

      const url = authorizeUrl.toString();
      logger.info({ url }, "OAuth authorize URL");
      tryOpenBrowser(url);

      const { code, state: returnedState } = await callback.waitForCallback();
      if (!constantTimeStringEqual(returnedState, state)) {
        throw new Error("OAuth state mismatch");
      }

      const tokens = await this.exchangeCode({
        clientId,
        clientSecret,
        code,
        redirectUri: callback.redirectUri,
        codeVerifier: pkce.verifier,
      });
      this.persist(tokens);
      return {
        authenticated: true,
        expiresAt: new Date(tokens.expiresAt).toISOString(),
      };
    } finally {
      callback.close();
    }
  }

  private async exchangeCode(args: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokens> {
    const response = await fetch(`${this.options.oauthBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: args.clientId,
        client_secret: args.clientSecret,
        redirect_uri: args.redirectUri,
        code: args.code,
        code_verifier: args.codeVerifier,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${body}`);
    }
    const json = (await response.json()) as TokenResponse;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
  }

  private async refresh(): Promise<OAuthTokens> {
    if (!this.tokens) throw new Error("No OAuth tokens to refresh");
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.options.clientId || !this.options.clientSecret) {
      throw new Error("OAuth client credentials missing for refresh");
    }
    const refreshToken = this.tokens.refreshToken;
    const clientId = this.options.clientId;
    const clientSecret = this.options.clientSecret;
    this.refreshPromise = (async () => {
      const response = await fetch(`${this.options.oauthBaseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          scope: "",
        }),
      });
      if (!response.ok) {
        this.tokens = undefined;
        deleteOAuthTokens(this.options.storagePath);
        throw new Error(`Refresh failed: ${response.status} ${await response.text()}`);
      }
      const json = (await response.json()) as TokenResponse;
      const next: OAuthTokens = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
      };
      this.persist(next);
      return next;
    })().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private persist(tokens: OAuthTokens): void {
    this.tokens = tokens;
    writeOAuthTokens(this.options.storagePath, tokens);
  }
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function tryOpenBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      logger.warn({ err: err.message }, "Could not auto-open browser; visit the URL manually");
    }
  });
}
