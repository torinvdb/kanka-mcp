export const ENTITY_TYPES = [
  "character",
  "location",
  "family",
  "organisation",
  "object",
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

export const ENTITY_TYPE_PATHS: Record<EntityType, string> = {
  character: "characters",
  location: "locations",
  family: "families",
  organisation: "organisations",
  object: "items",
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

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}
