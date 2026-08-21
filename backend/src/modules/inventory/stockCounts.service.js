import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { getLocationQuantity, resolveOperationalLocation, setLocationInventory } from "../stores/location-context.service.js";
import { createAuditLog } from "../audit/audit.service.js";

const includeDetail = { location: true, lines: { orderBy: { productName: "asc" } } };

async function writeRequiredStockCountAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Stock count action was not saved because its audit record could not be stored",
      503,
      "STOCK_COUNT_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function auditActor(actor) {
  return {
    userId: actor.userId ?? null,
    deviceId: actor.deviceId ?? undefined,
    req: actor.req ?? null,
  };
}

function shape(session) {
  const lines = session.lines ?? [];
  const hideExpected = session.blindCount && session.status === "counting";
  const countedLines = lines.filter((line) => line.countedBaseQty !== null).length;
  const varianceLines = lines.filter((line) => Number(line.varianceBaseQty || 0) !== 0).length;
  return {
    ...session,
    lines: lines.map((line) => hideExpected ? { ...line, expectedBaseQty: null, varianceBaseQty: null } : line),
    summary: {
      totalLines: lines.length,
      countedLines,
      remainingLines: lines.length - countedLines,
      varianceLines,
      netVarianceBaseQty: hideExpected ? null : round2(lines.reduce((sum, line) => sum + Number(line.varianceBaseQty || 0), 0)),
    },
  };
}

export async function listStockCounts(shopId, locationId, { status, limit }) {
  const location = await resolveOperationalLocation(shopId, locationId);
  const sessions = await db.stockCountSession.findMany({
    where: { shopId, locationId: location.id, ...(status !== "all" && { status }) },
    include: includeDetail,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return sessions.map(shape);
}

export async function getStockCount(shopId, locationId, sessionId) {
  const location = await resolveOperationalLocation(shopId, locationId);
  const session = await db.stockCountSession.findFirst({ where: { id: sessionId, shopId, locationId: location.id }, include: includeDetail });
  if (!session) throw new AppError("Stock count not found", 404, "STOCK_COUNT_NOT_FOUND");
  return shape(session);
}

export async function createStockCount(shopId, locationId, data, actor = {}) {
  const location = await resolveOperationalLocation(shopId, locationId);
  try {
    return shape(await db.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { shopId, deletedAt: null, ...(data.productIds?.length ? { id: { in: [...new Set(data.productIds)] } } : {}) },
        orderBy: { name: "asc" },
      });
      if (!products.length) throw new AppError("No active products were selected", 422, "STOCK_COUNT_EMPTY");
      if (data.productIds?.length && products.length !== new Set(data.productIds).size) throw new AppError("One or more selected products are unavailable", 422, "STOCK_COUNT_PRODUCT_INVALID");
      /**
       * A per-packaging product cannot be counted as one total, so it must not
       * enter the count at all.
       *
       * A count line carries a single `countedBaseQty`, and applying it calls
       * setLocationInventory — which refuses a per_pack product outright, because
       * "34,500 g" says nothing about how many 1 kg packets and how many 5 kg bags
       * are on the shelf. Nothing used to stop such a product being selected, so
       * the refusal arrived at APPLY: the shopkeeper had already walked the aisle,
       * typed every quantity and sent it for approval, and then the whole count was
       * rejected atomically — the honest pooled products in the same count lost
       * their figures too. Worse, the session stayed open and the branch's unique
       * active-count key blocked every future count until somebody found it and
       * cancelled it, throwing the counting away.
       *
       * Leaving them out keeps the count usable for everything else and reports
       * what was skipped, so the shop knows to recount those per pack instead. An
       * explicit selection of ONLY per-pack products is an error rather than an
       * empty count, because silently counting nothing is not what was asked for.
       */
      const countable = products.filter((product) => product.packagingMode !== "per_pack");
      const excluded = products.filter((product) => product.packagingMode === "per_pack");
      if (!countable.length) {
        throw new AppError(
          `${excluded.length === 1 ? `"${excluded[0].name}" is` : `All ${excluded.length} selected products are`} counted per pack size, so ${excluded.length === 1 ? "it" : "they"} cannot be counted as one total. Recount each pack size on the product instead.`,
          422,
          "STOCK_COUNT_PER_PACK_ONLY",
        );
      }
      const snapshots = await Promise.all(countable.map(async (product) => ({
        productId: product.id,
        productName: product.name,
        baseUnit: product.baseUnit,
        expectedBaseQty: await getLocationQuantity(tx, shopId, location, product),
      })));
      const created = await tx.stockCountSession.create({
        data: {
          shopId,
          locationId: location.id,
          activeKey: location.id,
          name: data.name,
          blindCount: data.blindCount,
          createdByUserId: actor.userId ?? null,
          lines: { create: snapshots },
        },
        include: includeDetail,
      });
      await writeRequiredStockCountAudit({
        shopId,
        ...auditActor(actor),
        action: "STOCK_COUNT_STARTED",
        entityType: "StockCountSession",
        entityId: created.id,
        after: { status: created.status, name: created.name, blindCount: created.blindCount },
        metadata: {
          locationId: location.id,
          totalLines: created.lines.length,
          excludedPerPackProductIds: excluded.map((product) => product.id),
        },
      }, tx);
      // Carried on the create response only: it describes this selection, not the
      // stored session, and the shop needs it while it still has time to plan the
      // per-pack recount — not on every later read of the count.
      return { ...created, excludedPerPackProducts: excluded.map(({ id, name }) => ({ id, name })) };
    }));
  } catch (error) {
    if (error?.code === "P2002") throw new AppError("Finish or cancel the active stock count for this branch first", 409, "STOCK_COUNT_ALREADY_ACTIVE");
    throw error;
  }
}

export async function updateStockCountLines(shopId, locationId, sessionId, data, actor = {}) {
  const location = await resolveOperationalLocation(shopId, locationId);
  const uniqueLines = new Map(data.lines.map((line) => [line.productId, line]));
  return shape(await db.$transaction(async (tx) => {
    const session = await tx.stockCountSession.findFirst({ where: { id: sessionId, shopId, locationId: location.id }, include: { lines: true } });
    if (!session) throw new AppError("Stock count not found", 404, "STOCK_COUNT_NOT_FOUND");
    if (session.status !== "counting") throw new AppError("Only an active count can be edited", 409, "STOCK_COUNT_NOT_EDITABLE");
    const existing = new Map(session.lines.map((line) => [line.productId, line]));
    for (const [productId, input] of uniqueLines) {
      const line = existing.get(productId);
      if (!line) throw new AppError("A submitted product is not part of this count", 422, "STOCK_COUNT_LINE_INVALID");
      const counted = round2(input.countedBaseQty);
      await tx.stockCountLine.update({
        where: { id: line.id },
        data: {
          countedBaseQty: counted,
          varianceBaseQty: round2(counted - line.expectedBaseQty),
          reason: input.reason ?? null,
          countedByUserId: actor.userId ?? null,
          countedAt: new Date(),
        },
      });
    }
    const updated = await tx.stockCountSession.findUnique({ where: { id: sessionId }, include: includeDetail });
    await writeRequiredStockCountAudit({
      shopId,
      ...auditActor(actor),
      action: "STOCK_COUNT_LINES_UPDATED",
      entityType: "StockCountSession",
      entityId: sessionId,
      metadata: { locationId: location.id, productIds: [...uniqueLines.keys()], updatedLines: uniqueLines.size },
    }, tx);
    return updated;
  }));
}

export async function submitStockCount(shopId, locationId, sessionId, actor = {}) {
  const location = await resolveOperationalLocation(shopId, locationId);
  return shape(await db.$transaction(async (tx) => {
    const session = await tx.stockCountSession.findFirst({ where: { id: sessionId, shopId, locationId: location.id }, include: { lines: true } });
    if (!session) throw new AppError("Stock count not found", 404, "STOCK_COUNT_NOT_FOUND");
    if (session.status !== "counting") throw new AppError("Stock count is not active", 409, "STOCK_COUNT_NOT_ACTIVE");
    const remaining = session.lines.filter((line) => line.countedBaseQty === null).length;
    if (remaining) throw new AppError(`${remaining} products still need a count`, 422, "STOCK_COUNT_INCOMPLETE");
    await tx.stockCountSession.update({ where: { id: sessionId }, data: { status: "review", submittedAt: new Date() } });
    const updated = await tx.stockCountSession.findUnique({ where: { id: sessionId }, include: includeDetail });
    const summary = shape(updated).summary;
    await writeRequiredStockCountAudit({
      shopId,
      ...auditActor(actor),
      action: "STOCK_COUNT_SUBMITTED",
      entityType: "StockCountSession",
      entityId: sessionId,
      before: { status: "counting" },
      after: { status: "review" },
      metadata: { ...summary, locationId: location.id },
    }, tx);
    return updated;
  }));
}

export async function applyStockCount(shopId, locationId, sessionId, actor = {}) {
  const location = await resolveOperationalLocation(shopId, locationId);
  return shape(await db.$transaction(async (tx) => {
    const session = await tx.stockCountSession.findFirst({ where: { id: sessionId, shopId, locationId: location.id }, include: { lines: true } });
    if (!session) throw new AppError("Stock count not found", 404, "STOCK_COUNT_NOT_FOUND");
    if (session.status !== "review") throw new AppError("Submit the count for review before applying it", 409, "STOCK_COUNT_NOT_REVIEWED");
    const productIds = session.lines.map((line) => line.productId);
    const movements = await tx.stockLedger.count({ where: { shopId, locationId: location.id, productId: { in: productIds }, createdAt: { gt: session.createdAt } } });
    if (movements > 0) throw new AppError("Stock moved after this count started. Cancel it and start a fresh count to avoid erasing real sales or receipts.", 409, "STOCK_COUNT_STALE");
    const claimed = await tx.stockCountSession.updateMany({ where: { id: sessionId, shopId, status: "review" }, data: { status: "applied", activeKey: null, appliedAt: new Date(), approvedByUserId: actor.userId ?? null } });
    if (claimed.count !== 1) throw new AppError("Stock count was already processed", 409, "STOCK_COUNT_ALREADY_PROCESSED");
    // A session holds one line per product (@@unique([sessionId, productId])), so
    // no line moves stock a later line still has to read. That makes the whole set
    // safe to read up front rather than a query per line — a full-shop count is
    // hundreds of lines, and this runs inside the transaction.
    const products = await tx.product.findMany({ where: { shopId, id: { in: productIds }, deletedAt: null } });
    const productById = new Map(products.map((product) => [product.id, product]));
    let movementCount = 0;
    for (const line of session.lines) {
      const product = productById.get(line.productId);
      if (!product) throw new AppError(`Product ${line.productName} is no longer available`, 409, "STOCK_COUNT_PRODUCT_UNAVAILABLE");
      const result = await setLocationInventory(tx, { shopId, location, product, newStockBaseQty: line.countedBaseQty });
      if (result.difference !== 0) {
        await tx.stockLedger.create({ data: {
          shopId,
          locationId: location.id,
          productId: product.id,
          productName: product.name,
          action: "stock_count",
          changeBaseQty: result.difference,
          oldStockBaseQty: result.oldStock,
          newStockBaseQty: result.newStock,
          sourceType: "stock_count",
          sourceId: session.id,
          note: line.reason || actor.note || `Applied stock count ${session.name}`,
        } });
        movementCount += 1;
      }
    }
    const updated = await tx.stockCountSession.findUnique({ where: { id: sessionId }, include: includeDetail });
    const summary = shape(updated).summary;
    await writeRequiredStockCountAudit({
      shopId,
      ...auditActor(actor),
      action: "STOCK_COUNT_APPLIED",
      entityType: "StockCountSession",
      entityId: sessionId,
      before: { status: "review" },
      after: { status: "applied" },
      metadata: { ...summary, locationId: location.id, movementCount, note: actor.note ?? null },
    }, tx);
    return updated;
  }));
}

export async function cancelStockCount(shopId, locationId, sessionId, actor = {}) {
  const location = await resolveOperationalLocation(shopId, locationId);
  return shape(await db.$transaction(async (tx) => {
    const session = await tx.stockCountSession.findFirst({
      where: { id: sessionId, shopId, locationId: location.id },
      include: includeDetail,
    });
    if (!session || !["counting", "review"].includes(session.status)) {
      throw new AppError("Stock count is already processed or unavailable", 409, "STOCK_COUNT_ALREADY_PROCESSED");
    }
    const changed = await tx.stockCountSession.updateMany({
      where: { id: sessionId, shopId, locationId: location.id, status: session.status },
      data: { status: "cancelled", activeKey: null, cancelledAt: new Date() },
    });
    if (changed.count !== 1) throw new AppError("Stock count is already processed or unavailable", 409, "STOCK_COUNT_ALREADY_PROCESSED");
    const updated = await tx.stockCountSession.findUnique({ where: { id: sessionId }, include: includeDetail });
    await writeRequiredStockCountAudit({
      shopId,
      ...auditActor(actor),
      action: "STOCK_COUNT_CANCELLED",
      entityType: "StockCountSession",
      entityId: sessionId,
      before: { status: session.status },
      after: { status: "cancelled" },
      metadata: { note: actor.note ?? null, locationId: location.id },
    }, tx);
    return updated;
  }));
}
