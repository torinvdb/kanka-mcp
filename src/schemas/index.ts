import { zodToJsonSchema } from "zod-to-json-schema";
import { z, type ZodTypeAny } from "zod";

import { BaseEntityInputSchema } from "./common.js";
import { CharacterInputSchema } from "./character.js";
import { LocationInputSchema } from "./location.js";
import { NoteInputSchema } from "./note.js";
import { FamilyInputSchema } from "./family.js";
import { OrganisationInputSchema } from "./organisation.js";
import { ObjectInputSchema } from "./object.js";
import { EventInputSchema } from "./event.js";
import { CalendarInputSchema } from "./calendar.js";
import { CreatureInputSchema } from "./creature.js";
import { RaceInputSchema } from "./race.js";
import { QuestInputSchema } from "./quest.js";
import { MapInputSchema } from "./map.js";
import { JournalInputSchema } from "./journal.js";
import { AbilityInputSchema } from "./ability.js";
import { TagInputSchema } from "./tag.js";
import { ConversationInputSchema } from "./conversation.js";
import { DiceRollInputSchema } from "./dice-roll.js";
import { TimelineInputSchema } from "./timeline.js";
import {
  normalizeEntityType,
  TREE_ENTITY_TYPES,
  type EntityType,
  type EntityTypeInput,
} from "./entity-types.js";

const REGISTRY: Record<EntityType, ZodTypeAny> = {
  character: CharacterInputSchema,
  location: LocationInputSchema,
  note: NoteInputSchema,
  family: FamilyInputSchema,
  organisation: OrganisationInputSchema,
  item: ObjectInputSchema,
  event: EventInputSchema,
  calendar: CalendarInputSchema,
  creature: CreatureInputSchema,
  race: RaceInputSchema,
  quest: QuestInputSchema,
  map: MapInputSchema,
  journal: JournalInputSchema,
  ability: AbilityInputSchema,
  tag: TagInputSchema,
  conversation: ConversationInputSchema,
  dice_roll: DiceRollInputSchema,
  timeline: TimelineInputSchema,
};

function canonical(type: EntityTypeInput): EntityType {
  const t = normalizeEntityType(type);
  if (!t) throw new Error(`Unknown entity type: ${String(type)}`);
  return t;
}

export function getCreateSchema(type: EntityTypeInput): ZodTypeAny {
  return REGISTRY[canonical(type)] ?? BaseEntityInputSchema;
}

// Clearing a value on PATCH means sending JSON null, which the create schemas reject.
// Parent fields (`parent_id` and the legacy `<type>_id`) and `status_id` accept null on update only.
const nullableId = z.number().int().positive().nullable().optional();

export function getUpdateSchema(type: EntityTypeInput): ZodTypeAny {
  const t = canonical(type);
  const schema = getCreateSchema(t);
  if (!(schema instanceof z.ZodObject)) return schema;
  const partial = schema.partial();
  const clearable: Record<string, typeof nullableId> = {};
  const candidates = ["status_id", ...(TREE_ENTITY_TYPES.has(t) ? ["parent_id", `${t}_id`] : [])];
  for (const key of candidates) {
    if (Object.hasOwn(partial.shape, key)) clearable[key] = nullableId;
  }
  return partial.extend(clearable);
}

/** Top-level keys in `data` that `schema` does not declare and would strip before sending. */
export function unknownKeys(schema: ZodTypeAny, data: Record<string, unknown>): string[] {
  if (!(schema instanceof z.ZodObject)) return [];
  const shape = schema.shape as Record<string, unknown>;
  return Object.keys(data).filter((k) => !Object.hasOwn(shape, k));
}

export function describeEntityType(input: EntityTypeInput): {
  type: EntityType;
  hasDedicatedSchema: boolean;
  createSchema: ReturnType<typeof zodToJsonSchema>;
  updateSchema: ReturnType<typeof zodToJsonSchema>;
} {
  const type = canonical(input);
  return {
    type,
    hasDedicatedSchema: REGISTRY[type] !== undefined,
    createSchema: zodToJsonSchema(getCreateSchema(type)),
    updateSchema: zodToJsonSchema(getUpdateSchema(type)),
  };
}

export { ENTITY_TYPES, ENTITY_TYPE_INPUTS, normalizeEntityType } from "./entity-types.js";
export type { EntityType, EntityTypeInput };
