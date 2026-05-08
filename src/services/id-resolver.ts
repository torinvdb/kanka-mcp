import type { KankaClient } from "../client/client.js";
import { isEntityType, type EntityType } from "../schemas/entity-types.js";

export interface ResolvedEntity {
  campaignId: number;
  entityId: number;
  type: EntityType;
  typeId: number;
  name?: string;
}

export class IdResolver {
  private readonly cache = new Map<string, ResolvedEntity>();
  private readonly maxSize = 1000;

  constructor(private readonly client: KankaClient) {}

  remember(entry: ResolvedEntity): void {
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
    const data = response.data as { type?: string; child_id?: number; id?: number; name?: string };
    const typeRaw = data.type;
    if (!typeRaw || !isEntityType(typeRaw)) {
      throw new Error(`Unsupported or unknown entity type for entity_id ${entityId}: ${typeRaw}`);
    }
    const typeId = data.child_id ?? data.id;
    if (!typeId) {
      throw new Error(`Could not determine type-scoped id for entity_id ${entityId}`);
    }
    const resolved: ResolvedEntity = {
      campaignId,
      entityId,
      type: typeRaw,
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
