type ReadableMock = { getAll: (table: string) => Promise<unknown[]> };
type Row = Record<string, unknown>;

// getMany reads by primary key, which is not `id` for every table (lib/offline/db.ts).
const PRIMARY_KEY: Record<string, string> = { id_mappings: "local_id", settings: "key", sync_outbox: "clientEventId" };

/**
 * Give a hand-written `offlineDB` mock the by-id and by-index reads the real
 * facade has (`getMany`, `getWhere`), answered from the mock's own `getAll`.
 *
 * Delegating at call time keeps each test's intent: a `getAll` rejection still
 * reaches the code under test, and "getAll was not called" still means nothing
 * was read. Plain functions, not vi.fn, so resetAllMocks cannot blank them.
 */
export function withTargetedReads<T extends object>(db: T): T {
  const mock = db as unknown as ReadableMock & Record<string, unknown>;
  const rows = async (table: string) => ((await mock.getAll(table)) ?? []) as Row[];
  const keySet = (values: Iterable<string | null | undefined>) =>
    new Set([...values].filter((value): value is string => typeof value === "string" && value.length > 0));
  mock.getMany = async (table: string, ids: Iterable<string | null | undefined>) => {
    const keys = keySet(ids);
    const key = PRIMARY_KEY[table] ?? "id";
    return keys.size ? (await rows(table)).filter((row) => keys.has(row[key] as string)) : [];
  };
  mock.getWhere = async (table: string, field: string, values: Iterable<string | null | undefined>) => {
    const keys = keySet(values);
    return keys.size ? (await rows(table)).filter((row) => keys.has(row[field] as string)) : [];
  };
  return db;
}
