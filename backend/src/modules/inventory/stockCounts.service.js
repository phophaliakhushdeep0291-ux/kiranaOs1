import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { getLocationQuantity, resolveOperationalLocation, setLocationInventory } from "../stores/location-context.service.js";

const includeDetail = { location: true, lines: { orderBy: { productName: "asc" } } };

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
      const snapshots = await Promise.all(products.map(async (product) => ({
        productId: product.id,
        productName: product.name,
        baseUnit: product.baseUnit,
        expectedBaseQty: await getLocationQuantity(tx, shopId, location, product),
      })));
      return tx.stockCountSession.create({
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
    return tx.stockCountSession.findUnique({ where: { id: sessionId }, include: includeDetail });
  }));
}

export async function submitStockCount(shopId, locationId, sessionId) {
  const location = await resolveOperationalLocation(shopId, locationId);
  return shape(await db.$transaction(async (tx) => {
    const session = await tx.stockCountSession.findFirst({ where: { id: sessionId, shopId, locationId: location.id }, include: { lines: true } });
    if (!session) throw new AppError("Stock count not found", 404, "STOCK_COUNT_NOT_FOUND");
    if (session.status !== "counting") throw new AppError("Stock count is not active", 409, "STOCK_COUNT_NOT_ACTIVE");
    const remaining = session.lines.filter((line) => line.countedBaseQty === null).length;
    if (remaining) throw new AppError(`${remaining} products still need a count`, 422, "STOCK_COUNT_INCOMPLETE");
    await tx.stockCountSession.update({ where: { id: sessionId }, data: { status: "review", submittedAt: new Date() } });
    return tx.stockCountSession.findUnique({ where: { id: sessionId }, include: includeDetail });
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
    for (const line of session.lines) {
      const product = productById.get(line.productId);
      if (!product) throw new AppError(`Product ${line.productName} is no longer available`, 409, "STOCK_COUNT_PRODUCT_UNAVAILABLE");
      const result = await setLocationInventory(tx, { shopId, location, product, newStockBaseQty: line.countedBaseQty });
      if (result.difference !== 0) await tx.stockLedger.create({ data: {
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
    }
    return tx.stockCountSession.findUnique({ where: { id: sessionId }, include: includeDetail });
  }));
}

export async function cancelStockCount(shopId, locationId, sessionId, actor = {}) {
  const location = await resolveOperationalLocation(shopId, locationId);
  const changed = await db.stockCountSession.updateMany({
    where: { id: sessionId, shopId, locationId: location.id, status: { in: ["counting", "review"] } },
    data: { status: "cancelled", activeKey: null, cancelledAt: new Date() },
  });
  if (changed.count !== 1) throw new AppError("Stock count is already processed or unavailable", 409, "STOCK_COUNT_ALREADY_PROCESSED");
  return getStockCount(shopId, location.id, sessionId);
}
