import { z } from "zod";

export const customerOrderStatuses = ["new", "accepted", "ready", "fulfilled", "rejected", "cancelled"];
export const customerOrderChannels = ["pos", "customer_portal", "api", "marketplace"];
export const customerOrderPaymentStatuses = ["unpaid", "partially_paid", "paid", "refunded"];

export const listCustomerOrdersSchema = z.object({
  status: z.enum(["all", ...customerOrderStatuses]).default("all"),
  sourceChannel: z.enum(["all", ...customerOrderChannels]).default("all"),
  paymentStatus: z.enum(["all", ...customerOrderPaymentStatuses]).default("all"),
  cursor: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const updateCustomerOrderSchema = z.object({
  status: z.enum(customerOrderStatuses).optional(),
  paymentStatus: z.enum(customerOrderPaymentStatuses).optional(),
  billId: z.string().trim().min(1).max(120).nullable().optional(),
  acceptanceKey: z.string().uuid().optional(),
}).refine(
  (value) => value.status !== undefined || value.paymentStatus !== undefined || value.billId !== undefined,
  "A status, payment status, or bill must be supplied",
);
