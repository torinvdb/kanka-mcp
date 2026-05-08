# kanka-mcp

A Model Context Protocol (MCP) server for [Kanka](https://kanka.io), the worldbuilding platform. Exposes a small set of tools that let any MCP-compatible agent (Claude Desktop, Claude Code, Cursor, custom clients) authenticate to a Kanka account and work with campaigns, entities, and search.

> **Status:** Phase 4 — feature-complete. 15 tools, full CRUD over all 18 entity types, posts and relations sub-resources, OAuth 2.0 (Authorization Code + PKCE) with transparent refresh, and a client-side full-text search. Backed by a vitest test suite (43 tests across 7 files, including msw-mocked HTTP integration tests).

## Quickstart (recommended)

One command takes you from a fresh clone to a verified setup:

```bash
cd kanka-mcp
npm run quickstart
```

The script will:

1. Verify Node ≥ 20
2. `npm install` and build TypeScript
3. Ask whether you want to authenticate via **Personal API token** or **OAuth 2.0**
4. Prompt for the relevant credentials (input is hidden) and persist them with `0600` perms — token to `~/.config/kanka-mcp/token` or OAuth client/secret to `.env` in the repo root
5. Run the end-to-end smoke test (and the OAuth browser flow if you chose option 2)
6. Print a ready-to-paste MCP-client config snippet for Claude Desktop / Claude Code

Re-running `npm run quickstart` is safe — it'll detect existing credentials and offer to reuse them. Skip the rest of this README unless you want manual control.

---

## Prerequisites

- Node.js 20 or newer
- A Kanka account
- A Kanka **Personal API token** (free tier allows 30 req/min; subscribers 90)

### Get a Kanka API token

1. Sign in at <https://app.kanka.io>
2. Go to **Settings → API**: <https://app.kanka.io/settings/api>
3. Click *Generate a new token* and copy the value
4. **Save it immediately** — Kanka only shows the token once. If you lose it, you'll need to regenerate.

Tokens are valid for 365 days.

### Set the `KANKA_TOKEN`

The server reads the token from the `KANKA_TOKEN` environment variable. Pick whichever method fits your workflow:

**1. Inline for a single command** — quickest way to run the smoke test once:

```bash
KANKA_TOKEN="paste-your-token-here" npm run smoke
```

**2. Export for the current shell session** — persists for as long as the terminal is open:

```bash
export KANKA_TOKEN="paste-your-token-here"
npm run smoke
npm run smoke -- --mutate
```

**3. Persistent across shells** — add it to your shell rc file (zsh shown; bash users use `~/.bashrc`):

```bash
echo 'export KANKA_TOKEN="paste-your-token-here"' >> ~/.zshrc
source ~/.zshrc
```

⚠️ Avoid this on shared machines — your token is sensitive.

**4. Token file (no shell env at all)** — drop the token into a `0600` file the server reads as a fallback:

```bash
mkdir -p ~/.config/kanka-mcp
printf '%s' 'paste-your-token-here' > ~/.config/kanka-mcp/token
chmod 600 ~/.config/kanka-mcp/token
```

The server checks `KANKA_TOKEN` first, then this file.

**5. MCP client config** — once you've verified the smoke test, supply the token directly to your client (Claude Desktop / Claude Code / etc.) so you never have to touch your shell. See [Connect to an MCP client](#connect-to-an-mcp-client).

#### Verify the token is set

```bash
echo "$KANKA_TOKEN" | head -c 8 ; echo "…"
```

Should print the first 8 characters of your token. If it prints `…` only, the variable isn't set in this shell.

## Install & build

From the repo root:

```bash
cd kanka-mcp
npm install
npm run build
```

This compiles TypeScript to `dist/`.

## Run a smoke test (recommended first step)

The smoke script spawns the built server, performs the MCP handshake, and exercises the read-only path against the real Kanka API. It's the fastest way to confirm your token works end-to-end before configuring an agent.

```bash
KANKA_TOKEN="your-token-here" npm run smoke
```

It will:
1. List the tools the server exposes
2. Call `kanka_auth_status`
3. Call `kanka_list_campaigns` and print the first 5
4. Call `kanka_get_campaign` for the first one (or pass a campaign id as the second arg)
5. Call `kanka_list_entities` for `character` and print the first 5

Pass an explicit campaign id if you don't want the script to auto-pick:

```bash
KANKA_TOKEN="..." npm run smoke -- 12345
```

### `--mutate` mode (validates Phase 2 CRUD)

Add `--mutate` to also exercise the create/update/get/delete cycle. The script creates a throwaway Note named `kanka-mcp smoke test <ISO timestamp>`, updates its `entry`, fetches it back **by `entity_id`** (which exercises the dual-ID resolver), and deletes it.

```bash
KANKA_TOKEN="..." npm run smoke -- --mutate
KANKA_TOKEN="..." npm run smoke -- 12345 --mutate
```

The Note appears in your campaign briefly. If the script crashes between create and delete, you may have to remove the Note manually.

Expected output (abridged):

```
→ initialize
  kanka-mcp v0.1.0
→ tools/list
  15 tools registered
→ kanka_auth_status
   { authenticated: true, source: 'env' }
→ kanka_list_campaigns
  2 campaign(s):
    - 12345: Legends of Tolria
    - ...
→ kanka_get_campaign(12345)
  name: Legends of Tolria
→ kanka_list_entities(12345, character)
  N character(s); first 5: ...
✓ smoke test passed
```

## Connect to an MCP client

Once the smoke test passes, point any MCP-compatible client at the server.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "kanka": {
      "command": "node",
      "args": ["/absolute/path/to/kanka-mcp/dist/index.js"],
      "env": {
        "KANKA_TOKEN": "your-token-here",
        "KANKA_TIER": "subscriber"
      }
    }
  }
}
```

Restart Claude Desktop. The Kanka tools should appear in the tool picker.

### Claude Code (CLI)

```bash
claude mcp add kanka \
  --env KANKA_TOKEN=your-token-here \
  --env KANKA_TIER=subscriber \
  -- node /absolute/path/to/kanka-mcp/dist/index.js
```

### Any other MCP client

The server speaks MCP over stdio. Any client that can launch a stdio MCP server will work — point it at `node /absolute/path/to/kanka-mcp/dist/index.js` with `KANKA_TOKEN` in the environment.

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `KANKA_TOKEN` | one of token *or* OAuth | — | Personal API token (Bearer) |
| `KANKA_TIER` | no | `free` | `free` or `subscriber`. Sets default rate limit (25 / 80 req/min) |
| `KANKA_RATE_LIMIT_PER_MIN` | no | derived from `KANKA_TIER` | Override the rate-limit token bucket capacity |
| `KANKA_BASE_URL` | no | `https://api.kanka.io/1.0` | Override the API base (for testing) |
| `KANKA_OAUTH_BASE_URL` | no | `https://app.kanka.io` | Override the OAuth host (for testing) |
| `KANKA_TOKEN_FILE` | no | `~/.config/kanka-mcp/token` | Fallback token location if `KANKA_TOKEN` is unset |
| `KANKA_OAUTH_CLIENT_ID` | OAuth | — | OAuth app client id (register at app.kanka.io/settings/api-apps) |
| `KANKA_OAUTH_CLIENT_SECRET` | OAuth | — | OAuth app client secret |
| `KANKA_OAUTH_REDIRECT_PORT` | no | random ephemeral | Pin the loopback callback port (useful if your OAuth app's redirect URI is fixed) |
| `KANKA_OAUTH_TOKEN_FILE` | no | `~/.config/kanka-mcp/oauth.json` | Where access + refresh tokens are persisted |
| `KANKA_REQUEST_TIMEOUT_MS` | no | `30000` | Per-request HTTP timeout; aborts the fetch and returns `NETWORK_ERROR` |
| `KANKA_MAX_RESPONSE_BYTES` | no | `10485760` (10 MiB) | Hard cap on response body size; oversized responses are rejected |
| `KANKA_LOG_LEVEL` | no | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

The server logs to **stderr** (stdout is reserved for MCP frames).

### Auth resolution order

When making an API call, the server picks a token in this order:

1. Stored OAuth tokens (`~/.config/kanka-mcp/oauth.json`) — refreshed transparently on 401 or within 24h of expiry
2. `KANKA_TOKEN` environment variable
3. `~/.config/kanka-mcp/token` file

Most users only need a Personal API token. Use OAuth when you want a long-running login that can refresh itself, or when you're delegating access to a Kanka account that's not yours.

### OAuth setup

1. Register an app at <https://app.kanka.io/settings/api?clients=1>. Set the redirect URI to `http://localhost:<port>/cb` (Kanka's URL validator **rejects `127.0.0.1`** — use `localhost`). Pin a port via `KANKA_OAUTH_REDIRECT_PORT` and use the same port here.
2. After saving, Kanka issues you a **Client ID** (a numeric or UUID identifier) and a **Client Secret**. ⚠️ *Do not confuse the Client ID with the app name you typed* — they're different. Set the issued values:
   ```bash
   export KANKA_OAUTH_CLIENT_ID="paste-issued-client-id"      # number/UUID, NOT the app name
   export KANKA_OAUTH_CLIENT_SECRET="paste-issued-secret"
   export KANKA_OAUTH_REDIRECT_PORT=53117
   ```
3. From your MCP client (or via `npm run smoke -- --oauth`), call `kanka_oauth_login`. The server opens your browser to Kanka's authorize page. After approval, tokens are persisted to `KANKA_OAUTH_TOKEN_FILE` (`0600` perms) and used automatically.
4. Call `kanka_auth_logout` to clear the stored tokens.

Tokens are stored as a JSON file with restrictive permissions; we deliberately avoid native keyring dependencies for portability.

## Tools

**Auth & discovery**

| Tool | Purpose |
|---|---|
| `kanka_auth_status` | Report whether a token is configured and where it was loaded from |
| `kanka_oauth_login` | Run the OAuth Authorization Code + PKCE flow; persists tokens locally |
| `kanka_auth_logout` | Clear stored OAuth tokens |
| `kanka_describe_entity_type` | Return the JSON Schema for an entity type's create/update payload |

**Campaigns**

| Tool | Purpose |
|---|---|
| `kanka_list_campaigns` | List campaigns the authenticated user has access to |
| `kanka_get_campaign` | Fetch metadata for one campaign by id |

**Search**

| Tool | Purpose |
|---|---|
| `kanka_search` | Native Kanka name search — fast, but matches names only |
| `kanka_full_text_search` | Client-side full-text search across `entry` HTML. Paginates typed list endpoints, strips HTML, and matches locally. Costs API budget — narrow `types` and `max_pages_per_type` to keep it cheap. Supports `regex: true` and `case_sensitive: true`. |

**Entities (CRUD)**

| Tool | Purpose |
|---|---|
| `kanka_list_entities` | Paginated list of entities, optionally filtered by type and arbitrary query filters |
| `kanka_get_entity` | Fetch a single entity by type-scoped `id` OR global `entity_id` (resolves the dual-ID system transparently) |
| `kanka_create_entity` | Create an entity. `data` is validated client-side against the per-type Zod schema before sending |
| `kanka_update_entity` | Partial PATCH on an existing entity |
| `kanka_delete_entity` | Permanently delete an entity. Requires `confirm: true` |

**Sub-resources** — both follow a unified `action: list | get | create | update | delete` shape. They hang off the **global `entity_id`**, never the type-scoped id.

| Tool | Purpose |
|---|---|
| `kanka_posts` | List/read/create/update/delete posts (sub-notes) attached to an entity |
| `kanka_relations` | List/read/create/update/delete typed links between entities (with attitude, two_way, etc.) |

### Workflow

Call `kanka_describe_entity_type` first whenever you're about to send a `data` payload — it returns the exact JSON Schema for that type, including which fields are required and any constraints. Some types have type-specific required fields beyond `name`:

- `calendar`: requires `weekday` (array of at least 2 strings)
- `conversation`: requires `target_id` (1 = users, 2 = characters)
- `dice_roll`: requires `parameters` (e.g. `"1d20+3"`)

### Incremental sync

`kanka_list_entities` accepts an optional `since` parameter (ISO 8601 timestamp) and returns a `sync` token in the response. To walk only what's changed:

```jsonc
// 1st call — full pull, save the returned token
{ "tool": "kanka_list_entities", "args": { "campaign_id": 113176, "entity_type": "character" } }
// → { "data": [...all 109 characters...], "sync": "2026-05-08T18:30:00.000Z" }

// 2nd call later — pass back the token to get only deltas
{ "tool": "kanka_list_entities", "args": {
    "campaign_id": 113176, "entity_type": "character",
    "since": "2026-05-08T18:30:00.000Z"
  }}
// → { "data": [...only entities updated since...], "sync": "2026-05-08T19:42:11.000Z" }
```

Backed by Kanka's native `?lastSync=` query parameter — efficient for long-running agent workflows that don't want to refetch entire entity lists on every turn.

### Supported entity types (18)

`character`, `location`, `family`, `organisation`, `object`, `note`, `event`, `calendar`, `creature`, `race`, `quest`, `map`, `journal`, `ability`, `tag`, `conversation`, `dice_roll`, `timeline`

## Architecture

```
MCP Client  <—stdio JSON-RPC—>  kanka-mcp (Node)
                                  ├─ Tool layer (15 tools)
                                  ├─ Service layer (id-resolver, full-text-search, html strip)
                                  ├─ Kanka HTTP client (token-bucket rate limiter, retry, error map)
                                  └─ Auth (composite: OAuth → env token → file token)
                                          │
                                          └─ HTTPS → api.kanka.io/1.0  +  app.kanka.io/oauth/*
```

The Kanka API exposes every entity through both a type-scoped `id` (used by `/characters/{id}`) and a global `entity_id` (used by `/entities/{id}` and as the parent of posts/relations). The server resolves between the two transparently — pass whichever one you have.

Rate limiting is conservative: a token bucket sized to the configured tier with exponential backoff on `429`. Adjust `KANKA_RATE_LIMIT_PER_MIN` if you have headroom.

## Roadmap

- **Phase 1** ✓ — read-only path (auth, campaigns, search, list/get entities, describe schema)
- **Phase 2** ✓ — full CRUD (`kanka_create_entity`/`update`/`delete`), all 18 entity schemas, posts & relations
- **Phase 3** ✓ — OAuth 2.0 Authorization Code flow with PKCE + transparent refresh, file-based token persistence (0600 perms), `kanka_full_text_search` with HTML stripping
- **Phase 4** ✓ — vitest + msw test harness (43 tests), `npm run check` pipeline, ESLint guard against stdout pollution, TtlCache wired for the campaigns list

### Future / out of scope for v1

- Bulk endpoints (Kanka has them for some types, but use cases are niche)
- Image upload via URL fetch (Kanka uses `multipart/form-data`; v1 accepts pre-uploaded image UUIDs only)
- Recorded fixtures from a real campaign for offline replay testing

## Development

```bash
npm run dev         # tsx watch mode
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (bans `console` to protect stdout / MCP framing)
npm run test        # vitest run — unit + msw HTTP integration tests
npm run test:watch  # vitest in watch mode
npm run check       # typecheck + lint + test (run this before committing)
npm run build       # compile to dist/
npm run smoke       # end-to-end smoke against the live Kanka API (requires KANKA_TOKEN)
npm run smoke -- --mutate   # additionally exercises the CRUD path
```

### Test layout

Tests live next to the code they cover (`*.test.ts`). The `tsconfig.json` excludes them from `dist/`, and `eslint.config.js` excludes them from the `no-console` rule so test files can log freely.

| File | Coverage |
|---|---|
| `src/client/rate-limiter.test.ts` | Token bucket, burst window, penalty, refill wait |
| `src/client/errors.test.ts` | Status-code → `KankaError` mapping, structured 422 details |
| `src/client/pagination.test.ts` | Cursor encode/decode, `paginateAll` generator |
| `src/client/http.test.ts` | msw-mocked HTTP: query encoding, 401 + refresh hook, 422 fields, 429 retry, 204 |
| `src/services/html.test.ts` | HTML strip + snippet extraction |
| `src/services/id-resolver.test.ts` | Cache hit/miss, `forget()`, unknown-type rejection |
| `src/schemas/index.test.ts` | Required-field enforcement per type, `describeEntityType` JSON Schema output |

## Continuous integration

Two GitHub Actions workflows live under [.github/workflows/](.github/workflows/):

### `ci.yml` — runs on every push/PR

Typecheck, lint, full vitest suite, and build. No secrets needed; safe to run on fork PRs. Fails the merge if any step regresses.

### `integration.yml` — live API smoke against your own campaign

Runs `npm run smoke` against the real Kanka API. Triggers:

- **Manual** (`workflow_dispatch`) from the Actions tab — optional `mutate` checkbox to additionally run the create/update/delete cycle, optional `campaign_id` to pin the test target
- **Weekly schedule** (Mondays 08:00 UTC) — catches upstream Kanka API regressions

Requires one secret on the repository:

| Setting | Where | Value |
|---|---|---|
| `KANKA_TOKEN` | Settings → Secrets and variables → Actions → **Secrets** | Your Personal API token |
| `KANKA_TIER` (optional) | Settings → Secrets and variables → Actions → **Variables** | `subscriber` if you have a Boosted/Premium account; defaults to `free` |

The workflow is gated to `workflow_dispatch` and `schedule` triggers only — it deliberately never runs on `pull_request` or `push`, so a fork PR can't ever trigger a run that would expose or consume your token. The `--mutate` job creates a throwaway Note named `kanka-mcp smoke test <ISO timestamp>` and deletes it; if a run crashes between create and delete, the leftover Note is named so you can find and remove it manually.

## Security

See [SECURITY.md](SECURITY.md) for the threat model and disclosure policy.

Hardening defaults baked into the server:

- **Request timeout** (`KANKA_REQUEST_TIMEOUT_MS`, default 30 s) — every HTTP call to Kanka is wrapped in an `AbortController`; hangs surface as `NETWORK_ERROR` rather than blocking the agent indefinitely.
- **Response size cap** (`KANKA_MAX_RESPONSE_BYTES`, default 10 MiB) — both the declared `Content-Length` and streamed bytes are checked; oversized responses are rejected before they OOM the process.
- **Rate limiter** — token bucket with burst guard and exponential backoff on 429.
- **Token files** — written with `0600` mode under `~/.config/kanka-mcp/` (created `0700`).
- **OAuth** — Authorization Code + PKCE (S256), 24-byte random `state` compared via `crypto.timingSafeEqual`, loopback callback bound to 127.0.0.1.
- **Log redaction** — pino is configured to censor `Authorization` headers and any field named `*token*`, `*secret*`, etc., before writing to stderr.
- **Stdout pollution guard** — ESLint bans `console.*` in `src/` so a future contributor can't accidentally corrupt MCP framing.
- **CI audit** — `npm audit --omit=dev --audit-level=high` runs on every push/PR; the workflow fails on high-severity advisories in production deps.

Run `npm audit` locally any time:

```bash
npm audit
```

## License

MIT
