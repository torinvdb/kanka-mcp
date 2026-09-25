import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { logger } from "../logger.js";
import { TtlCache } from "../services/cache.js";
import { IdResolver } from "../services/id-resolver.js";
import type { ProfileService } from "../services/profile.js";
import { DEFAULT_UPLOAD_MAX_BYTES, type UploadSettings } from "../services/upload-policy.js";
import type { KankaListResponse } from "../types.js";
import { registerAllTools } from "./register.js";

// kanka_entity_image over an in-memory MCP transport, HTTP mocked with msw. No live API.

const BASE = "https://api.kanka.io/1.0";
const IMG = `${BASE}/campaigns/1/entities/700/image`;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("PNG-BODY-MARKER"),
]);

const EMPTY = { image: { uuid: null, full: null, thumbnail: null }, header: { uuid: null, full: null, thumbnail: null } };
const LEGACY = {
  image: { uuid: "old-uuid", full: "https://cdn.example.invalid/legacy.png", thumbnail: "https://cdn.example.invalid/legacy-t.png" },
  header: { uuid: null, full: null, thumbnail: null },
};
const UPLOADED = {
  image: { uuid: "new-uuid", full: "https://cdn.example.invalid/new.png", thumbnail: "https://cdn.example.invalid/new-t.png" },
  header: { uuid: null, full: null, thumbnail: null },
};

const msw = setupServer();
beforeAll(() => msw.listen({ onUnhandledRequest: "error" }));
afterEach(() => msw.resetHandlers());
afterAll(() => msw.close());

let base: string;
let root: string;
let uploadSettings: UploadSettings;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "kanka-entity-image-"));
  root = join(base, "art");
  mkdirSync(root);
  mkdirSync(join(base, "artX"));
  mkdirSync(join(base, "outside"));
  writeFileSync(join(root, "gloop.png"), PNG);
  writeFileSync(join(root, "fake.png"), "FAKE-FILE-CONTENT");
  writeFileSync(join(root, "huge.png"), Buffer.concat([PNG, Buffer.alloc(500)]));
  writeFileSync(join(base, "artX", "gloop.png"), PNG);
  writeFileSync(join(base, "outside", "secret.png"), PNG);
  symlinkSync(join(base, "outside", "secret.png"), join(root, "escape.png"));
  symlinkSync(join(base, "outside"), join(root, "linked-dir"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

let client: Client;

beforeEach(async () => {
  uploadSettings = { roots: [root], maxBytes: DEFAULT_UPLOAD_MAX_BYTES, source: "env", homeDir: join(base, "home") };
  const limiter = new RateLimiter({ perMinute: 60_000, burstMax: 100 });
  const httpClient = new HttpClient(BASE, { getToken: async () => "test-token" }, limiter);
  const kanka = new KankaClient(httpClient);
  const server = new McpServer({ name: "kanka-mcp-test", version: "0.0.0" });
  registerAllTools(server, {
    client: kanka,
    auth: {} as AuthProvider,
    idResolver: new IdResolver(kanka),
    campaignsCache: new TtlCache<string, KankaListResponse<CampaignSummary>>(60_000),
    profile: {} as ProfileService,
    uploadSettings: () => uploadSettings,
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

async function call(args: Record<string, unknown>): Promise<CallOutcome> {
  try {
    const res = (await client.callTool({ name: "kanka_entity_image", arguments: args })) as {
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

interface CapturedUpload {
  file: File | null;
  isHeader: FormDataEntryValue | null;
  contentType: string | null;
  authorization: string | null;
}

/** GET returns `current`; POST captures the multipart body and returns UPLOADED. */
function mockImageEndpoints(current: unknown): { posts: CapturedUpload[] } {
  const posts: CapturedUpload[] = [];
  msw.use(
    http.get(IMG, () => HttpResponse.json(current)),
    http.post(IMG, async ({ request }) => {
      const contentType = request.headers.get("content-type");
      const authorization = request.headers.get("authorization");
      const form = await request.formData();
      const file = form.get("file");
      posts.push({
        file: file instanceof File ? file : null,
        isHeader: form.get("is_header"),
        contentType,
        authorization,
      });
      return HttpResponse.json(UPLOADED);
    }),
  );
  return { posts };
}

const upload = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  campaign_id: 1,
  entity_id: 700,
  action: "upload",
  file_path: join(root, "gloop.png"),
  ...extra,
});

describe("kanka_entity_image: metadata", () => {
  it("is annotated as destructive", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "kanka_entity_image");
    expect(tool?.annotations?.destructiveHint).toBe(true);
  });
});

describe("kanka_entity_image: get", () => {
  it("returns the image and header slots", async () => {
    msw.use(http.get(IMG, () => HttpResponse.json(LEGACY)));
    const r = await call({ campaign_id: 1, entity_id: 700, action: "get" });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.image.full).toBe("https://cdn.example.invalid/legacy.png");
    expect(r.body.header.full).toBeNull();
  });

  it("unwraps a `data` envelope", async () => {
    msw.use(http.get(IMG, () => HttpResponse.json({ data: LEGACY })));
    const r = await call({ campaign_id: 1, entity_id: 700, action: "get" });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.image.uuid).toBe("old-uuid");
  });

  it("rejects a non-positive entity_id at input validation", async () => {
    const r = await call({ campaign_id: 1, entity_id: 0, action: "get" });
    expect(r.isError).toBe(true);
  });
});

describe("kanka_entity_image: upload", () => {
  it("uploads an allowlisted PNG as multipart `file` with its name and type", async () => {
    const { posts } = mockImageEndpoints(EMPTY);
    const r = await call(upload());
    expect(r.isError, r.text).toBe(false);
    expect(posts).toHaveLength(1);
    const sent = posts[0]!;
    expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent.authorization).toBe("Bearer test-token");
    expect(sent.file?.name).toBe("gloop.png");
    expect(sent.file?.type).toBe("image/png");
    expect(Buffer.from(await sent.file!.arrayBuffer()).equals(PNG)).toBe(true);
    expect(sent.isHeader).toBeNull();
    expect(r.body).toMatchObject({ entity_id: 700, slot: "image", replaced: false });
    expect(r.body.image.full).toBe("https://cdn.example.invalid/new.png");
    expect(r.text).not.toContain("PNG-BODY-MARKER");
  });

  it("passes is_header through and checks the header slot", async () => {
    // The main image is set but the header is empty, so no `replace` is needed.
    const { posts } = mockImageEndpoints(LEGACY);
    const r = await call(upload({ is_header: true }));
    expect(r.isError, r.text).toBe(false);
    expect(posts[0]!.isHeader).toBe("1");
    expect(r.body.slot).toBe("header");
  });

  it("refuses to overwrite an existing image without replace and reports its URL", async () => {
    const { posts } = mockImageEndpoints(LEGACY);
    const r = await call(upload());
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("UPLOAD_REFUSED");
    expect(r.body.error.message).toContain("https://cdn.example.invalid/legacy.png");
    expect(r.body.error.details.existing_image).toBe("https://cdn.example.invalid/legacy.png");
    expect(posts).toHaveLength(0);
  });

  it("overwrites an existing image when replace is true", async () => {
    const { posts } = mockImageEndpoints(LEGACY);
    const r = await call(upload({ replace: true }));
    expect(r.isError, r.text).toBe(false);
    expect(posts).toHaveLength(1);
    expect(r.body).toMatchObject({
      replaced: true,
      previous_image: "https://cdn.example.invalid/legacy.png",
    });
  });

  it("treats a `data`-wrapped GET with a uuid as an existing image", async () => {
    const { posts } = mockImageEndpoints({ data: LEGACY });
    const r = await call(upload());
    expect(r.isError).toBe(true);
    expect(posts).toHaveLength(0);
  });

  it("fails closed when the GET response has no readable image slot", async () => {
    const { posts } = mockImageEndpoints({ something: "else" });
    const r = await call(upload());
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("UPLOAD_REFUSED");
    expect(r.body.error.message).toMatch(/could not be read/);
    expect(posts).toHaveLength(0);
  });

  it("fails closed when the slot is present but not an object or null", async () => {
    const { posts } = mockImageEndpoints({ image: "https://cdn.example.invalid/x.png", header: null });
    const r = await call(upload());
    expect(r.isError).toBe(true);
    expect(r.body.error.message).toMatch(/could not be read/);
    expect(posts).toHaveLength(0);
  });

  it("fails closed for a header upload when only the image slot is present", async () => {
    const { posts } = mockImageEndpoints({ image: null });
    const r = await call(upload({ is_header: true }));
    expect(r.isError).toBe(true);
    expect(r.body.error.message).toMatch(/could not be read/);
    expect(posts).toHaveLength(0);
  });

  it("proceeds on an unreadable image state when replace is true", async () => {
    const { posts } = mockImageEndpoints({ something: "else" });
    const r = await call(upload({ replace: true }));
    expect(r.isError, r.text).toBe(false);
    expect(posts).toHaveLength(1);
  });

  it("treats an explicit `image: null` as empty", async () => {
    const { posts } = mockImageEndpoints({ image: null });
    const r = await call(upload());
    expect(r.isError, r.text).toBe(false);
    expect(posts).toHaveLength(1);
    expect(r.body.replaced).toBe(false);
  });

  it("requires file_path", async () => {
    const r = await call({ campaign_id: 1, entity_id: 700, action: "upload" });
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["a file outside every root", () => join(base, "outside", "secret.png")],
    ["a symlink escaping the root", () => join(root, "escape.png")],
    ["a symlinked directory escaping the root", () => join(root, "linked-dir", "secret.png")],
    ["a prefix sibling of the root", () => join(base, "artX", "gloop.png")],
    ["a .. traversal", () => join(root, "..", "outside", "secret.png")],
  ])("refuses %s before any HTTP call", async (_label, path) => {
    // onUnhandledRequest: "error" fails the test if the tool touches the API.
    const r = await call(upload({ file_path: path() }));
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("UPLOAD_REFUSED");
  });

  it("refuses when no roots are configured", async () => {
    uploadSettings = { ...uploadSettings, roots: [], source: "none" };
    const r = await call(upload());
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("UPLOAD_REFUSED");
    expect(r.body.error.message).toContain("KANKA_UPLOAD_ROOTS");
  });

  it("refuses bad magic bytes without echoing file content", async () => {
    const r = await call(upload({ file_path: join(root, "fake.png") }));
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("UPLOAD_REFUSED");
    expect(r.text).not.toContain("FAKE-FILE-CONTENT");
  });

  it("refuses a file over the size cap", async () => {
    uploadSettings = { ...uploadSettings, maxBytes: 100 };
    const r = await call(upload({ file_path: join(root, "huge.png") }));
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("UPLOAD_REFUSED");
  });

  it("maps a Kanka 422 on upload to VALIDATION_ERROR", async () => {
    msw.use(
      http.get(IMG, () => HttpResponse.json(EMPTY)),
      http.post(IMG, () =>
        HttpResponse.json(
          { message: "The file failed to upload.", errors: { file: ["too large"] } },
          { status: 422 },
        ),
      ),
    );
    const r = await call(upload());
    expect(r.isError).toBe(true);
    expect(r.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { fields: { file: ["too large"] } } });
  });
});

describe("kanka_entity_image: remove", () => {
  it("refuses without confirm: true", async () => {
    const r = await call({ campaign_id: 1, entity_id: 700, action: "remove" });
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(r.body.error.message).toContain("confirm");
  });

  it("deletes the image with confirm: true", async () => {
    let url: URL | undefined;
    msw.use(
      http.delete(IMG, ({ request }) => {
        url = new URL(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const r = await call({ campaign_id: 1, entity_id: 700, action: "remove", confirm: true });
    expect(r.isError, r.text).toBe(false);
    expect(r.body).toMatchObject({ removed: true, entity_id: 700, slot: "image" });
    expect(url?.searchParams.get("is_header")).toBeNull();
  });

  it("passes is_header on remove", async () => {
    let url: URL | undefined;
    msw.use(
      http.delete(IMG, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(EMPTY);
      }),
    );
    const r = await call({ campaign_id: 1, entity_id: 700, action: "remove", confirm: true, is_header: true });
    expect(r.isError, r.text).toBe(false);
    expect(r.body.slot).toBe("header");
    expect(url?.searchParams.get("is_header")).toBe("1");
  });
});

describe("kanka_entity_image: call logging", () => {
  it("logs ids and action through the call-log proxy, never the path or file content", async () => {
    const info = vi.spyOn(logger, "info");
    mockImageEndpoints(EMPTY);
    const r = await call(upload());
    expect(r.isError, r.text).toBe(false);
    const lines = info.mock.calls.filter((c) => c[1] === "tool call").map((c) => c[0]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      tool: "kanka_entity_image",
      campaign_id: 1,
      entity_id: 700,
      action: "upload",
      outcome: "ok",
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("gloop.png");
    expect(logged).not.toContain("PNG-BODY-MARKER");
    expect(logged).not.toContain("test-token");
    info.mockRestore();
  });

  it("logs a refusal with its error code", async () => {
    const info = vi.spyOn(logger, "info");
    await call(upload({ file_path: join(base, "outside", "secret.png") }));
    const line = info.mock.calls.find((c) => c[1] === "tool call")?.[0];
    expect(line).toMatchObject({ tool: "kanka_entity_image", outcome: "error", error_code: "UPLOAD_REFUSED" });
    info.mockRestore();
  });
});
