import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type {
  BookList,
  BookListInput,
  BookListOptions,
  BookListShortfall,
  BookListSummary,
} from "@/types/api";

/**
 * Book lists are online-first for writing and cached for reading.
 *
 * The counter moment is a parent saying "Class 6, DPS" — that has to answer even
 * on a dropped connection, so the lists are cached. Readiness in the cache is as
 * fresh as the last successful load, which the page says plainly rather than
 * presenting stale shelf counts as current.
 */

const LISTS_CACHE_KEY = "book-lists:server-cache:v1";

function isOfflineish(error: unknown) {
  // An auth or permission failure must never be hidden behind stale data.
  return !(error instanceof ApiClientError) || error.status <= 0 || error.status >= 500 || [408, 429].includes(error.status);
}

export interface BookListFilters {
  schoolName?: string;
  className?: string;
  academicYear?: string;
  search?: string;
  includeInactive?: boolean;
}

export async function listBookLists(filters: BookListFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  try {
    const lists = await apiRequest<BookList[]>(`/book-lists${qs ? `?${qs}` : ""}`, { background: true });
    if (!qs) await offlineDB.setSetting(LISTS_CACHE_KEY, lists).catch(() => undefined);
    return lists;
  } catch (error) {
    if (!isOfflineish(error)) throw error;
    const cached = await offlineDB.getSetting<BookList[]>(LISTS_CACHE_KEY).catch(() => undefined);
    if (!cached) throw error;
    const term = (filters.search ?? "").trim().toLowerCase();
    return cached.filter((list) => (!term
      || list.label.toLowerCase().includes(term)
      || list.items.some((item) => item.name.toLowerCase().includes(term))));
  }
}

export function getBookList(id: string) {
  return apiRequest<BookList>(`/book-lists/${id}`, { background: true });
}

export function getBookListOptions() {
  return apiRequest<BookListOptions>("/book-lists/options", { background: true });
}

export function getBookListSummary() {
  return apiRequest<BookListSummary>("/book-lists/summary", { background: true });
}

/** What to order across every list — the reorder sheet for the weeks before term. */
export function getBookListShortfall(academicYear?: string) {
  const qs = academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : "";
  return apiRequest<BookListShortfall[]>(`/book-lists/shortfall${qs}`, { background: true });
}

export function createBookList(data: BookListInput) {
  return apiRequest<BookList>("/book-lists", { method: "POST", body: JSON.stringify(data) });
}

export function updateBookList(id: string, data: Partial<BookListInput>) {
  return apiRequest<BookList>(`/book-lists/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

/** Next year's list, from this year's. */
export function copyBookList(id: string, data: { academicYear?: string; className?: string; schoolName?: string; name?: string | null }) {
  return apiRequest<BookList>(`/book-lists/${id}/copy`, { method: "POST", body: JSON.stringify(data) });
}

export function deleteBookList(id: string) {
  return apiRequest<BookList>(`/book-lists/${id}`, { method: "DELETE" });
}
