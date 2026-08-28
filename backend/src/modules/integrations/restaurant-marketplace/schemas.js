import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const paise = z.number().int().min(0).max(100_000_000);
export const marketplaceSetupSchema = z.object({
  locationId: id,
  externalOutletId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  environment: z.enum(["sandbox", "live"]).default("sandbox"),
}).strict();

export const marketplaceVerifySchema = z.object({}).strict();

// KiranaOS internal contract, NOT Zomato/Swiggy's wire format. A provider adapter
// must authenticate the original payload and explicitly map each field to this.
const lineSchema = z.object({
  lineId: id,
  externalItemId: id,
  name: z.string().trim().min(1).max(240),
  quantity: z.number().int().min(1).max(999),
  unitPricePaise: paise,
  lineTotalPaise: paise,
  instructions: z.string().max(1000).optional(),
}).strict().refine((line) => line.unitPricePaise * line.quantity === line.lineTotalPaise, "Line total does not match quantity and unit price");

const snapshotSchema = z.object({
  currency: z.literal("INR"),
  lines: z.array(lineSchema).min(1).max(200),
  subtotalPaise: paise,
  taxPaise: paise,
  chargesPaise: paise,
  discountPaise: paise,
  totalPaise: paise,
  providerPayment: z.enum(["unknown", "platform_collected", "collect_at_restaurant"]),
  instructions: z.string().max(2000).optional(),
}).strict().superRefine((snapshot, ctx) => {
  if (new Set(snapshot.lines.map((line) => line.lineId)).size !== snapshot.lines.length) ctx.addIssue({ code: "custom", message: "Duplicate order line id" });
  if (snapshot.lines.reduce((sum, line) => sum + line.lineTotalPaise, 0) !== snapshot.subtotalPaise) ctx.addIssue({ code: "custom", message: "Subtotal does not match order lines" });
  if (snapshot.subtotalPaise + snapshot.taxPaise + snapshot.chargesPaise - snapshot.discountPaise !== snapshot.totalPaise) ctx.addIssue({ code: "custom", message: "Order total does not reconcile" });
});

export const marketplaceEventSchema = z.object({
  eventId: id,
  externalOutletId: id,
  externalOrderId: id,
  environment: z.enum(["sandbox", "live"]),
  kind: z.enum(["order.created", "order.cancelled", "order.fulfilled"]),
  occurredAt: z.string().datetime({ offset: true }),
  order: snapshotSchema.optional(),
}).strict().superRefine((event, ctx) => {
  if ((event.kind === "order.created") !== Boolean(event.order)) ctx.addIssue({ code: "custom", message: "Only order.created must contain an order snapshot" });
});

export const marketplaceCommandSchema = z.object({
  requestKey: z.string().uuid(),
  action: z.enum(["accept", "reject", "ready"]),
  preparationMinutes: z.number().int().min(1).max(180).optional(),
  rejectionReason: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((command, ctx) => {
  if (command.action === "accept" && !command.preparationMinutes) ctx.addIssue({ code: "custom", message: "Preparation time is required" });
  if (command.action === "reject" && !command.rejectionReason) ctx.addIssue({ code: "custom", message: "Rejection reason is required" });
  if (command.action !== "accept" && command.preparationMinutes !== undefined) ctx.addIssue({ code: "custom", message: "Preparation time is only valid for acceptance" });
  if (command.action !== "reject" && command.rejectionReason !== undefined) ctx.addIssue({ code: "custom", message: "Rejection reason is only valid for rejection" });
});
