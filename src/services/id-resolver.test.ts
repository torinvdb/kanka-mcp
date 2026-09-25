import { describe, it, expect, vi } from "vitest";

import type { KankaClient } from "../client/client.js";
import { IdResolver } from "./id-resolver.js";

function fakeClient(
  typeForEntity: Record<number, { type: string; entity_type?: string; child_id?: number; id?: number; name?: string }>,
) {
  return {
    getEntityByEntityId: vi.fn(async (_campaignId: number, entityId: number) => ({
      data: typeForEntity[entityId],
    })),
  } as unknown as KankaClient;
}

describe("IdResolver", () => {
  it("fetches once and caches subsequent lookups", async () => {
    const client = fakeClient({
      999: { type: "character", child_id: 42, name: "Aragorn" },
    });
    const resolver = new IdResolver(client);

    const first = await resolver.resolveByEntityId(123, 999);
    const second = await resolver.resolveByEntityId(123, 999);

    expect(first).toEqual(second);
    expect(first.type).toBe("character");
    expect(first.typeId).toBe(42);
    expect(client.getEntityByEntityId).toHaveBeenCalledTimes(1);
  });

  it("throws on unsupported entity types", async () => {
    const client = fakeClient({ 7: { type: "wizardry", child_id: 1 } });
    const resolver = new IdResolver(client);
    await expect(resolver.resolveByEntityId(1, 7)).rejects.toThrow(/Unsupported/);
  });

  it("prefers `entity_type` over the free-text `type` field", async () => {
    const client = fakeClient({ 8: { type: "Weapon", entity_type: "item", child_id: 3 } });
    const r = await new IdResolver(client).resolveByEntityId(1, 8);
    expect(r).toMatchObject({ type: "item", typeId: 3 });
  });

  it("does not fall back to free-text `type` when `entity_type` is present but unknown", async () => {
    const client = fakeClient({ 8: { type: "organisation", entity_type: "bookmark", child_id: 3 } });
    await expect(new IdResolver(client).resolveByEntityId(1, 8)).rejects.toThrow(/bookmark/);
  });

  it("rejects a non-integer child_id and does not cache it", async () => {
    const client = fakeClient({
      8: { type: "x", entity_type: "item", child_id: "5/../../x" as unknown as number },
    });
    const resolver = new IdResolver(client);
    await expect(resolver.resolveByEntityId(1, 8)).rejects.toThrow(/type-scoped id/);
    await expect(resolver.resolveByEntityId(1, 8)).rejects.toThrow();
    expect(client.getEntityByEntityId).toHaveBeenCalledTimes(2);
  });

  it("remember() ignores entries whose ids are not positive integers", async () => {
    const client = fakeClient({ 9: { type: "x", entity_type: "item", child_id: 4 } });
    const resolver = new IdResolver(client);
    resolver.remember({ campaignId: 1, entityId: 9, type: "item", typeId: 1.5 });
    const r = await resolver.resolveByEntityId(1, 9);
    expect(r.typeId).toBe(4);
  });

  it("maps the `object` alias to `item`", async () => {
    const client = fakeClient({ 8: { type: "object", child_id: 3 } });
    const r = await new IdResolver(client).resolveByEntityId(1, 8);
    expect(r.type).toBe("item");
  });

  it("uses remembered entries without hitting the client", async () => {
    const client = fakeClient({});
    const resolver = new IdResolver(client);
    resolver.remember({
      campaignId: 1,
      entityId: 50,
      type: "location",
      typeId: 5,
      name: "Rivendell",
    });
    const r = await resolver.resolveByEntityId(1, 50);
    expect(r.typeId).toBe(5);
    expect(client.getEntityByEntityId).not.toHaveBeenCalled();
  });

  it("forget() removes cached entries", async () => {
    const client = fakeClient({ 50: { type: "location", child_id: 5 } });
    const resolver = new IdResolver(client);
    resolver.remember({ campaignId: 1, entityId: 50, type: "location", typeId: 5 });
    resolver.forget(1, 50);
    await resolver.resolveByEntityId(1, 50);
    expect(client.getEntityByEntityId).toHaveBeenCalledTimes(1);
  });
});
