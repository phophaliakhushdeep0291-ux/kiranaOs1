// Share only overlapping catalogue queries at the same database visibility.
// SQLite serializes writers, so its shop ChangeLog head is sufficient. PostgreSQL
// sequences are NOT commit-ordered: an older sequence can commit after a newer
// one. Its transaction snapshot includes those pending transactions instead.
// Location inventory is deliberately applied separately by the caller.
export function createCatalogueReader(client, { engine, maxPending = 128, project = value => value, copy = structuredClone } = {}) {
  const pending = new Map();
  return async function readCatalogue(where) {
    const query = () => client.product.findMany({
      where, orderBy: { name: "asc" },
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
    });
    if (engine !== "sqlite" && engine !== "postgres") return copy(await project(await query()));
    let revision;
    if (engine === "postgres") {
      const [snapshot] = await client.$queryRaw`SELECT pg_current_snapshot()::text AS revision`;
      if (!snapshot?.revision) throw new Error("Catalogue visibility snapshot unavailable");
      revision = snapshot.revision;
    } else {
      const head = await client.changeLog.findFirst({
        where: { shopId: where.shopId }, orderBy: { seq: "desc" }, select: { seq: true },
      });
      revision = String(head?.seq ?? 0);
    }
    const key = JSON.stringify([where, revision]);
    let read = pending.get(key);
    if (!read) {
      read = query();
      // Resolve Prisma's lazy query once; sharing a PrismaPromise itself still
      // executes it once for each awaiting caller.
      read = Promise.resolve(read).then(project);
      if (pending.size < maxPending) {
        pending.set(key, read);
        const cleanup = () => { if (pending.get(key) === read) pending.delete(key); };
        void read.then(cleanup, cleanup);
      }
    }
    // Consumers cannot mutate another request's product or nested pack rows.
    return copy(await read);
  };
}
