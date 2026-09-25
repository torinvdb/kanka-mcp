import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { AuthProvider } from "../auth/index.js";
import { KankaClient, type CampaignSummary } from "../client/client.js";
import { HttpClient } from "../client/http.js";
import { RateLimiter } from "../client/rate-limiter.js";
import { TtlCache } from "../services/cache.js";
import { IdResolver } from "../services/id-resolver.js";
import { logger } from "../logger.js";
import type { ProfileService } from "../services/profile.js";
import type { KankaListResponse } from "../types.js";
import { registerAllTools } from "./register.js";

// Tool-level tests: real tool handlers, real KankaClient/HttpClient/RateLimiter,
// HTTP mocked with msw at the same seam as src/client/http.test.ts. No live API.

const BASE = "https://api.kanka.io/1.0";
const C = `${BASE}/campaigns/1`;

const msw = setupServer();
beforeAll(() => msw.listen({ onUnhandledRequest: "error" }));
afterEach(() => msw.resetHandlers());
afterAll(() => msw.close());

let client: Client;
let limiter: RateLimiter;

beforeEach(async () => {
  limiter = new RateLimiter({ perMinute: 60_000, burstMax: 100 });
  const httpClient = new HttpClient(BASE, { getToken: async () => "test-token" }, limiter);
  const kanka = new KankaClient(httpClient);
  const server = new McpServer({ name: "kanka-mcp-test", version: "0.0.0" });
  registerAllTools(server, {
    client: kanka,
    auth: {} as AuthProvider,
    idResolver: new IdResolver(kanka),
    campaignsCache: new TtlCache<string, KankaListResponse<CampaignSummary>>(60_000),
    profile: {} as ProfileService,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});

interface CallOutcome {
  isError: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  text: string;
}

async function call(name: string, args: Record<string, unknown>): Promise<CallOutcome> {
  try {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    const text = res.content[0]?.text ?? "";
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON error text from input validation */
    }
    return { isError: res.isError === true, body, text };
  } catch (err) {
    return { isError: true, body: undefined, text: String(err) };
  }
}

const FULL_RACE = {
  id: 12,
  entity_id: 3090387,
  name: "Elf",
  type: "Elven",
  entry: "<p>" + "long body ".repeat(200) + "</p>",
  entry_parsed: "<p>" + "long body ".repeat(200) + "</p>",
  is_private: false,
  parent_id: 44,
  tags: [1, 2],
  image_full: "https://example.invalid/elf.png",
  created_at: "2026-01-01T00:00:00.000000Z",
  updated_at: "2026-09-23T02:47:42.000000Z",
};

const ITEM = {
  id: 5,
  entity_id: 700,
  name: "Spear",
  type: "Weapon",
  entry: "<p>Pointy.</p>",
  entry_parsed: "<p>Pointy.</p>",
  is_private: true,
  item_id: 3,
  updated_at: "2026-09-20T00:00:00.000000Z",
};

describe("items: entity_type 'item' works everywhere, 'object' stays an alias", () => {
  it("get by entity_id when /entities reports entity_type 'item' and a custom `type`", async () => {
    msw.use(
      http.get(`${C}/entities/700`, () =>
        HttpResponse.json({
          data: { id: 700, name: "Spear", type: "Weapon", entity_type: "item", child_id: 5 },
        }),
      ),
      http.get(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })),
    );
    const r = await call("kanka_get_entity", { campaign_id: 1, entity_id: 700 });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.type).toBe("item");
    expect(r.body.data.name).toBe("Spear");
  });

  it("get by entity_id when /entities reports the module code in `type` ('item')", async () => {
    msw.use(
      http.get(`${C}/entities/700`, () =>
        HttpResponse.json({ data: { id: 700, name: "Spear", type: "item", child_id: 5 } }),
      ),
      http.get(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })),
    );
    const r = await call("kanka_get_entity", { campaign_id: 1, entity_id: 700 });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.type).toBe("item");
  });

  it("get by entity_id still resolves other types when `type` holds custom text", async () => {
    msw.use(
      http.get(`${C}/entities/3090387`, () =>
        HttpResponse.json({
          data: { id: 3090387, name: "Elf", type: "Elven", entity_type: "race", child_id: 12 },
        }),
      ),
      http.get(`${C}/races/12`, () => HttpResponse.json({ data: FULL_RACE })),
    );
    const r = await call("kanka_get_entity", { campaign_id: 1, entity_id: 3090387 });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.type).toBe("race");
  });

  it("get with entity_type 'item' and id", async () => {
    msw.use(http.get(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })));
    const r = await call("kanka_get_entity", { campaign_id: 1, entity_type: "item", id: 5 });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data.id).toBe(5);
  });

  it("update with entity_type 'item' PATCHes /items/{id}", async () => {
    let body: unknown;
    msw.use(
      http.patch(`${C}/items/5`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { ...ITEM, name: "Long Spear" } });
      }),
    );
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "item",
      id: 5,
      data: { name: "Long Spear", parent_id: 3 },
    });
    expect(r.isError, r.text).toBe(false);
    expect(body).toEqual({ name: "Long Spear", parent_id: 3 });
    expect(r.body.type).toBe("item");
  });

  it("update with entity_type 'object' (alias) still PATCHes /items/{id}", async () => {
    msw.use(http.patch(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })));
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "object",
      id: 5,
      data: { name: "Spear" },
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.type).toBe("item");
  });

  it("create and list accept 'item'", async () => {
    msw.use(
      http.post(`${C}/items`, () => HttpResponse.json({ data: ITEM })),
      http.get(`${C}/items`, () => HttpResponse.json({ data: [ITEM] })),
    );
    const created = await call("kanka_create_entity", {
      campaign_id: 1,
      entity_type: "item",
      data: { name: "Spear" },
    });
    expect(created.isError, created.text).toBe(false);
    const listed = await call("kanka_list_entities", { campaign_id: 1, entity_type: "item" });
    expect(listed.isError, listed.text).toBe(false);
    expect(listed.body.data).toHaveLength(1);
  });

  it("an item found by kanka_search can then be fetched by entity_id", async () => {
    msw.use(
      http.get(`${C}/search/Spear`, () =>
        HttpResponse.json({ data: [{ id: 5, entity_id: 700, name: "Spear", type: "item" }] }),
      ),
      http.get(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })),
    );
    const s = await call("kanka_search", { campaign_id: 1, query: "Spear", types: ["item"] });
    expect(s.isError, s.text).toBe(false);
    expect(s.body.results).toHaveLength(1);
    const r = await call("kanka_get_entity", { campaign_id: 1, entity_id: 700 });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data.name).toBe("Spear");
  });

  it("rows from the untyped /entities list prime the resolver with entity_type + child_id", async () => {
    let entityLookups = 0;
    msw.use(
      http.get(`${C}/entities`, () =>
        HttpResponse.json({
          data: [{ id: 700, name: "Spear", type: "Weapon", entity_type: "item", child_id: 5 }],
        }),
      ),
      http.get(`${C}/entities/700`, () => {
        entityLookups += 1;
        return HttpResponse.json({ data: {} });
      }),
      http.get(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })),
    );
    const listed = await call("kanka_list_entities", { campaign_id: 1, response: "slim" });
    expect(listed.isError, listed.text).toBe(false);
    expect(listed.body.data[0]).toMatchObject({ entity_type: "item", child_id: 5, parent_id: null });
    const r = await call("kanka_get_entity", { campaign_id: 1, entity_id: 700 });
    expect(r.isError, r.text).toBe(false);
    expect(entityLookups).toBe(0);
  });

  it("full-text search accepts the 'object' alias and walks /items", async () => {
    msw.use(http.get(`${C}/items`, () => HttpResponse.json({ data: [ITEM] })));
    const r = await call("kanka_full_text_search", {
      campaign_id: 1,
      query: "pointy",
      types: ["object"],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.matches[0]).toMatchObject({ type: "item", id: 5 });
  });

  it("describe_entity_type accepts 'item' and exposes parent_id", async () => {
    const r = await call("kanka_describe_entity_type", { entity_type: "item" });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.type).toBe("item");
    expect(Object.keys(r.body.updateSchema.properties)).toContain("parent_id");
  });
});

describe("slim responses", () => {
  const SLIM_KEYS = ["entity_id", "id", "is_private", "name", "parent_id", "type", "updated_at"];

  it("default (full) response is unchanged and still carries entry_parsed", async () => {
    msw.use(http.patch(`${C}/races/12`, () => HttpResponse.json({ data: FULL_RACE })));
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "race",
      id: 12,
      data: { entry: "<p>x</p>" },
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data.entry_parsed).toBeDefined();
    expect(r.body.data.image_full).toBeDefined();
  });

  it("update with response 'slim' returns only the summary keys", async () => {
    msw.use(http.patch(`${C}/races/12`, () => HttpResponse.json({ data: FULL_RACE })));
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "race",
      id: 12,
      data: { entry: "<p>x</p>" },
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(Object.keys(r.body.data).sort()).toEqual(SLIM_KEYS);
    expect(r.body.data.parent_id).toBe(44);
    expect(r.text).not.toContain("long body");
  });

  it("slim maps a legacy `<type>_id` parent field to parent_id", async () => {
    msw.use(http.get(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })));
    const r = await call("kanka_get_entity", {
      campaign_id: 1,
      entity_type: "item",
      id: 5,
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data.parent_id).toBe(3);
    expect(r.body.data.entry).toBeUndefined();
  });

  it("slim omits parent_id for types with no tree (character)", async () => {
    msw.use(
      http.get(`${C}/characters/9`, () =>
        HttpResponse.json({ data: { id: 9, entity_id: 90, name: "Sparky", entry: "<p>x</p>" } }),
      ),
    );
    const r = await call("kanka_get_entity", {
      campaign_id: 1,
      entity_type: "character",
      id: 9,
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data).not.toHaveProperty("parent_id");
    expect(r.body.data).not.toHaveProperty("entry");
  });

  it("get slim with fields ['entry'] adds the raw entry but never entry_parsed", async () => {
    msw.use(http.get(`${C}/races/12`, () => HttpResponse.json({ data: FULL_RACE })));
    const r = await call("kanka_get_entity", {
      campaign_id: 1,
      entity_type: "race",
      id: 12,
      response: "slim",
      fields: ["entry", "tags"],
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data.entry).toBe(FULL_RACE.entry);
    expect(r.body.data.tags).toEqual([1, 2]);
    expect(r.body.data).not.toHaveProperty("entry_parsed");
  });

  it("a requested field named __proto__ stays a plain key and cannot swap the prototype", async () => {
    msw.use(
      http.get(`${C}/races/12`, () =>
        new HttpResponse(
          JSON.stringify({ data: { ...FULL_RACE, __proto__: { polluted: true } } }).replace(
            '"entry_parsed"',
            '"__proto__":{"polluted":true},"entry_parsed"',
          ),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const r = await call("kanka_get_entity", {
      campaign_id: 1,
      entity_type: "race",
      id: 12,
      response: "slim",
      fields: ["__proto__"],
    });
    expect(r.isError, r.text).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.body.data.name).toBe("Elf");
    // Plain assignment would have set the prototype and JSON.stringify would drop the key.
    expect(Object.hasOwn(r.body.data, "__proto__")).toBe(true);
  });

  it("create with response 'slim'", async () => {
    msw.use(http.post(`${C}/races`, () => HttpResponse.json({ data: FULL_RACE })));
    const r = await call("kanka_create_entity", {
      campaign_id: 1,
      entity_type: "race",
      data: { name: "Elf" },
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(Object.keys(r.body.data).sort()).toEqual(SLIM_KEYS);
  });

  it("list with response 'slim' projects every row and keeps paging metadata", async () => {
    msw.use(
      http.get(`${C}/races`, () =>
        HttpResponse.json({
          data: [FULL_RACE, { ...FULL_RACE, id: 13, entity_id: 3090388, name: "Dwarf" }],
          meta: { current_page: 1, last_page: 1, total: 2 },
          sync: "2026-09-23T00:00:00Z",
        }),
      ),
    );
    const r = await call("kanka_list_entities", {
      campaign_id: 1,
      entity_type: "race",
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data).toHaveLength(2);
    for (const row of r.body.data) expect(Object.keys(row).sort()).toEqual(SLIM_KEYS);
    expect(r.body.meta.total).toBe(2);
    expect(r.body.sync).toBe("2026-09-23T00:00:00Z");
  });

  it("posts update with response 'slim' drops the post entry", async () => {
    msw.use(
      http.patch(`${C}/entities/3090387/posts/77`, () =>
        HttpResponse.json({
          data: {
            id: 77,
            entity_id: 3090387,
            name: "History",
            entry: "<p>long</p>",
            entry_parsed: "<p>long</p>",
            visibility_id: 1,
            is_pinned: false,
            position: 2,
            updated_at: "2026-09-23T00:00:00Z",
          },
        }),
      ),
    );
    const r = await call("kanka_posts", {
      campaign_id: 1,
      entity_id: 3090387,
      action: "update",
      id: 77,
      data: { entry: "<p>long</p>" },
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data).not.toHaveProperty("entry");
    expect(r.body.data).not.toHaveProperty("entry_parsed");
    expect(r.body.data.name).toBe("History");
    expect(r.body.data.visibility_id).toBe(1);
  });
});

describe("kanka_organisation_members", () => {
  const MEMBER = {
    id: 936548,
    organisation_id: 7,
    character_id: 11,
    role: "Founder",
    is_private: false,
    pin_id: null,
    status_id: 0,
  };

  it("lists members of an organisation by type-scoped organisation_id", async () => {
    msw.use(
      http.get(`${C}/organisations/7/organisation_members`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("page")).toBe("2");
        return HttpResponse.json({ data: [MEMBER], meta: { current_page: 2 } });
      }),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: 7,
      action: "list",
      page: 2,
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data[0].role).toBe("Founder");
  });

  it("resolves an organisation's global entity_id to its type-scoped id", async () => {
    msw.use(
      http.get(`${C}/entities/3045324`, () =>
        HttpResponse.json({
          data: { id: 3045324, name: "Goldfinger Co.", entity_type: "organisation", child_id: 8 },
        }),
      ),
      http.get(`${C}/organisations/8/organisation_members`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      entity_id: 3045324,
      action: "list",
    });
    expect(r.isError, r.text).toBe(false);
  });

  it("rejects an entity_id that is not an organisation", async () => {
    msw.use(
      http.get(`${C}/entities/90`, () =>
        HttpResponse.json({ data: { id: 90, entity_type: "character", child_id: 9 } }),
      ),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      entity_id: 90,
      action: "list",
    });
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("create fills organisation_id from the path and validates character_id", async () => {
    let body: Record<string, unknown> | undefined;
    msw.use(
      http.post(`${C}/organisations/8/organisation_members`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { ...MEMBER, id: 1, organisation_id: 8 } });
      }),
    );
    const bad = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: 8,
      action: "create",
      data: { role: "Founder" },
    });
    expect(bad.isError).toBe(true);
    expect(bad.body.error.details.fields).toHaveProperty("character_id");
    expect(body).toBeUndefined();

    const ok = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: 8,
      action: "create",
      data: { character_id: 11, role: "Founder", status_id: 0 },
    });
    expect(ok.isError, ok.text).toBe(false);
    expect(body).toEqual({ organisation_id: 8, character_id: 11, role: "Founder", status_id: 0 });
  });

  it("update PATCHes the member and can re-point organisation_id", async () => {
    let body: unknown;
    msw.use(
      http.patch(`${C}/organisations/7/organisation_members/936548`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { ...MEMBER, organisation_id: 8 } });
      }),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: 7,
      action: "update",
      id: 936548,
      data: { organisation_id: 8 },
    });
    expect(r.isError, r.text).toBe(false);
    expect(body).toEqual({ organisation_id: 8 });
  });

  it("delete requires confirm: true and sends nothing without it", async () => {
    let deletes = 0;
    msw.use(
      http.delete(`${C}/organisations/7/organisation_members/936548`, () => {
        deletes += 1;
        return HttpResponse.json({});
      }),
    );
    const refused = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: 7,
      action: "delete",
      id: 936548,
    });
    expect(refused.isError).toBe(true);
    expect(deletes).toBe(0);

    const ok = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: 7,
      action: "delete",
      id: 936548,
      confirm: true,
    });
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.body).toEqual({ deleted: true, id: 936548 });
    expect(deletes).toBe(1);
  });

  it("rejects non-integer ids so a path segment cannot be injected", async () => {
    let hits = 0;
    msw.use(
      http.all("*", () => {
        hits += 1;
        return HttpResponse.json({ data: [] });
      }),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: "7/../../../campaigns",
      action: "list",
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Input validation error/);
    expect(hits).toBe(0);
  });

  it("goes through the rate limiter and surfaces Kanka 422 errors", async () => {
    const acquire = vi.spyOn(limiter, "acquire");
    msw.use(
      http.post(`${C}/organisations/7/organisation_members`, () =>
        HttpResponse.json(
          { message: "invalid", errors: { character_id: ["not in campaign"] } },
          { status: 422 },
        ),
      ),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      organisation_id: 7,
      action: "create",
      data: { character_id: 999 },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(r.body.error.details.fields.character_id).toEqual(["not in campaign"]);
  });
});

describe("entity attributes and entity tags", () => {
  it("kanka_attributes creates an attribute on the global entity_id", async () => {
    let body: unknown;
    msw.use(
      http.post(`${C}/entities/700/attributes`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { id: 151, name: "Weight", value: "1 lb." } });
      }),
    );
    const r = await call("kanka_attributes", {
      campaign_id: 1,
      entity_id: 700,
      action: "create",
      data: { name: "Weight", value: "1 lb.", type_id: 1 },
    });
    expect(r.isError, r.text).toBe(false);
    expect(body).toEqual({ name: "Weight", value: "1 lb.", type_id: 1 });
  });

  it("kanka_attributes rejects an unknown type_id client-side", async () => {
    const r = await call("kanka_attributes", {
      campaign_id: 1,
      entity_id: 700,
      action: "create",
      data: { name: "Weight", type_id: 42 },
    });
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("kanka_entity_tags adds one tag without touching the rest", async () => {
    let body: unknown;
    msw.use(
      http.post(`${C}/entities/700/entity_tags`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { id: 3, tag_id: 12 } });
      }),
    );
    const r = await call("kanka_entity_tags", {
      campaign_id: 1,
      entity_id: 700,
      action: "create",
      data: { tag_id: 12 },
    });
    expect(r.isError, r.text).toBe(false);
    expect(body).toEqual({ tag_id: 12 });
  });

  it("kanka_relations create sends owner_id from the path entity, never from data", async () => {
    let body: Record<string, unknown> | undefined;
    msw.use(
      http.post(`${C}/entities/700/relations`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 5, owner_id: 700, target_id: 800 } });
      }),
    );
    const r = await call("kanka_relations", {
      campaign_id: 1,
      entity_id: 700,
      action: "create",
      data: { relation: "brother", target_id: 800, owner_id: 999 },
    });
    expect(r.isError, r.text).toBe(false);
    expect(body).toEqual({ relation: "brother", target_id: 800, owner_id: 700 });
  });

  it.each([
    ["kanka_posts", "posts"],
    ["kanka_relations", "relations"],
    ["kanka_attributes", "attributes"],
    ["kanka_entity_tags", "entity_tags"],
  ])("%s delete sends nothing without confirm: true", async (tool, sub) => {
    let deletes = 0;
    msw.use(
      http.delete(`${C}/entities/700/${sub}/3`, () => {
        deletes += 1;
        return HttpResponse.json({});
      }),
    );
    const refused = await call(tool, { campaign_id: 1, entity_id: 700, action: "delete", id: 3 });
    expect(refused.isError).toBe(true);
    expect(refused.body.error.code).toBe("VALIDATION_ERROR");
    expect(deletes).toBe(0);

    const ok = await call(tool, {
      campaign_id: 1,
      entity_id: 700,
      action: "delete",
      id: 3,
      confirm: true,
    });
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.body).toEqual({ deleted: true, id: 3 });
    expect(deletes).toBe(1);
  });
});

describe("untrusted ids from API responses never reach a request path", () => {
  it("a tampered /entities child_id is refused before any typed request", async () => {
    const paths: string[] = [];
    msw.use(
      http.get(`${C}/entities/3045324`, () =>
        HttpResponse.json({
          data: {
            id: 3045324,
            entity_type: "organisation",
            child_id: "5/../../../../campaigns/2/organisations/9",
          },
        }),
      ),
      http.all("*", ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: {} });
      }),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      entity_id: 3045324,
      action: "delete",
      id: 936548,
      confirm: true,
    });
    expect(r.isError).toBe(true);
    expect(paths).toEqual([]);
  });

  it("search rows with non-integer ids are not cached for later routing", async () => {
    const paths: string[] = [];
    msw.use(
      http.get(`${C}/search/Spear`, () =>
        HttpResponse.json({
          data: [{ id: "5/../../../campaigns/2/items/9", entity_id: 700, name: "Spear", type: "item" }],
        }),
      ),
      http.get(`${C}/entities/700`, () =>
        HttpResponse.json({ data: { id: 700, entity_type: "item", child_id: 5 } }),
      ),
      http.get(`${C}/items/5`, () => HttpResponse.json({ data: ITEM })),
      http.all("*", ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: {} });
      }),
    );
    await call("kanka_search", { campaign_id: 1, query: "Spear" });
    const r = await call("kanka_get_entity", { campaign_id: 1, entity_id: 700 });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.data.id).toBe(5);
    expect(paths).toEqual([]);
  });

  it("an unknown entity_type is not overridden by a free-text `type` that looks like a module", async () => {
    msw.use(
      http.get(`${C}/entities/55`, () =>
        HttpResponse.json({ data: { id: 55, entity_type: "bookmark", type: "organisation", child_id: 8 } }),
      ),
    );
    const r = await call("kanka_organisation_members", {
      campaign_id: 1,
      entity_id: 55,
      action: "list",
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/bookmark/);
  });
});

describe("tool call logging", () => {
  it("logs one line per call with ids and outcome, never the payload", async () => {
    const info = vi.spyOn(logger, "info");
    msw.use(http.patch(`${C}/races/12`, () => HttpResponse.json({ data: FULL_RACE })));
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "race",
      id: 12,
      data: { entry: "<p>SECRET-ENTRY-TEXT</p>", name: "SECRET-NAME" },
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    const lines = info.mock.calls.filter((c) => c[1] === "tool call").map((c) => c[0]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      tool: "kanka_update_entity",
      campaign_id: 1,
      entity_type: "race",
      id: 12,
      response: "slim",
      outcome: "ok",
    });
    expect(typeof (lines[0] as { duration_ms: unknown }).duration_ms).toBe("number");
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("SECRET-ENTRY-TEXT");
    expect(logged).not.toContain("SECRET-NAME");
    expect(logged).not.toContain("long body");
    info.mockRestore();
  });

  it("logs failures with the error code", async () => {
    const info = vi.spyOn(logger, "info");
    const r = await call("kanka_entity_tags", { campaign_id: 1, entity_id: 700, action: "delete", id: 3 });
    expect(r.isError).toBe(true);
    const line = info.mock.calls.find((c) => c[1] === "tool call")?.[0];
    expect(line).toMatchObject({
      tool: "kanka_entity_tags",
      action: "delete",
      outcome: "error",
      error_code: "VALIDATION_ERROR",
    });
    info.mockRestore();
  });
});

describe("update payloads Kanka needs that the schemas used to reject or drop", () => {
  function capturePatch(path: string): { body: () => unknown } {
    let body: unknown;
    msw.use(
      http.patch(`${C}/${path}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { id: 1, entity_id: 2, name: "x" } });
      }),
    );
    return { body: () => body };
  }

  it.each([
    [{ parent_id: null }],
    [{ creature_id: null }],
  ])("creature update sends %j so a parent can be cleared", async (data) => {
    const cap = capturePatch("creatures/38988");
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "creature",
      id: 38988,
      data,
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(cap.body()).toEqual(data);
  });

  it("item update accepts parent_id null and the legacy item_id null", async () => {
    const cap = capturePatch("items/5");
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "item",
      id: 5,
      data: { parent_id: null, item_id: null },
    });
    expect(r.isError, r.text).toBe(false);
    expect(cap.body()).toEqual({ parent_id: null, item_id: null });
  });

  it("create still refuses a null parent_id", async () => {
    const r = await call("kanka_create_entity", {
      campaign_id: 1,
      entity_type: "creature",
      data: { name: "Raven", parent_id: null },
    });
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("character update sends status_id, locations and trait fields", async () => {
    const cap = capturePatch("characters/9");
    const data = {
      status_id: 3,
      is_dead: true,
      title: "Founder",
      pronouns: "he/him",
      races: [290352],
      families: [34],
      locations: [67, 66],
      personality_name: ["Goals"],
      personality_entry: ["Profit"],
      appearance_name: ["Eyes"],
      appearance_entry: ["Green"],
      is_personality_pinned: true,
      is_appearance_pinned: false,
      entity_image_uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    };
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "character",
      id: 9,
      data,
    });
    expect(r.isError, r.text).toBe(false);
    expect(cap.body()).toEqual(data);
    expect(r.body).not.toHaveProperty("ignored_fields");
  });

  it("status_id can be cleared with null on update", async () => {
    const cap = capturePatch("characters/9");
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "character",
      id: 9,
      data: { status_id: null },
    });
    expect(r.isError, r.text).toBe(false);
    expect(cap.body()).toEqual({ status_id: null });
  });

  it("fields the schema does not know are reported as ignored_fields instead of vanishing", async () => {
    const cap = capturePatch("organisations/7");
    const r = await call("kanka_update_entity", {
      campaign_id: 1,
      entity_type: "organisation",
      id: 7,
      data: { name: "Goldfinger Co.", is_defunct: true },
      response: "slim",
    });
    expect(r.isError, r.text).toBe(false);
    expect(cap.body()).toEqual({ name: "Goldfinger Co." });
    expect(r.body.ignored_fields).toEqual(["is_defunct"]);
  });
});
