import type { TokenSource } from "../client/http.js";
import type { Config } from "../config.js";
import type { AuthStatus } from "../types.js";
import { OAuthProvider, type OAuthLoginResult } from "./oauth.js";
import { PersonalTokenProvider } from "./token.js";

export class CompositeAuthProvider implements TokenSource {
  constructor(
    private readonly token: PersonalTokenProvider,
    private readonly oauth: OAuthProvider,
  ) {}

  async getToken(): Promise<string | undefined> {
    if (this.oauth.hasStoredTokens()) {
      const t = await this.oauth.getToken();
      if (t) return t;
    }
    return this.token.getToken();
  }

  async onUnauthorized(): Promise<boolean> {
    if (this.oauth.hasStoredTokens()) {
      return this.oauth.onUnauthorized();
    }
    return false;
  }

  async status(): Promise<AuthStatus> {
    if (this.oauth.hasStoredTokens()) {
      return this.oauth.status();
    }
    return this.token.status();
  }

  async login(args: {
    clientId?: string;
    clientSecret?: string;
  }): Promise<OAuthLoginResult> {
    return this.oauth.login(args);
  }

  logout(): void {
    this.oauth.logout();
  }
}

export type AuthProvider = CompositeAuthProvider;

export function createAuthProvider(config: Config): AuthProvider {
  const token = new PersonalTokenProvider({
    envToken: config.token,
    tokenFilePath: config.tokenFilePath,
  });
  const oauth = new OAuthProvider({
    oauthBaseUrl: config.oauthBaseUrl,
    clientId: config.oauthClientId,
    clientSecret: config.oauthClientSecret,
    storagePath: config.oauthStoragePath,
    preferredRedirectPort: config.oauthRedirectPort,
  });
  return new CompositeAuthProvider(token, oauth);
}

export { OAuthProvider, PersonalTokenProvider };
