# Security policy

## Reporting a vulnerability

[**Open an issue**](https://github.com/torinvdb/kanka-mcp/issues/new) describing the problem.

For sensitive findings (auth bypass, token exfiltration, anything an attacker could exploit before a patch ships), prefer GitHub's private security advisory flow — go to the [**Security tab → Report a vulnerability**](https://github.com/torinvdb/kanka-mcp/security/advisories/new) — so the report stays confidential until a fix is out.

When reporting, please include:

- A clear description of the issue and the affected component (HTTP client, OAuth flow, schema validation, etc.)
- Reproduction steps or proof-of-concept
- The version (commit hash) you tested against
- Whether you've already disclosed this anywhere else

I aim to acknowledge reports within 72 hours and push a fix within 14 days for moderate/high-severity issues. Critical issues get an out-of-band fix as fast as I can manage.

## Threat model

This project is a **stdio MCP server** that an LLM agent invokes locally to talk to api.kanka.io. The realistic threats it must defend against are:

| # | Threat | Mitigation |
|---|---|---|
| T1 | An agent or rogue MCP client making destructive entity changes | `kanka_delete_entity` requires `confirm: true`; mutating tools take an explicit `campaign_id` (no implicit "active campaign") |
| T2 | A malicious agent crafting payloads that bypass schema validation | All entity inputs validated via per-type Zod schemas before hitting the network; 422s are surfaced verbatim |
| T3 | A compromised Kanka response (or MITM) sending huge bodies to OOM the server | HTTP client caps response body to `KANKA_MAX_RESPONSE_BYTES` (default 10 MiB); rejects `Content-Length` overruns upfront |
| T4 | A slow or unresponsive upstream hanging tool calls | All requests are timed out via `AbortController` (`KANKA_REQUEST_TIMEOUT_MS`, default 30 s) |
| T5 | A local attacker reading auth tokens from disk | Token files written with `0600` mode; `~/.config/kanka-mcp/` created with `0700` |
| T6 | OAuth callback CSRF / code injection | PKCE S256, random 24-byte `state`, constant-time comparison via `crypto.timingSafeEqual` |
| T7 | Logs leaking tokens or `Authorization` headers | Pino `redact` config scrubs known credential fields before writing to stderr |
| T8 | Stdout pollution corrupting MCP framing | `no-console` ESLint rule enforced in `src/`; all logging goes to stderr via pino |
| T9 | Supply chain (vulnerable transitive deps) | `npm audit` step in CI; renovate/dependabot recommended for downstream users |

The threats this project does **not** defend against:

- A user who deliberately leaks their own `KANKA_TOKEN` (e.g., committing `.env` to a public repo). The `.gitignore` and `0600` perms reduce accidents but cannot prevent intentional misuse.
- An attacker with code execution on the user's machine. They can read the same files our process can.
- A hostile MCP client that the user voluntarily installs. The agent ↔ server boundary trusts the agent.

## Hardened defaults

- `KANKA_REQUEST_TIMEOUT_MS=30000` — caps any single HTTP request
- `KANKA_MAX_RESPONSE_BYTES=10485760` — 10 MiB response cap
- `KANKA_RATE_LIMIT_PER_MIN=25` (free) / `80` (subscriber) — protects against runaway loops burning quota or triggering 429s
- All tokens stored at `0600` perms, parent directory `0700`
- OAuth callback server binds to `127.0.0.1` only, redirect advertised as `localhost` (Kanka rejects raw IPs)
- OAuth `state` is 24 random bytes (~144 bits of entropy), compared in constant time

## Secret handling

- `KANKA_TOKEN`: read from env or `~/.config/kanka-mcp/token`; never logged.
- OAuth client_secret: read from env or `.env`; redacted in logs by pino.
- OAuth access + refresh tokens: persisted to `~/.config/kanka-mcp/oauth.json`; never logged in cleartext.
- Smoke script (`scripts/smoke.mjs`) and quickstart (`scripts/quickstart.sh`) accept secrets via hidden input or env, never via positional args, and `unset` script-local values after use.

## Disclosure history

None to date.
