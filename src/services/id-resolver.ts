import type { KankaClient } from "../client/client.js";
import { normalizeEntityType, type EntityType } from "../schemas/entity-types.js";

export interface ResolvedEntity {
  campaignId: number;
  entityId: number;
  type: EntityType;
  typeId: number;
  name?: string;
}

/** Ids end up in URL paths, so only positive integers are ever cached or returned. */
export function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export class IdResolver {
  private readonly cache = new Map<string, ResolvedEntity>();
  private readonly maxSize = 1000;

  constructor(private readonly client: KankaClient) {}

  remember(entry: ResolvedEntity): void {
    // Callers feed this from API responses (untrusted); a malformed id must never reach a path.
    if (!isPositiveInt(entry.entityId) || !isPositiveInt(entry.typeId)) return;
    if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(this.key(entry.campaignId, entry.entityId), entry);
  }

  forget(campaignId: number, entityId: number): void {
    this.cache.delete(this.key(campaignId, entityId));
  }

  async resolveByEntityId(campaignId: number, entityId: number): Promise<ResolvedEntity> {
    const cached = this.cache.get(this.key(campaignId, entityId));
    if (cached) return cached;

    const response = await this.client.getEntityByEntityId(campaignId, entityId);
    const data = response.data as {
      entity_type?: unknown;
      type?: unknown;
      child_id?: unknown;
      id?: unknown;
      name?: string;
    };
    // Kanka reports the module code in `entity_type` ("item", "race"); `type` is the
    // user's free-text Type field ("Weapon"). Some responses omit `entity_type` and carry
    // the module code in `type`; only then is `type` consulted.
    const type =
      data.entity_type === undefined
        ? normalizeEntityType(data.type)
        : normalizeEntityType(data.entity_type);
    if (!type) {
      const reported = String(data.entity_type ?? data.type);
      throw new Error(`Unsupported or unknown entity type for entity_id ${entityId}: ${reported}`);
    }
    const typeId = data.child_id ?? data.id;
    if (!isPositiveInt(typeId)) {
      throw new Error(`Could not determine type-scoped id for entity_id ${entityId}`);
    }
    const resolved: ResolvedEntity = {
      campaignId,
      entityId,
      type,
      typeId,
      name: data.name,
    };
    this.remember(resolved);
    return resolved;
  }

  private key(campaignId: number, entityId: number): string {
    return `${campaignId}:${entityId}`;
  }
}
