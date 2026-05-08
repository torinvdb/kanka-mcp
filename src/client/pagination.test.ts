import { describe, it, expect, vi } from "vitest";

import { decodeCursor, encodeCursor, paginateAll } from "./pagination.js";
import type { KankaListResponse } from "../types.js";

describe("cursor encoding", () => {
  it("round-trips a cursor through base64url", () => {
    const c = { page: 7, totalSeen: 105 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("decodes garbage to a sane default", () => {
    expect(decodeCursor("not-base64!@#")).toEqual({ page: 1, totalSeen: 0 });
  });
});

describe("paginateAll", () => {
  function pageOf(items: number[], page: number, lastPage: number): KankaListResponse<number> {
    return {
      data: items,
      meta: {
        current_page: page,
        from: items[0] ?? null,
        last_page: lastPage,
        path: "/test",
        per_page: items.length,
        to: items[items.length - 1] ?? null,
        total: lastPage * items.length,
      },
      links: {
        first: null,
        last: null,
        prev: page > 1 ? "p" : null,
        next: page < lastPage ? "n" : null,
      },
    };
  }

  it("walks all pages and yields each item with its page number", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) return pageOf([1, 2, 3], 1, 3);
      if (page === 2) return pageOf([4, 5, 6], 2, 3);
      return pageOf([7, 8, 9], 3, 3);
    });

    const out: { item: number; page: number }[] = [];
    for await (const yielded of paginateAll(fetchPage, { perPage: 3 })) {
      out.push({ item: yielded.item, page: yielded.page });
    }

    expect(out.map((o) => o.item)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops at maxPages even if more pages remain", async () => {
    const fetchPage = vi.fn(async (page: number) => pageOf([page * 10], page, 99));
    const out: number[] = [];
    for await (const yielded of paginateAll(fetchPage, { maxPages: 3 })) {
      out.push(yielded.item);
    }
    expect(out).toEqual([10, 20, 30]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops when next link is missing", async () => {
    const fetchPage = vi.fn(async () => ({
      data: [1, 2],
      links: { first: null, last: null, prev: null, next: null },
      meta: undefined,
    }));
    const out: number[] = [];
    for await (const yielded of paginateAll(fetchPage)) {
      out.push(yielded.item);
    }
    expect(out).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
