import type { TokenSource } from "../client/http.js";
import type { AuthStatus } from "../types.js";
import { readTokenFile } from "./storage.js";

export interface PersonalTokenProviderOptions {
  envToken: string | undefined;
  tokenFilePath: string;
}

export class PersonalTokenProvider implements TokenSource {
  private readonly envToken: string | undefined;
  private readonly tokenFilePath: string;
  private cachedFileToken: string | undefined;
  private cachedSource: AuthStatus["source"] = "none";

  constructor(options: PersonalTokenProviderOptions) {
    this.envToken = options.envToken;
    this.tokenFilePath = options.tokenFilePath;
  }

  async getToken(): Promise<string | undefined> {
    if (this.envToken) {
      this.cachedSource = "env";
      return this.envToken;
    }
    if (this.cachedFileToken) {
      this.cachedSource = "file";
      return this.cachedFileToken;
    }
    const fileToken = readTokenFile(this.tokenFilePath);
    if (fileToken) {
      this.cachedFileToken = fileToken;
      this.cachedSource = "file";
      return fileToken;
    }
    this.cachedSource = "none";
    return undefined;
  }

  async status(): Promise<AuthStatus> {
    const token = await this.getToken();
    return { authenticated: Boolean(token), source: this.cachedSource };
  }
}
