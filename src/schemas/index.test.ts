import { describe, it, expect } from "vitest";

import {
  describeEntityType,
  ENTITY_TYPES,
  getCreateSchema,
  getUpdateSchema,
} from "./index.js";

describe("schema registry", () => {
  it("has a dedicated schema for every supported entity type", () => {
    for (const t of ENTITY_TYPES) {
      const schema = getCreateSchema(t);
      expect(schema).toBeDefined();
    }
  });

  it("character requires `name`", () => {
    const schema = getCreateSchema("character");
    const result = schema.safeParse({ entry: "no name here" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join("."));
      expect(fields).toContain("name");
    }
  });

  it("calendar requires `name` AND `weekday` (min 2)", () => {
    const schema = getCreateSchema("calendar");
    const missing = schema.safeParse({});
    expect(missing.success).toBe(false);

    const tooShort = schema.safeParse({ name: "test", weekday: ["Mon"] });
    expect(tooShort.success).toBe(false);

    const ok = schema.safeParse({ name: "test", weekday: ["Mon", "Tue"] });
    expect(ok.success).toBe(true);
  });

  it("dice_roll requires `parameters`", () => {
    const schema = getCreateSchema("dice_roll");
    const missing = schema.safeParse({ name: "test" });
    expect(missing.success).toBe(false);

    const ok = schema.safeParse({ name: "test", parameters: "1d20+3" });
    expect(ok.success).toBe(true);
  });

  it("conversation requires `target_id` to be 1 or 2", () => {
    const schema = getCreateSchema("conversation");
    const bad = schema.safeParse({ name: "test", target_id: 5 });
    expect(bad.success).toBe(false);

    const ok = schema.safeParse({ name: "test", target_id: 2 });
    expect(ok.success).toBe(true);
  });

  it("update schema is partial — name becomes optional", () => {
    const schema = getUpdateSchema("character");
    const result = schema.safeParse({ entry: "just an update" });
    expect(result.success).toBe(true);
  });

  it("describeEntityType emits a JSON Schema with required + properties inline", () => {
    const desc = describeEntityType("character");
    expect(desc.type).toBe("character");
    expect(desc.hasDedicatedSchema).toBe(true);

    const create = desc.createSchema as { type?: string; required?: string[]; properties?: Record<string, unknown> };
    expect(create.type).toBe("object");
    expect(create.required).toContain("name");
    expect(Object.keys(create.properties ?? {})).toContain("title");
  });
});
