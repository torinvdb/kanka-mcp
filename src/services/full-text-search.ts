import type { KankaClient } from "../client/client.js";
import { ENTITY_TYPES, type EntityType } from "../schemas/entity-types.js";
import { snippet, stripHtml } from "./html.js";

export interface FtsOptions {
  campaignId: number;
  query: string;
  types?: EntityType[];
  maxPagesPerType?: number;
  perPage?: number;
  limit?: number;
  caseSensitive?: boolean;
  regex?: boolean;
}

export interface FtsMatch {
  entity_id: number;
  id: number;
  type: EntityType;
  name: string;
  snippet: string;
  matchIndex: number;
}

export interface FtsReport {
  matches: FtsMatch[];
  scanned: { type: EntityType; pages: number; entities: number }[];
  truncated: boolean;
  pagesWalked: number;
  entitiesScanned: number;
}

function buildMatcher(opts: FtsOptions): (text: string) => number {
  if (opts.regex) {
    const flags = opts.caseSensitive ? "" : "i";
    const re = new RegExp(opts.query, flags);
    return (text) => {
      const m = re.exec(text);
      return m ? m.index : -1;
    };
  }
  if (opts.caseSensitive) {
    return (text) => text.indexOf(opts.query);
  }
  const needle = opts.query.toLowerCase();
  return (text) => text.toLowerCase().indexOf(needle);
}

export async function fullTextSearch(
  client: KankaClient,
  opts: FtsOptions,
): Promise<FtsReport> {
  const types = (opts.types && opts.types.length > 0 ? opts.types : ENTITY_TYPES) as EntityType[];
  const maxPagesPerType = opts.maxPagesPerType ?? 5;
  const perPage = opts.perPage ?? 30;
  const limit = opts.limit ?? 50;
  const matcher = buildMatcher(opts);

  const matches: FtsMatch[] = [];
  const scanned: FtsReport["scanned"] = [];
  let totalPages = 0;
  let totalEntities = 0;

  outer: for (const type of types) {
    let page = 1;
    let pagesForType = 0;
    let entitiesForType = 0;
    while (pagesForType < maxPagesPerType) {
      const response = await client.listEntitiesPage({
        campaignId: opts.campaignId,
        type,
        page,
        perPage,
      });
      pagesForType += 1;
      totalPages += 1;
      entitiesForType += response.data.length;
      totalEntities += response.data.length;

      for (const item of response.data) {
        const entry = (item as { entry?: string | null }).entry ?? "";
        const text = stripHtml(entry);
        if (!text) continue;
        const idx = matcher(text);
        if (idx < 0) continue;
        if (typeof item.entity_id !== "number" || typeof item.id !== "number") continue;
        matches.push({
          entity_id: item.entity_id,
          id: item.id,
          type,
          name: item.name,
          snippet: snippet(text, idx),
          matchIndex: idx,
        });
        if (matches.length >= limit) {
          scanned.push({ type, pages: pagesForType, entities: entitiesForType });
          break outer;
        }
      }

      const lastPage = response.meta?.last_page ?? page;
      if (page >= lastPage || !response.links?.next) break;
      page += 1;
    }
    scanned.push({ type, pages: pagesForType, entities: entitiesForType });
  }

  return {
    matches,
    scanned,
    truncated: matches.length >= limit,
    pagesWalked: totalPages,
    entitiesScanned: totalEntities,
  };
}
