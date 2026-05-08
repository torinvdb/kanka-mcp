import type { KankaListResponse } from "../types.js";

export interface PaginateOptions {
  startPage?: number;
  maxPages?: number;
  perPage?: number;
}

export interface FetchPage<T> {
  (page: number, perPage: number): Promise<KankaListResponse<T>>;
}

export async function* paginateAll<T>(
  fetchPage: FetchPage<T>,
  options: PaginateOptions = {},
): AsyncGenerator<{ item: T; page: number; index: number }> {
  const startPage = options.startPage ?? 1;
  const maxPages = options.maxPages ?? 67;
  const perPage = options.perPage ?? 15;

  let page = startPage;
  let pagesWalked = 0;
  let index = 0;

  while (pagesWalked < maxPages) {
    const response = await fetchPage(page, perPage);
    for (const item of response.data) {
      yield { item, page, index };
      index += 1;
    }
    pagesWalked += 1;

    const lastPage = response.meta?.last_page ?? page;
    if (page >= lastPage) return;
    if (!response.links?.next) return;
    page += 1;
  }
}

export interface Cursor {
  page: number;
  totalSeen: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
  } catch {
    return { page: 1, totalSeen: 0 };
  }
}
