import pino from "pino";

import { loadConfig } from "./config.js";

const cfg = loadConfig();

export const logger = pino(
  {
    level: cfg.logLevel,
    base: { name: "kanka-mcp" },
    // Defense in depth: even if a log site accidentally tries to log a token,
    // pino redaction censors it before it ever hits stderr.
    redact: {
      paths: [
        "token",
        "tokens",
        "access_token",
        "accessToken",
        "refresh_token",
        "refreshToken",
        "client_secret",
        "clientSecret",
        "KANKA_TOKEN",
        "KANKA_OAUTH_CLIENT_SECRET",
        "headers.authorization",
        "headers.Authorization",
        "*.token",
        "*.access_token",
        "*.refresh_token",
        "*.client_secret",
        "*.headers.authorization",
        "*.headers.Authorization",
      ],
      censor: "[REDACTED]",
    },
  },
  pino.destination(2),
);
