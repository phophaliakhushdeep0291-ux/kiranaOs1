import { z } from "zod";

export const customerOrderStatuses = ["new", "accepted", "ready", "fulfilled", "rejected", "cancelled"];

export const listCustomerOrdersSchema = z.object({
  status: z.enum(["all", ...customerOrderStatuses]).default("all"),
  cursor: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const updateCustomerOrderSchema = z.object({
  status: z.enum(customerOrderStatuses).optional(),
  billId: z.string().trim().min(1).max(120).nullable().optional(),
}).refine((value) => value.status !== undefined || value.billId !== undefined, "A status or bill must be supplied");
