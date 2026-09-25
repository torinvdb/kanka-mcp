import { ENTITY_TYPE_PATHS, type EntityType } from "../schemas/entity-types.js";
import type { KankaListResponse, KankaSingleResponse } from "../types.js";
import { HttpClient } from "./http.js";

export interface CampaignSummary {
  id: number;
  name: string;
  locale?: string;
  entry?: string;
  image?: string;
  visibility?: string;
  visibility_id?: number;
  [key: string]: unknown;
}

export interface EntityRef {
  id: number;
  entity_id: number;
  name: string;
  type?: string | null;
  [key: string]: unknown;
}

export interface KankaProfile {
  id: number;
  name: string;
  is_subscriber: boolean;
  rate_limit: number;
  [key: string]: unknown;
}

export interface SearchResult {
  id: number;
  entity_id: number;
  name: string;
  type: string;
  tooltip?: string | null;
  url?: string | null;
  is_private?: boolean;
  image?: string | null;
  [key: string]: unknown;
}

/** Collections that hang off a global entity_id: `campaigns/{c}/entities/{entity_id}/{sub}`. */
export type EntitySubResource = "posts" | "relations" | "attributes" | "entity_tags";

/** One slot of `entities/{entity_id}/image`. Fields are null when the slot is empty. */
export interface EntityImageSlot {
  uuid?: string | null;
  full?: string | null;
  thumbnail?: string | null;
  [key: string]: unknown;
}

/**
 * `null` means Kanka reported the slot as empty. `undefined` means the response did not
 * carry the slot as an object or explicit null, so its state is unknown.
 */
export interface EntityImage {
  image: EntityImageSlot | null | undefined;
  header: EntityImageSlot | null | undefined;
}

export interface EntityImageUpload {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Accept both the documented bare shape and a `{ data: ... }` envelope. */
function toEntityImage(raw: unknown): EntityImage {
  let body: Record<string, unknown> = isRecord(raw) ? raw : {};
  if (!("image" in body) && !("header" in body) && isRecord(body.data)) {
    body = body.data;
  }
  const slot = (key: "image" | "header"): EntityImageSlot | null | undefined => {
    if (!(key in body)) return undefined;
    const v = body[key];
    if (v === null) return null;
    return isRecord(v) ? (v as EntityImageSlot) : undefined;
  };
  return { image: slot("image"), header: slot("header") };
}

export interface ListEntitiesParams {
  campaignId: number;
  type?: EntityType;
  page?: number;
  perPage?: number;
  filters?: Record<string, string | number | boolean>;
  /** ISO 8601 timestamp; passed as `?lastSync=` to return only entities changed after this time. */
  lastSync?: string;
}

export class KankaClient {
  constructor(private readonly http: HttpClient) {}

  getProfile(): Promise<KankaSingleResponse<KankaProfile>> {
    return this.http.request<KankaSingleResponse<KankaProfile>>({ path: "profile" });
  }

  listCampaigns(page = 1): Promise<KankaListResponse<CampaignSummary>> {
    return this.http.request<KankaListResponse<CampaignSummary>>({
      path: "campaigns",
      query: { page },
    });
  }

  getCampaign(id: number): Promise<KankaSingleResponse<CampaignSummary>> {
    return this.http.request<KankaSingleResponse<CampaignSummary>>({
      path: `campaigns/${id}`,
    });
  }

  search(
    campaignId: number,
    term: string,
    page = 1,
  ): Promise<KankaListResponse<SearchResult>> {
    return this.http.request<KankaListResponse<SearchResult>>({
      path: `campaigns/${campaignId}/search/${encodeURIComponent(term)}`,
      query: { page },
    });
  }

  listEntitiesPage(params: ListEntitiesParams): Promise<KankaListResponse<EntityRef>> {
    const { campaignId, type, page = 1, perPage, filters, lastSync } = params;
    const path = type ? `campaigns/${campaignId}/${ENTITY_TYPE_PATHS[type]}` : `campaigns/${campaignId}/entities`;
    const query: Record<string, string | number | boolean | undefined> = { page };
    if (perPage) query.per_page = perPage;
    if (lastSync) query.lastSync = lastSync;
    if (filters) {
      for (const [k, v] of Object.entries(filters)) query[k] = v;
    }
    return this.http.request<KankaListResponse<EntityRef>>({ path, query });
  }

  getTypedEntity(
    campaignId: number,
    type: EntityType,
    id: number,
  ): Promise<KankaSingleResponse<EntityRef>> {
    return this.http.request<KankaSingleResponse<EntityRef>>({
      path: `campaigns/${campaignId}/${ENTITY_TYPE_PATHS[type]}/${id}`,
    });
  }

  getEntityByEntityId(
    campaignId: number,
    entityId: number,
  ): Promise<KankaSingleResponse<EntityRef>> {
    return this.http.request<KankaSingleResponse<EntityRef>>({
      path: `campaigns/${campaignId}/entities/${entityId}`,
    });
  }

  createEntity(
    campaignId: number,
    type: EntityType,
    data: Record<string, unknown>,
  ): Promise<KankaSingleResponse<EntityRef>> {
    return this.http.request<KankaSingleResponse<EntityRef>>({
      method: "POST",
      path: `campaigns/${campaignId}/${ENTITY_TYPE_PATHS[type]}`,
      body: data,
    });
  }

  updateEntity(
    campaignId: number,
    type: EntityType,
    id: number,
    data: Record<string, unknown>,
  ): Promise<KankaSingleResponse<EntityRef>> {
    return this.http.request<KankaSingleResponse<EntityRef>>({
      method: "PATCH",
      path: `campaigns/${campaignId}/${ENTITY_TYPE_PATHS[type]}/${id}`,
      body: data,
    });
  }

  deleteEntity(campaignId: number, type: EntityType, id: number): Promise<void> {
    return this.http.request<void>({
      method: "DELETE",
      path: `campaigns/${campaignId}/${ENTITY_TYPE_PATHS[type]}/${id}`,
    });
  }

  listSubResource<T>(
    campaignId: number,
    entityId: number,
    sub: EntitySubResource,
    page = 1,
  ): Promise<KankaListResponse<T>> {
    return this.http.request<KankaListResponse<T>>({
      path: `campaigns/${campaignId}/entities/${entityId}/${sub}`,
      query: { page },
    });
  }

  getSubResource<T>(
    campaignId: number,
    entityId: number,
    sub: EntitySubResource,
    id: number,
  ): Promise<KankaSingleResponse<T>> {
    return this.http.request<KankaSingleResponse<T>>({
      path: `campaigns/${campaignId}/entities/${entityId}/${sub}/${id}`,
    });
  }

  createSubResource<T>(
    campaignId: number,
    entityId: number,
    sub: EntitySubResource,
    data: Record<string, unknown>,
  ): Promise<KankaSingleResponse<T>> {
    return this.http.request<KankaSingleResponse<T>>({
      method: "POST",
      path: `campaigns/${campaignId}/entities/${entityId}/${sub}`,
      body: data,
    });
  }

  updateSubResource<T>(
    campaignId: number,
    entityId: number,
    sub: EntitySubResource,
    id: number,
    data: Record<string, unknown>,
  ): Promise<KankaSingleResponse<T>> {
    return this.http.request<KankaSingleResponse<T>>({
      method: "PATCH",
      path: `campaigns/${campaignId}/entities/${entityId}/${sub}/${id}`,
      body: data,
    });
  }

  deleteSubResource(
    campaignId: number,
    entityId: number,
    sub: EntitySubResource,
    id: number,
  ): Promise<void> {
    return this.http.request<void>({
      method: "DELETE",
      path: `campaigns/${campaignId}/entities/${entityId}/${sub}/${id}`,
    });
  }

  // Entity image: campaigns/{c}/entities/{entity_id}/image. `entityId` is the global entity_id.

  async getEntityImage(campaignId: number, entityId: number): Promise<EntityImage> {
    return toEntityImage(await this.http.request<unknown>({ path: this.imagePath(campaignId, entityId) }));
  }

  async uploadEntityImage(
    campaignId: number,
    entityId: number,
    file: EntityImageUpload,
    isHeader?: boolean,
  ): Promise<EntityImage> {
    const form = new FormData();
    form.append("file", new Blob([file.bytes], { type: file.mimeType }), file.filename);
    if (isHeader !== undefined) form.append("is_header", isHeader ? "1" : "0");
    return toEntityImage(
      await this.http.request<unknown>({
        method: "POST",
        path: this.imagePath(campaignId, entityId),
        formData: form,
      }),
    );
  }

  async deleteEntityImage(campaignId: number, entityId: number, isHeader?: boolean): Promise<EntityImage> {
    return toEntityImage(
      await this.http.request<unknown>({
        method: "DELETE",
        path: this.imagePath(campaignId, entityId),
        query: isHeader ? { is_header: 1 } : undefined,
      }),
    );
  }

  private imagePath(campaignId: number, entityId: number): string {
    return `campaigns/${campaignId}/entities/${entityId}/image`;
  }

  // Organisation memberships: campaigns/{c}/organisations/{organisation_id}/organisation_members.
  // `organisationId` is the type-scoped organisation id, not the entity_id.

  listOrganisationMembers<T>(
    campaignId: number,
    organisationId: number,
    page = 1,
  ): Promise<KankaListResponse<T>> {
    return this.http.request<KankaListResponse<T>>({
      path: this.orgMembersPath(campaignId, organisationId),
      query: { page },
    });
  }

  getOrganisationMember<T>(
    campaignId: number,
    organisationId: number,
    id: number,
  ): Promise<KankaSingleResponse<T>> {
    return this.http.request<KankaSingleResponse<T>>({
      path: `${this.orgMembersPath(campaignId, organisationId)}/${id}`,
    });
  }

  createOrganisationMember<T>(
    campaignId: number,
    organisationId: number,
    data: Record<string, unknown>,
  ): Promise<KankaSingleResponse<T>> {
    return this.http.request<KankaSingleResponse<T>>({
      method: "POST",
      path: this.orgMembersPath(campaignId, organisationId),
      body: data,
    });
  }

  updateOrganisationMember<T>(
    campaignId: number,
    organisationId: number,
    id: number,
    data: Record<string, unknown>,
  ): Promise<KankaSingleResponse<T>> {
    return this.http.request<KankaSingleResponse<T>>({
      method: "PATCH",
      path: `${this.orgMembersPath(campaignId, organisationId)}/${id}`,
      body: data,
    });
  }

  deleteOrganisationMember(campaignId: number, organisationId: number, id: number): Promise<void> {
    return this.http.request<void>({
      method: "DELETE",
      path: `${this.orgMembersPath(campaignId, organisationId)}/${id}`,
    });
  }

  private orgMembersPath(campaignId: number, organisationId: number): string {
    return `campaigns/${campaignId}/organisations/${organisationId}/organisation_members`;
  }
}
