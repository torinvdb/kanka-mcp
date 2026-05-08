#!/usr/bin/env node
// Smoke-test the built MCP server end-to-end against the real Kanka API.
// Spawns dist/index.js, performs the MCP handshake, and exercises the
// read-only tools so you can confirm auth + HTTP + parsing all work.
//
// Usage:
//   KANKA_TOKEN=... node scripts/smoke.mjs [campaign_id] [--mutate]
//   node scripts/smoke.mjs --oauth [campaign_id]   (uses OAuth instead of personal token)
//
// If campaign_id is omitted, uses the first campaign returned by
// kanka_list_campaigns. With --mutate, additionally creates, updates,
// reads (by entity_id, exercising the dual-ID resolver), and deletes
// a throwaway Note in that campaign to validate the CRUD path.
//
// With --oauth: requires KANKA_OAUTH_CLIENT_ID and KANKA_OAUTH_CLIENT_SECRET
// (KANKA_OAUTH_REDIRECT_PORT recommended, see README). Triggers the browser
// flow on first run; subsequent runs reuse the persisted tokens.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Transparently load .env from the repo root if present (Node 20.12+).
try {
  process.loadEnvFile?.();
} catch {
  /* .env missing or unreadable — ignore */
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, "..", "dist", "index.js");
const args = process.argv.slice(2);
const mutate = args.includes("--mutate");
const oauthMode = args.includes("--oauth");
const argCampaignId = args.find((a) => !a.startsWith("--") && /^\d+$/.test(a));
const targetCampaignId = argCampaignId ? Number(argCampaignId) : undefined;

if (oauthMode) {
  if (!process.env.KANKA_OAUTH_CLIENT_ID || !process.env.KANKA_OAUTH_CLIENT_SECRET) {
    console.error(
      "KANKA_OAUTH_CLIENT_ID and KANKA_OAUTH_CLIENT_SECRET are required with --oauth.",
    );
    console.error("Register an app at https://app.kanka.io/settings/api?clients=1");
    process.exit(2);
  }
} else if (!process.env.KANKA_TOKEN) {
  console.error("KANKA_TOKEN env var is required (or pass --oauth).");
  console.error("Get a personal token at https://app.kanka.io/settings/api");
  process.exit(2);
}

const child = spawn(process.execPath, [SERVER], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    // Bump to info during OAuth so the authorize URL is visible if the browser doesn't auto-open.
    KANKA_LOG_LEVEL: process.env.KANKA_LOG_LEVEL ?? (oauthMode ? "info" : "warn"),
  },
});

let buffer = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else ok(msg.result);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function unwrap(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  console.log("→ initialize");
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "kanka-mcp-smoke", version: "0.1.0" },
  });
  console.log(`  ${init.serverInfo.name} v${init.serverInfo.version}`);
  notify("notifications/initialized");

  console.log("→ tools/list");
  const tools = await send("tools/list", {});
  console.log(`  ${tools.tools.length} tools registered`);

  console.log("→ kanka_auth_status");
  let status = unwrap(await send("tools/call", { name: "kanka_auth_status", arguments: {} }));
  console.log("  ", status);

  if (oauthMode && (!status.authenticated || status.source !== "oauth")) {
    console.log("\n→ kanka_oauth_login (browser will open; complete the consent screen)");
    const login = unwrap(
      await send("tools/call", { name: "kanka_oauth_login", arguments: {} }),
    );
    if (login.error) {
      console.error("OAuth login failed:", JSON.stringify(login.error, null, 2));
      process.exit(1);
    }
    console.log(`  authenticated; expires ${login.expiresAt}`);

    status = unwrap(await send("tools/call", { name: "kanka_auth_status", arguments: {} }));
    console.log("  re-checked:", status);
  }

  if (!status.authenticated) {
    console.error("Auth failed.");
    process.exit(1);
  }

  console.log("→ kanka_list_campaigns");
  const campaigns = unwrap(
    await send("tools/call", { name: "kanka_list_campaigns", arguments: {} }),
  );
  if (campaigns.error) {
    console.error("Error:", campaigns.error);
    process.exit(1);
  }
  console.log(`  ${campaigns.campaigns.length} campaign(s):`);
  for (const c of campaigns.campaigns.slice(0, 5)) {
    console.log(`    - ${c.id}: ${c.name}`);
  }

  const campaignId = targetCampaignId ?? campaigns.campaigns[0]?.id;
  if (!campaignId) {
    console.error("No campaign available to test entity tools against.");
    process.exit(1);
  }

  console.log(`→ kanka_get_campaign(${campaignId})`);
  const campaign = unwrap(
    await send("tools/call", {
      name: "kanka_get_campaign",
      arguments: { campaign_id: campaignId },
    }),
  );
  if (campaign.error) {
    console.error("Error:", campaign.error);
  } else {
    console.log(`  name: ${campaign.name}`);
    console.log(`  locale: ${campaign.locale ?? "—"}`);
    console.log(`  visibility: ${campaign.visibility ?? campaign.visibility_id ?? "—"}`);
  }

  console.log(`→ kanka_list_entities(${campaignId}, character)`);
  const entities = unwrap(
    await send("tools/call", {
      name: "kanka_list_entities",
      arguments: { campaign_id: campaignId, entity_type: "character", per_page: 5 },
    }),
  );
  if (entities.error) {
    console.error("Error:", entities.error);
  } else {
    const total = entities.meta?.total ?? entities.data.length;
    console.log(`  ${total} character(s); first ${Math.min(5, entities.data.length)}:`);
    for (const e of entities.data.slice(0, 5)) {
      console.log(`    - ${e.id} (entity_id ${e.entity_id}): ${e.name}`);
    }
  }

  if (mutate) {
    console.log(`\n--mutate enabled: exercising CRUD on campaign ${campaignId}`);
    const stamp = new Date().toISOString();
    const noteName = `kanka-mcp smoke test ${stamp}`;

    console.log(`→ kanka_create_entity(note "${noteName}")`);
    const created = unwrap(
      await send("tools/call", {
        name: "kanka_create_entity",
        arguments: {
          campaign_id: campaignId,
          entity_type: "note",
          data: { name: noteName, entry: "<p>Created by the kanka-mcp smoke test.</p>" },
        },
      }),
    );
    if (created.error) {
      throw new Error(`create failed: ${JSON.stringify(created.error)}`);
    }
    const noteId = created.data.id;
    const noteEntityId = created.data.entity_id;
    console.log(`  created id=${noteId} entity_id=${noteEntityId}`);

    console.log(`→ kanka_update_entity(note ${noteId})`);
    const updated = unwrap(
      await send("tools/call", {
        name: "kanka_update_entity",
        arguments: {
          campaign_id: campaignId,
          entity_type: "note",
          id: noteId,
          data: { entry: "<p>Updated by the kanka-mcp smoke test.</p>" },
        },
      }),
    );
    if (updated.error) {
      throw new Error(`update failed: ${JSON.stringify(updated.error)}`);
    }
    console.log("  updated OK");

    console.log(`→ kanka_get_entity(by entity_id ${noteEntityId}) — exercises dual-ID resolver`);
    const fetched = unwrap(
      await send("tools/call", {
        name: "kanka_get_entity",
        arguments: { campaign_id: campaignId, entity_id: noteEntityId },
      }),
    );
    if (fetched.error) {
      throw new Error(`get failed: ${JSON.stringify(fetched.error)}`);
    }
    console.log(`  resolved type=${fetched.type} name=${fetched.data.name}`);

    console.log(`→ kanka_delete_entity(note ${noteId})`);
    const deleted = unwrap(
      await send("tools/call", {
        name: "kanka_delete_entity",
        arguments: {
          campaign_id: campaignId,
          entity_type: "note",
          id: noteId,
          confirm: true,
          entity_id: noteEntityId,
        },
      }),
    );
    if (deleted.error) {
      throw new Error(`delete failed: ${JSON.stringify(deleted.error)}`);
    }
    console.log("  deleted OK");
  }

  console.log("\n✓ smoke test passed");
  child.stdin.end();
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ smoke test failed:", err.message);
  child.kill();
  process.exit(1);
});
