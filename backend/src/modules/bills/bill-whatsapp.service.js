import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { toPaise } from "../../utils/money.js";
import { calculateCustomerUdharRawBalance } from "../udhar/udharBalance.service.js";
import { getWhatsAppProviderStatus, sendWhatsAppMessage } from "../reminders/whatsapp.provider.js";

function rupees(paise) {
  return `₹${(Math.abs(Number(paise)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildHindiBillMessage({ shopName, billNo, totalPaise, previousUdharPaise = 0, showPreviousUdhar = false, gstPaise = 0, showGst = true, receiptUrl }) {
  return [
    `🧾 *${shopName} से आपका बिल*`,
    `बिल नंबर: ${billNo}`,
    `कुल राशि: *${rupees(totalPaise)}*`,
    showPreviousUdhar && previousUdharPaise > 0 ? `पिछला उधार: ${rupees(previousUdharPaise)}` : "",
    showGst && gstPaise > 0 ? `GST: ${rupees(gstPaise)}` : "",
    receiptUrl ? `बिल देखें: ${receiptUrl}` : "",
    "धन्यवाद 🙏",
  ].filter(Boolean).join("\n");
}

export async function deliverBillWhatsapp(shopId, billId, input) {
  const bill = await db.bill.findFirst({ where: { id: billId, shopId, deletedAt: null }, include: { customer: true, shop: true } });
  if (!bill) throw new AppError("Bill not found", 404, "BILL_NOT_FOUND");
  if (bill.whatsappDeliveryKey === input.idempotencyKey) return deliveryResult(bill);

  const currentRaw = bill.customerId ? await calculateCustomerUdharRawBalance(db, shopId, bill.customerId) : 0;
  const previousUdharPaise = Math.max(0, toPaise(currentRaw) - Number(bill.creditAmountPaise ?? BigInt(toPaise(Number(bill.creditAmount || 0)))));
  const receiptUrl = env.FRONTEND_APP_URL ? `${env.FRONTEND_APP_URL.replace(/\/$/, "")}/bills/${encodeURIComponent(bill.id)}` : undefined;
  const message = buildHindiBillMessage({
    shopName: bill.shop.name,
    billNo: bill.billNo,
    totalPaise: Number(bill.grandTotalPaise ?? BigInt(toPaise(Number(bill.grandTotal)))),
    previousUdharPaise,
    showPreviousUdhar: input.showPreviousUdhar,
    gstPaise: Number(bill.gstPaise ?? BigInt(toPaise(Number(bill.gst)))),
    showGst: input.showGst,
    receiptUrl,
  });

  if (input.mode === "deep_link_opened") {
    const updated = await db.bill.update({ where: { id: bill.id }, data: { whatsappDeliveryState: "opened_share_sheet", whatsappDeliveryAt: new Date(), whatsappDeliveryKey: input.idempotencyKey } });
    return { ...deliveryResult(updated), message };
  }
  const provider = getWhatsAppProviderStatus();
  const mobile = input.customerMobile || bill.customer?.mobile;
  if (!provider.sendConfigured || !mobile) return { path: "deep_link", state: "not_sent", message };

  try {
    await db.bill.update({ where: { id: bill.id }, data: { whatsappDeliveryKey: input.idempotencyKey } });
  } catch (error) {
    if (error?.code === "P2002") return deliveryResult(await db.bill.findUnique({ where: { id: bill.id } }));
    throw error;
  }
  const sent = await sendWhatsAppMessage({ to: mobile, message, shopId, customerId: bill.customerId, reminderLogId: `bill:${bill.id}` });
  const state = sent.success ? "sent_via_api" : "failed";
  const updated = await db.bill.update({ where: { id: bill.id }, data: { whatsappDeliveryState: state, whatsappDeliveryAt: new Date(), whatsappProviderMessageId: sent.providerMessageId ?? null } });
  return { ...deliveryResult(updated), message, code: sent.code };
}

function deliveryResult(bill) {
  return { path: bill.whatsappDeliveryState === "sent_via_api" ? "api" : "deep_link", state: bill.whatsappDeliveryState, updatedAt: bill.whatsappDeliveryAt, billId: bill.id };
}
