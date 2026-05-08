import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

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
import { ENTITY_TYPES, type EntityType } from "./entity-types.js";

const REGISTRY: Record<EntityType, ZodTypeAny> = {
  character: CharacterInputSchema,
  location: LocationInputSchema,
  note: NoteInputSchema,
  family: FamilyInputSchema,
  organisation: OrganisationInputSchema,
  object: ObjectInputSchema,
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

export function getCreateSchema(type: EntityType): ZodTypeAny {
  return REGISTRY[type] ?? BaseEntityInputSchema;
}

export function getUpdateSchema(type: EntityType): ZodTypeAny {
  const schema = getCreateSchema(type);
  if (typeof (schema as { partial?: unknown }).partial === "function") {
    return (schema as unknown as { partial: () => ZodTypeAny }).partial();
  }
  return schema;
}

export function describeEntityType(type: EntityType): {
  type: EntityType;
  hasDedicatedSchema: boolean;
  createSchema: ReturnType<typeof zodToJsonSchema>;
  updateSchema: ReturnType<typeof zodToJsonSchema>;
} {
  return {
    type,
    hasDedicatedSchema: REGISTRY[type] !== undefined,
    createSchema: zodToJsonSchema(getCreateSchema(type)),
    updateSchema: zodToJsonSchema(getUpdateSchema(type)),
  };
}

export { ENTITY_TYPES };
export type { EntityType };
