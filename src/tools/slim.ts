import { z } from "zod";

import {
  normalizeEntityType,
  TREE_ENTITY_TYPES,
  type EntityType,
} from "../schemas/entity-types.js";

export const responseInput = z
  .enum(["full", "slim"])
  .optional()
  .describe(
    "`full` (default) returns the record as Kanka sends it. `slim` returns a short summary without `entry`, `entry_parsed`, image URLs or audit fields; use it for writes and bulk reads.",
  );

export const fieldsInput = z
  .array(z.string().min(1).max(64))
  .max(20)
  .optional()
  .describe(
    "With response: 'slim', extra top-level keys to copy from the record, e.g. ['entry'] or ['entry', 'tags']. Ignored for `full`.",
  );

export type ResponseMode = "full" | "slim";

type Row = Record<string, unknown>;

const ENTITY_SLIM_KEYS = ["id", "entity_id", "name", "type", "is_private", "updated_at"] as const;
// Present only on rows from the untyped /entities endpoint; they say which typed record the row points at.
const ENTITY_ROUTING_KEYS = ["entity_type", "child_id"] as const;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyKeys(source: Row, keys: readonly string[], target: Row): void {
  for (const key of keys) {
    if (!Object.hasOwn(source, key)) continue;
    // defineProperty, not assignment, so a caller-chosen key like "__proto__" stays a plain data key.
    Object.defineProperty(target, key, {
      value: source[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Summary of an entity record. `parent_id` is included for tree types, read from
 * `parent_id` or, on older records, the `<type>_id` field. Unknown types and
 * non-object values pass through untouched.
 */
export function slimEntity(record: unknown, type?: EntityType, fields?: readonly string[]): unknown {
  if (!isRow(record)) return record;
  const out: Row = {};
  copyKeys(record, ENTITY_SLIM_KEYS, out);
  copyKeys(record, ENTITY_ROUTING_KEYS, out);
  const treeType = type ?? normalizeEntityType(record.entity_type);
  if (treeType && TREE_ENTITY_TYPES.has(treeType)) {
    out.parent_id = record.parent_id ?? record[`${treeType}_id`] ?? null;
  }
  if (fields) copyKeys(record, fields, out);
  return out;
}

/** Keep only `keys` (plus any requested `fields`) from a sub-resource record. */
export function slimRecord(record: unknown, keys: readonly string[], fields?: readonly string[]): unknown {
  if (!isRow(record)) return record;
  const out: Row = {};
  copyKeys(record, keys, out);
  if (fields) copyKeys(record, fields, out);
  return out;
}
