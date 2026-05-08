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
    sub: "posts" | "relations",
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
    sub: "posts" | "relations",
    id: number,
  ): Promise<KankaSingleResponse<T>> {
    return this.http.request<KankaSingleResponse<T>>({
      path: `campaigns/${campaignId}/entities/${entityId}/${sub}/${id}`,
    });
  }

  createSubResource<T>(
    campaignId: number,
    entityId: number,
    sub: "posts" | "relations",
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
    sub: "posts" | "relations",
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
    sub: "posts" | "relations",
    id: number,
  ): Promise<void> {
    return this.http.request<void>({
      method: "DELETE",
      path: `campaigns/${campaignId}/entities/${entityId}/${sub}/${id}`,
    });
  }
}
