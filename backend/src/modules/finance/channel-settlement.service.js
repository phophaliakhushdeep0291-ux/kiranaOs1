import crypto from "node:crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";

async function writeRequiredChannelSettlementAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Channel settlement action was not saved because its audit record could not be stored",
      503,
      "CHANNEL_SETTLEMENT_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function normalizeActor(actor = {}) {
  return {
    userId: actor.userId ?? null,
    deviceId: actor.deviceId ?? undefined,
    req: actor.req ?? null,
  };
}

export const CHANNEL_SETTLEMENT_VERSION = "channel-settlement-v1";
export const CHANNEL_SETTLEMENT_LIMITATIONS = [
  "CSV columns are mapped by the owner; KiranaOS does not guess proprietary Swiggy, Zomato, ONDC or marketplace formats.",
  "Order candidates are suggestions only. Importing a payout never posts a payment, changes an order or alters a bill automatically.",
  "Commission and deduction amounts are reconciled arithmetically; contract-rate validation requires an explicit provider contract configuration.",
  "A bank statement line can be linked as evidence, but this workflow does not allocate or mutate the accounting ledger.",
];

const MAX_ROWS = 5_000;
const MAX_PAISE = 1_000_000_000_000n;
const CANONICAL_FIELDS = [
  "externalOrderId", "orderDate", "orderStatus", "gross", "merchantDiscount",
  "platformCommission", "paymentFee", "taxOnFees", "tcs", "tds", "adjustment",
  "refund", "expectedNet", "paidNet",
];
const REQUIRED_FIELDS = ["externalOrderId", "orderDate", "gross", "paidNet"];

function fail(message, status = 422, code = "CHANNEL_SETTLEMENT_INVALID", publicData) {
  const error = new AppError(message, status, code);
  if (publicData) error.publicData = publicData;
  throw error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsvMatrix(csvText) {
  const text = String(csvText ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
    } else if (char === '"') {
      if (field.length) fail("Malformed CSV: quote starts inside an unquoted value");
      quoted = true;
    } else if (char === ",") {
      row.push(field); field = "";
    } else if (char === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (char !== "\r") field += char;
  }
  if (quoted) fail("Malformed CSV: unclosed quoted value");
  row.push(field); rows.push(row);
  return rows.filter((values) => values.some((value) => String(value).trim()));
}

function parseDate(raw) {
  const value = String(raw ?? "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let year; let month; let day;
  if (match) [, year, month, day] = match;
  else {
    match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
    if (!match) throw new Error("Use YYYY-MM-DD or DD/MM/YYYY");
    [, day, month, year] = match;
  }
  const result = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (result.getUTCFullYear() !== Number(year) || result.getUTCMonth() !== Number(month) - 1 || result.getUTCDate() !== Number(day)) {
    throw new Error("Date is not valid");
  }
  return result;
}

function parsePaise(raw, { allowBlank = true, signed = false } = {}) {
  const original = String(raw ?? "").trim();
  if (!original) {
    if (allowBlank) return 0n;
    throw new Error("Amount is required");
  }
  let value = original.replace(/\u20b9/g, "").replace(/\b(?:inr|rs\.?)\b/gi, "").replace(/\s+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1, -1); }
  if (value.startsWith("+")) value = value.slice(1);
  else if (value.startsWith("-")) { negative = !negative; value = value.slice(1); }
  const decimal = /^(\d[\d,]*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!decimal) throw new Error("Amount must have at most two decimal places");
  const grouped = decimal[1];
  if (grouped.includes(",") && !/^\d{1,3}(?:,\d{3})+$/.test(grouped) && !/^\d{1,2}(?:,\d{2})*,\d{3}$/.test(grouped)) {
    throw new Error("Amount contains invalid comma grouping");
  }
  let paise = BigInt(grouped.replace(/,/g, "")) * 100n + BigInt((decimal[2] ?? "").padEnd(2, "0"));
  if (negative) paise = -paise;
  if (!signed && paise < 0n) throw new Error("Amount cannot be negative");
  if (paise > MAX_PAISE || paise < -MAX_PAISE) throw new Error("Amount is too large");
  return paise;
}

function cell(row, index) { return index >= 0 ? String(row[index] ?? "").trim() : ""; }
function money(value) {
  if (value === null || value === undefined) return null;
  const paise = Number(value);
  return { paise, amount: paise / 100 };
}
function parseJsonArray(value) {
  try { const result = JSON.parse(value || "[]"); return Array.isArray(result) ? result : []; }
  catch { return []; }
}

function canonicalStatus(value) {
  const status = normalizeHeader(value);
  if (["delivered", "fulfilled", "complete", "completed", "success"].includes(status)) return "fulfilled";
  if (["cancelled", "canceled", "rejected", "failed"].includes(status)) return "cancelled";
  return null;
}

function orderOutcome(order) {
  if (order.status === "fulfilled" || order.fulfillmentStatus === "fulfilled") return "fulfilled";
  if (["cancelled", "rejected"].includes(order.status) || order.fulfillmentStatus === "cancelled") return "cancelled";
  return "open";
}

function mappedIndexes(headers, mapping) {
  const normalized = headers.map(normalizeHeader);
  const duplicates = normalized.filter((header, index) => header && normalized.indexOf(header) !== index);
  if (duplicates.length) fail("CSV contains duplicate normalized header names", 422, "CHANNEL_SETTLEMENT_AMBIGUOUS_HEADERS", { headers: duplicates });
  const indexes = {};
  for (const field of CANONICAL_FIELDS) {
    const configured = mapping[field];
    indexes[field] = configured ? normalized.indexOf(normalizeHeader(configured)) : -1;
    if (configured && indexes[field] < 0) fail(`Mapped column not found: ${configured}`, 422, "CHANNEL_SETTLEMENT_MAPPING_INVALID", { field, column: configured });
  }
  const missing = REQUIRED_FIELDS.filter((field) => indexes[field] < 0);
  if (missing.length) fail(`Required mappings missing: ${missing.join(", ")}`, 422, "CHANNEL_SETTLEMENT_MAPPING_INVALID", { requiredFields: REQUIRED_FIELDS });
  return indexes;
}

export function parseChannelSettlementCsv(csvText, mapping) {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) fail("Settlement file must contain a header and at least one row");
  if (matrix.length - 1 > MAX_ROWS) fail(`Settlement file exceeds the ${MAX_ROWS}-row limit`, 422, "CHANNEL_SETTLEMENT_TOO_MANY_ROWS");
  const indexes = mappedIndexes(matrix[0], mapping);
  const rows = [];
  const rowErrors = [];

  for (let sourceIndex = 1; sourceIndex < matrix.length; sourceIndex += 1) {
    const source = matrix[sourceIndex];
    try {
      const externalOrderId = cell(source, indexes.externalOrderId);
      if (!externalOrderId) throw new Error("External order ID is required");
      const orderDate = parseDate(cell(source, indexes.orderDate));
      const grossPaise = parsePaise(cell(source, indexes.gross), { allowBlank: false });
      const merchantDiscountPaise = parsePaise(cell(source, indexes.merchantDiscount));
      const platformCommissionPaise = parsePaise(cell(source, indexes.platformCommission));
      const paymentFeePaise = parsePaise(cell(source, indexes.paymentFee));
      const taxOnFeesPaise = parsePaise(cell(source, indexes.taxOnFees));
      const tcsPaise = parsePaise(cell(source, indexes.tcs));
      const tdsPaise = parsePaise(cell(source, indexes.tds));
      const adjustmentPaise = parsePaise(cell(source, indexes.adjustment), { signed: true });
      const refundPaise = parsePaise(cell(source, indexes.refund));
      const paidNetPaise = parsePaise(cell(source, indexes.paidNet), { allowBlank: false });
      const providerExpectedNetPaise = indexes.expectedNet >= 0 && cell(source, indexes.expectedNet)
        ? parsePaise(cell(source, indexes.expectedNet), { allowBlank: false, signed: true }) : null;
      const calculatedExpectedNetPaise = grossPaise - merchantDiscountPaise - platformCommissionPaise
        - paymentFeePaise - taxOnFeesPaise - tcsPaise - tdsPaise + adjustmentPaise - refundPaise;
      const variancePaise = paidNetPaise - calculatedExpectedNetPaise;
      rows.push({
        rowNumber: sourceIndex + 1,
        externalOrderId,
        orderDate,
        channelStatus: cell(source, indexes.orderStatus) || null,
        grossPaise,
        merchantDiscountPaise,
        platformCommissionPaise,
        paymentFeePaise,
        taxOnFeesPaise,
        tcsPaise,
        tdsPaise,
        adjustmentPaise,
        refundPaise,
        providerExpectedNetPaise,
        calculatedExpectedNetPaise,
        paidNetPaise,
        variancePaise,
        rowFingerprint: sha256(source.map((value) => String(value).trim()).join("|")),
      });
    } catch (error) { rowErrors.push({ rowNumber: sourceIndex + 1, message: error.message }); }
  }
  if (rowErrors.length) fail("Settlement rows failed validation", 422, "CHANNEL_SETTLEMENT_ROW_INVALID", { rowErrors: rowErrors.slice(0, 100), errorCount: rowErrors.length });
  return { headers: matrix[0].map((header) => String(header).trim()), rows };
}

function shapeImport(row, extra = {}) {
  return {
    ...row,
    gross: money(row.grossPaise),
    calculatedNet: money(row.calculatedNetPaise),
    paidNet: money(row.paidNetPaise),
    variance: money(row.variancePaise),
    grossPaise: undefined,
    calculatedNetPaise: undefined,
    paidNetPaise: undefined,
    variancePaise: undefined,
    mapping: JSON.parse(row.mappingJson || "{}"),
    mappingJson: undefined,
    ...extra,
  };
}

function shapeEvent(event) {
  return { ...event, previous: JSON.parse(event.previousJson || "{}"), next: JSON.parse(event.nextJson || "{}"), previousJson: undefined, nextJson: undefined };
}

function shapeRow(row) {
  const amountFields = ["gross", "merchantDiscount", "platformCommission", "paymentFee", "taxOnFees", "tcs", "tds", "adjustment", "refund", "providerExpectedNet", "calculatedExpectedNet", "paidNet", "variance"];
  const result = { ...row, mismatches: parseJsonArray(row.mismatchTypesJson), mismatchTypesJson: undefined };
  for (const field of amountFields) {
    const raw = `${field}Paise`;
    result[field] = money(row[raw]);
    result[raw] = undefined;
  }
  if (row.events) result.events = row.events.map(shapeEvent);
  if (row.import) result.import = shapeImport(row.import);
  return result;
}

export async function importChannelSettlement(shopId, input, actor = {}) {
  actor = normalizeActor(actor);
  const provider = input.provider.trim();
  if (input.locationId) {
    const location = await db.storeLocation.findFirst({ where: { id: input.locationId, shopId, active: true }, select: { id: true } });
    if (!location) fail("Store location not found", 404, "CHANNEL_SETTLEMENT_LOCATION_NOT_FOUND");
  }
  const fileHash = sha256([provider.toLowerCase(), input.locationId ?? "all", String(input.csvText).replace(/\r\n/g, "\n")].join("|"));
  const existing = await db.channelSettlementImport.findUnique({
    where: { shopId_provider_fileHash: { shopId, provider, fileHash } }, include: { location: true },
  });
  if (existing) return shapeImport(existing, { idempotentReplay: true });

  const parsed = parseChannelSettlementCsv(input.csvText, input.mapping);
  const externalOrderIds = [...new Set(parsed.rows.map((row) => row.externalOrderId))];
  const [orders, priorRows] = await Promise.all([
    db.customerOrder.findMany({
      where: { shopId, externalOrderId: { in: externalOrderIds }, ...(input.locationId ? { locationId: input.locationId } : {}) },
      select: { id: true, billId: true, locationId: true, externalOrderId: true, status: true, fulfillmentStatus: true, estimatedTotal: true },
    }),
    db.channelSettlementRow.findMany({
      where: { shopId, provider, externalOrderId: { in: externalOrderIds } }, select: { externalOrderId: true },
    }),
  ]);
  const ordersByExternalId = new Map();
  for (const order of orders) ordersByExternalId.set(order.externalOrderId, [...(ordersByExternalId.get(order.externalOrderId) ?? []), order]);
  const priorOrderIds = new Set(priorRows.map((row) => row.externalOrderId));
  const currentCounts = new Map();
  for (const row of parsed.rows) currentCounts.set(row.externalOrderId, (currentCounts.get(row.externalOrderId) ?? 0) + 1);

  const preparedRows = parsed.rows.map((row) => {
    const candidates = ordersByExternalId.get(row.externalOrderId) ?? [];
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const mismatches = [];
    if (candidates.length === 0) mismatches.push("missing_order");
    if (candidates.length > 1) mismatches.push("ambiguous_order");
    if (priorOrderIds.has(row.externalOrderId) || currentCounts.get(row.externalOrderId) > 1) mismatches.push("duplicate_settlement");
    if (row.variancePaise !== 0n) mismatches.push("net_mismatch");
    if (row.providerExpectedNetPaise !== null && row.providerExpectedNetPaise !== row.calculatedExpectedNetPaise) mismatches.push("expected_net_formula_mismatch");
    if (row.paidNetPaise === 0n && row.calculatedExpectedNetPaise > 0n) mismatches.push("unpaid_order");
    if (candidate) {
      const expectedGross = BigInt(Math.round(Number(candidate.estimatedTotal || 0) * 100));
      if (expectedGross !== row.grossPaise) mismatches.push("gross_mismatch");
      const channelOutcome = canonicalStatus(row.channelStatus);
      if (channelOutcome && channelOutcome !== orderOutcome(candidate)) mismatches.push("status_mismatch");
    }
    return {
      ...row,
      shopId,
      locationId: input.locationId ?? candidate?.locationId ?? null,
      provider,
      mismatchTypesJson: JSON.stringify([...new Set(mismatches)]),
      matchStatus: candidates.length === 0 ? "missing" : candidates.length > 1 ? "ambiguous" : "suggested",
      candidateCustomerOrderId: candidate?.id ?? null,
      candidateBillId: candidate?.billId ?? null,
    };
  });

  const total = (key) => preparedRows.reduce((sum, row) => sum + row[key], 0n);
  const periodTimes = preparedRows.map((row) => row.orderDate.getTime());
  try {
    const created = await db.$transaction(async (tx) => {
      const record = await tx.channelSettlementImport.create({
        data: {
          shopId,
          locationId: input.locationId ?? null,
          provider,
          fileName: input.fileName,
          fileHash,
          mappingJson: JSON.stringify(input.mapping),
          periodFrom: new Date(Math.min(...periodTimes)),
          periodTo: new Date(Math.max(...periodTimes)),
          rowCount: preparedRows.length,
          grossPaise: total("grossPaise"),
          calculatedNetPaise: total("calculatedExpectedNetPaise"),
          paidNetPaise: total("paidNetPaise"),
          variancePaise: total("variancePaise"),
          importedByUserId: actor.userId ?? null,
        },
      });
      await tx.channelSettlementRow.createMany({ data: preparedRows.map((row) => ({ ...row, importId: record.id })) });
      await writeRequiredChannelSettlementAudit({
        shopId,
        userId: actor.userId,
        deviceId: actor.deviceId,
        req: actor.req,
        action: "CHANNEL_SETTLEMENT_IMPORTED",
        entityType: "channel_settlement_import",
        entityId: record.id,
        after: {
          provider: record.provider,
          locationId: record.locationId,
          fileName: record.fileName,
          rowCount: record.rowCount,
          gross: money(record.grossPaise),
          paidNet: money(record.paidNetPaise),
          variance: money(record.variancePaise),
        },
      }, tx);
      return tx.channelSettlementImport.findUnique({ where: { id: record.id }, include: { location: true } });
    });
    return shapeImport(created, { idempotentReplay: false });
  } catch (error) {
    if (error?.code === "P2002") {
      const replay = await db.channelSettlementImport.findUnique({ where: { shopId_provider_fileHash: { shopId, provider, fileHash } }, include: { location: true } });
      if (replay) return shapeImport(replay, { idempotentReplay: true });
    }
    throw error;
  }
}

export async function listChannelSettlementImports(shopId, query = {}) {
  const rows = await db.channelSettlementImport.findMany({
    where: { shopId, ...(query.provider ? { provider: query.provider } : {}), ...(query.locationId ? { locationId: query.locationId } : {}) },
    include: { location: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Number(query.limit) || 25,
  });
  return rows.map((row) => shapeImport(row));
}

export async function getChannelSettlementReport(shopId, query = {}) {
  const rows = await db.channelSettlementRow.findMany({
    where: {
      shopId,
      ...(query.importId ? { importId: query.importId } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.resolutionStatus && query.resolutionStatus !== "all" ? { resolutionStatus: query.resolutionStatus } : {}),
    },
    include: { import: { include: { location: true } }, events: { orderBy: { createdAt: "desc" }, take: 20 } },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }],
    take: MAX_ROWS,
  });
  const mismatchFiltered = query.mismatchType && query.mismatchType !== "all"
    ? rows.filter((row) => parseJsonArray(row.mismatchTypesJson).includes(query.mismatchType)) : rows;
  const offset = Number(query.offset) || 0;
  const limit = Number(query.limit) || 50;
  const page = mismatchFiltered.slice(offset, offset + limit);
  const rollups = new Map();
  for (const row of mismatchFiltered) {
    const key = `${row.provider}|${row.locationId ?? "all"}`;
    const rollup = rollups.get(key) ?? { provider: row.provider, locationId: row.locationId, locationName: row.import.location?.name ?? "All locations", rowCount: 0, matchedCount: 0, ignoredCount: 0, mismatchCount: 0, grossPaise: 0n, calculatedNetPaise: 0n, paidNetPaise: 0n, variancePaise: 0n };
    rollup.rowCount += 1;
    if (row.resolutionStatus === "matched") rollup.matchedCount += 1;
    if (row.resolutionStatus === "ignored") rollup.ignoredCount += 1;
    if (parseJsonArray(row.mismatchTypesJson).length) rollup.mismatchCount += 1;
    rollup.grossPaise += row.grossPaise;
    rollup.calculatedNetPaise += row.calculatedExpectedNetPaise;
    rollup.paidNetPaise += row.paidNetPaise;
    rollup.variancePaise += row.variancePaise;
    rollups.set(key, rollup);
  }
  const total = (field) => mismatchFiltered.reduce((sum, row) => sum + row[field], 0n);
  return {
    calculationVersion: CHANNEL_SETTLEMENT_VERSION,
    autoPost: false,
    summary: {
      rowCount: mismatchFiltered.length,
      matchedCount: mismatchFiltered.filter((row) => row.resolutionStatus === "matched").length,
      ignoredCount: mismatchFiltered.filter((row) => row.resolutionStatus === "ignored").length,
      openCount: mismatchFiltered.filter((row) => row.resolutionStatus === "open").length,
      mismatchCount: mismatchFiltered.filter((row) => parseJsonArray(row.mismatchTypesJson).length).length,
      gross: money(total("grossPaise")),
      calculatedNet: money(total("calculatedExpectedNetPaise")),
      paidNet: money(total("paidNetPaise")),
      variance: money(total("variancePaise")),
    },
    rollups: [...rollups.values()].map((row) => ({ ...row, gross: money(row.grossPaise), calculatedNet: money(row.calculatedNetPaise), paidNet: money(row.paidNetPaise), variance: money(row.variancePaise), grossPaise: undefined, calculatedNetPaise: undefined, paidNetPaise: undefined, variancePaise: undefined })),
    rows: page.map(shapeRow),
    pagination: { offset, limit, total: mismatchFiltered.length, hasMore: offset + limit < mismatchFiltered.length },
    limitations: CHANNEL_SETTLEMENT_LIMITATIONS,
  };
}

function resolutionSnapshot(row) {
  return {
    resolutionStatus: row.resolutionStatus,
    matchStatus: row.matchStatus,
    matchedCustomerOrderId: row.matchedCustomerOrderId,
    matchedBillId: row.matchedBillId,
    bankStatementTransactionId: row.bankStatementTransactionId,
    resolutionNote: row.resolutionNote,
    resolvedByUserId: row.resolvedByUserId,
    resolvedAt: row.resolvedAt?.toISOString?.() ?? row.resolvedAt ?? null,
    mismatches: parseJsonArray(row.mismatchTypesJson),
  };
}

export async function resolveChannelSettlementRow(shopId, rowId, input, actor = {}) {
  actor = normalizeActor(actor);
  return db.$transaction(async (tx) => {
    const row = await tx.channelSettlementRow.findFirst({ where: { id: rowId, shopId } });
    if (!row) fail("Settlement row not found", 404, "CHANNEL_SETTLEMENT_ROW_NOT_FOUND");
    const previous = resolutionSnapshot(row);
    let data;
    if (input.action === "match") {
      const order = await tx.customerOrder.findFirst({ where: { id: input.customerOrderId, shopId } });
      if (!order) fail("Customer order not found", 404, "CHANNEL_SETTLEMENT_ORDER_NOT_FOUND");
      if (row.locationId && order.locationId !== row.locationId) fail("Order belongs to another store location", 409, "CHANNEL_SETTLEMENT_LOCATION_MISMATCH");
      const billId = input.billId ?? order.billId ?? null;
      if (billId) {
        const bill = await tx.bill.findFirst({ where: { id: billId, shopId, ...(row.locationId ? { locationId: row.locationId } : {}) }, select: { id: true } });
        if (!bill) fail("Bill does not belong to this shop and settlement location", 409, "CHANNEL_SETTLEMENT_BILL_MISMATCH");
      }
      if (input.bankStatementTransactionId) {
        const bankRow = await tx.bankStatementTransaction.findFirst({ where: { id: input.bankStatementTransactionId, shopId }, select: { id: true, direction: true } });
        if (!bankRow) fail("Bank statement transaction not found", 404, "CHANNEL_SETTLEMENT_BANK_ROW_NOT_FOUND");
        if (bankRow.direction !== "credit") fail("Payout evidence must be a credit transaction", 409, "CHANNEL_SETTLEMENT_BANK_DIRECTION_INVALID");
      }
      const mismatches = parseJsonArray(row.mismatchTypesJson).filter((item) => item !== "missing_order" && item !== "ambiguous_order");
      data = {
        resolutionStatus: "matched", matchStatus: "matched", matchedCustomerOrderId: order.id, matchedBillId: billId,
        bankStatementTransactionId: input.bankStatementTransactionId ?? null, resolutionNote: input.reason ?? null,
        resolvedByUserId: actor.userId ?? null, resolvedAt: new Date(), mismatchTypesJson: JSON.stringify(mismatches),
      };
    } else if (input.action === "ignore") {
      data = { resolutionStatus: "ignored", matchStatus: "ignored", resolutionNote: input.reason, resolvedByUserId: actor.userId ?? null, resolvedAt: new Date() };
    } else {
      if (row.resolutionStatus === "open") fail("Settlement row is already open", 409, "CHANNEL_SETTLEMENT_ALREADY_OPEN");
      const mismatches = parseJsonArray(row.mismatchTypesJson);
      const reopenedStatus = row.candidateCustomerOrderId ? "suggested" : mismatches.includes("ambiguous_order") ? "ambiguous" : "missing";
      data = {
        resolutionStatus: "open", matchStatus: reopenedStatus, matchedCustomerOrderId: null, matchedBillId: null,
        bankStatementTransactionId: null, resolutionNote: null, resolvedByUserId: null, resolvedAt: null,
      };
    }
    const updated = await tx.channelSettlementRow.update({ where: { id: row.id }, data });
    const next = resolutionSnapshot(updated);
    await tx.channelSettlementEvent.create({
      data: { shopId, rowId: row.id, action: input.action, previousJson: JSON.stringify(previous), nextJson: JSON.stringify(next), reason: input.reason ?? null, actorUserId: actor.userId ?? null },
    });
    await writeRequiredChannelSettlementAudit({
      shopId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      req: actor.req,
      action: `CHANNEL_SETTLEMENT_${input.action.toUpperCase()}`,
      entityType: "channel_settlement_row",
      entityId: row.id,
      before: previous,
      after: next,
      metadata: { reason: input.reason ?? null },
    }, tx);
    const complete = await tx.channelSettlementRow.findUnique({ where: { id: row.id }, include: { import: { include: { location: true } }, events: { orderBy: { createdAt: "desc" }, take: 20 } } });
    return shapeRow(complete);
  });
}
