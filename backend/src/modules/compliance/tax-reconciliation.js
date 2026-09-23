import { z } from "zod";
import { validateGstin } from "../../utils/gst.js";

const gstin = z.string().trim().toUpperCase().refine((value) => validateGstin(value).valid, "Invalid GSTIN");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid invoice date");
const paise = z.number().int().min(0).max(100_000_000_000);
const invoice = z.object({
  sourceId: z.string().trim().min(1).max(120),
  supplierGstin: gstin,
  invoiceNumber: z.string().trim().min(1).max(50),
  invoiceDate: date,
  documentType: z.enum(["invoice", "credit_note", "debit_note"]),
  taxablePaise: paise,
  cgstPaise: paise,
  sgstPaise: paise,
  igstPaise: paise,
  cessPaise: paise,
}).strict();

// This is our explicit interchange format, not GSTN's native download format.
// Amounts are positive magnitudes in integer paise, including credit notes.
export const taxReconciliationSchema = z.object({
  schemaVersion: z.literal("kirana-tax-reconciliation-v1"),
  recipientGstin: gstin,
  period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  books: z.array(invoice).max(2000),
  statement: z.array(invoice.extend({ itcAvailability: z.enum(["available", "unavailable", "unknown"]) }).strict()).max(2000),
}).strict().superRefine((value, ctx) => {
  for (const side of ["books", "statement"]) {
    const ids = new Set();
    value[side].forEach((row, index) => {
      if (ids.has(row.sourceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [side, index, "sourceId"], message: "Source IDs must be unique within each side" });
      ids.add(row.sourceId);
      // Previous periods can appear in a later statement, but future-dated
      // documents cannot silently be treated as matches for this period.
      if (row.invoiceDate.slice(0, 7) > value.period) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [side, index, "invoiceDate"], message: "Invoice date falls after the selected statement period" });
    });
  }
});

const amounts = ["taxablePaise", "cgstPaise", "sgstPaise", "igstPaise", "cessPaise"];
const keyFor = (row) => JSON.stringify([
  row.supplierGstin, row.documentType, row.invoiceNumber.toUpperCase(),
  // Invoice numbering may restart each financial year. The full date is
  // compared below so within-year date disagreements remain visible.
  Number(row.invoiceDate.slice(0, 4)) - (Number(row.invoiceDate.slice(5, 7)) < 4 ? 1 : 0),
]);

export function reconcileTaxInvoices(raw) {
  const input = taxReconciliationSchema.parse(raw);
  const groups = new Map();
  for (const side of ["books", "statement"]) for (const row of input[side]) {
    const key = keyFor(row);
    const group = groups.get(key) || { books: [], statement: [] };
    group[side].push(row);
    groups.set(key, group);
  }
  const results = [];
  for (const { books, statement } of groups.values()) {
    const reference = books[0] || statement[0];
    let status;
    const differences = [];
    if (books.length > 1 || statement.length > 1) status = "duplicate_review";
    else if (!books.length) status = "missing_in_books";
    else if (!statement.length) status = "missing_in_statement";
    else {
      if (books[0].invoiceDate !== statement[0].invoiceDate) differences.push({ field: "invoiceDate", books: books[0].invoiceDate, statement: statement[0].invoiceDate });
      for (const field of amounts) if (books[0][field] !== statement[0][field]) {
        differences.push({ field, books: books[0][field], statement: statement[0][field], deltaPaise: books[0][field] - statement[0][field] });
      }
      status = differences.length ? "mismatch" : "matched";
    }
    results.push({
      supplierGstin: reference.supplierGstin,
      invoiceNumber: reference.invoiceNumber,
      invoiceDate: reference.invoiceDate,
      documentType: reference.documentType,
      status,
      booksSourceIds: books.map((row) => row.sourceId),
      statementSourceIds: statement.map((row) => row.sourceId),
      differences,
      itcAvailability: statement.length === 1 ? statement[0].itcAvailability : "unknown",
    });
  }
  const counts = { matched: 0, mismatch: 0, missing_in_books: 0, missing_in_statement: 0, duplicate_review: 0 };
  for (const row of results) counts[row.status] += 1;
  return {
    schemaVersion: "kirana-tax-reconciliation-result-v1",
    recipientGstin: input.recipientGstin,
    period: input.period,
    filingEnabled: false,
    eligibleItcPaise: null,
    source: "user_supplied_unverified",
    counts,
    results,
  };
}
