// Canonical names follow Kanka's module codes (the `entity_type` field on
// /entities and the `type` field on /search results), so what the API reports
// can be fed straight back into a tool call.
export const ENTITY_TYPES = [
  "character",
  "location",
  "family",
  "organisation",
  "item",
  "note",
  "event",
  "calendar",
  "creature",
  "race",
  "quest",
  "map",
  "journal",
  "ability",
  "tag",
  "conversation",
  "dice_roll",
  "timeline",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/** Accepted spellings that map onto a canonical type. `object` was this server's original name for items. */
export const ENTITY_TYPE_ALIASES = { object: "item" } as const satisfies Record<string, EntityType>;

/** Every value a tool accepts for `entity_type`: the canonical names plus aliases. */
export const ENTITY_TYPE_INPUTS = [
  ...ENTITY_TYPES,
  ...(Object.keys(ENTITY_TYPE_ALIASES) as (keyof typeof ENTITY_TYPE_ALIASES)[]),
] as const;

export type EntityTypeInput = EntityType | keyof typeof ENTITY_TYPE_ALIASES;

export const ENTITY_TYPE_PATHS: Record<EntityType, string> = {
  character: "characters",
  location: "locations",
  family: "families",
  organisation: "organisations",
  item: "items",
  note: "notes",
  event: "events",
  calendar: "calendars",
  creature: "creatures",
  race: "races",
  quest: "quests",
  map: "maps",
  journal: "journals",
  ability: "abilities",
  tag: "tags",
  conversation: "conversations",
  dice_roll: "dice-rolls",
  timeline: "timelines",
};

/** Types that nest under a parent of the same type. Kanka reads `parent_id`; older records carry `<type>_id`. */
export const TREE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  "location",
  "family",
  "organisation",
  "item",
  "note",
  "event",
  "creature",
  "race",
  "quest",
  "map",
  "journal",
  "ability",
  "tag",
  "timeline",
]);

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

/** Map a canonical name or alias to the canonical type; undefined for anything else. */
export function normalizeEntityType(value: unknown): EntityType | undefined {
  if (typeof value !== "string") return undefined;
  if (isEntityType(value)) return value;
  if (Object.hasOwn(ENTITY_TYPE_ALIASES, value)) {
    return ENTITY_TYPE_ALIASES[value as keyof typeof ENTITY_TYPE_ALIASES];
  }
  return undefined;
}
