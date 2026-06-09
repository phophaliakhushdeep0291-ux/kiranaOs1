import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const dateLike = z.string().optional();

export const dailyClosingSchema = z.object({
  date: dateOnly,
  source: z.enum(["live", "snapshot"]).optional(),
});

export const dailyClosingSnapshotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const salesSummarySchema = z.object({
  range: z.enum(["today", "7d", "30d"]).optional(),
  from: dateLike,
  to: dateLike,
});

export const paymentModesSchema = z.object({
  from: dateLike,
  to: dateLike,
});

export const udharAgeingSchema = z.object({});

export const inventoryHealthSchema = z.object({
  windowDays: z.coerce.number().min(7).max(365).default(30),
});

export const staffSalesSchema = z.object({
  from: dateLike,
  to: dateLike,
});

export const pnlQuerySchema = z.object({
  range: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const monthlyBreakdownSchema = z.object({
  year: z.coerce.number().default(new Date().getFullYear()),
  untilMonth: z.coerce.number().min(1).max(12).default(new Date().getMonth() + 1),
});

export const topProductsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});


export const exportReportSchema = z.object({
  reportType: z.enum(["bills_csv", "stock_csv", "udhar_csv", "daily_closing_csv", "sales_summary_csv"]),
  params: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    range: z.enum(["today", "7d", "30d"]).optional(),
    status: z.string().optional(),
    productId: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
  }).default({}),
  ownerPin: z.string().optional(),
});

export const exportListSchema = z.object({
  status: z.enum(["queued", "processing", "completed", "failed", "cancelled"]).optional(),
  reportType: z.enum(["bills_csv", "stock_csv", "udhar_csv", "daily_closing_csv", "sales_summary_csv"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const overrideDailyClosingSnapshotSchema = z.object({
  reason: z.string().min(5).max(500),
  ownerPin: z.string().optional(),
});
