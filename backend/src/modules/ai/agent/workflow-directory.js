import { createRequire } from "node:module";
import { roleHasPermission, isReadOnlyRole } from "../../../core/permissions/rbac.js";
import { BUSINESS_PROFILES } from "../../shops/businessProfiles.js";
import { renderShopReadCapabilities } from "./shop-assistant.js";

export const WORKFLOWS = Object.freeze(createRequire(import.meta.url)("./workflows.json"));
export function workflowAvailable(workflow, ctx) {
  if (workflow.id === "orders_received" && ctx.businessType === "restaurant") return false;
  if (workflow.businessType && workflow.businessType !== ctx.businessType) return false;
  if (workflow.feature && !ctx.features?.has(workflow.feature)) return false;
  if (workflow.changesData && isReadOnlyRole(ctx.role)) return false;
  if (workflow.permission && !roleHasPermission(ctx.role, workflow.permission)) return false;
  if (workflow.capability && !BUSINESS_PROFILES[ctx.businessType]?.capabilities?.includes(workflow.capability)) return false;
  return true;
}
export function workflowHandoffs(evidence, ctx, language = "hi") {
  const ids = evidence.filter(entry => entry.tool === "get_workflow" && entry.status === "ok")
    .flatMap(entry => entry.result?.workflows ?? []);
  return WORKFLOWS.filter(row => ids.includes(row.id) && workflowAvailable(row, ctx)).slice(0, 3)
    .map(row => ({ id: row.id, title: row.title[language === "en" ? "en" : "hi"] }));
}
export function renderWorkflowHelp(result, language = "hi") {
  const lang = language === "en" ? "en" : "hi";
  const ids = Array.isArray(result?.workflows) ? result.workflows : [];
  const names = WORKFLOWS.filter(row => ids.includes(row.id)).slice(0, 3).map(row => row.title[lang]);
  if (!names.length) return lang === "en"
    ? "That workflow is unavailable for your shop, role or plan. No action was performed."
    : "यह काम आपकी दुकान, भूमिका या प्लान में उपलब्ध नहीं है। कोई कार्रवाई नहीं हुई।";
  return lang === "en"
    ? `Continue in ${names.join(", ")}. This part requires the app's form and your review; the assistant has not completed it. Use the button below to open the screen.`
    : `${names.join(", ")} में आगे बढ़ें। इस हिस्से के लिए ऐप का फॉर्म भरना और आपकी समीक्षा जरूरी है; सहायक ने इसे पूरा नहीं किया है। नीचे के बटन से स्क्रीन खोलें।`;
}
export const ACTION_LABELS = Object.freeze({
  create_product: ["Create a simple product", "साधारण सामान जोड़ना"],
  set_pack_size: ["Add or price a pack size", "पैक जोड़ना या उसका रेट बदलना"],
  add_items_to_bill: ["Add items to a bill for review", "बिल में सामान जोड़कर जाँचना"],
  create_customer: ["Create a customer", "ग्राहक जोड़ना"],
  record_udhar_payment: ["Record a credit repayment", "उधार का भुगतान दर्ज करना"],
  update_product_price: ["Change a product price", "सामान का रेट बदलना"],
  correct_stock: ["Correct counted stock", "गिने हुए स्टॉक को सुधारना"],
  create_supplier: ["Create a supplier", "सप्लायर जोड़ना"],
  create_expense: ["Record a one-off expense", "एक बार का खर्च दर्ज करना"],
});
export function renderTaskCapabilities(result, language = "hi") {
  const hi = language !== "en";
  const names = (Array.isArray(result?.actions) ? result.actions : [])
    .filter(name => Object.hasOwn(ACTION_LABELS, name)).map(name => ACTION_LABELS[name][hi ? 1 : 0]);
  const intro = hi ? "पुष्टि के बाद उपलब्ध काम:" : "Available tasks after your confirmation:";
  const limits = hi
    ? "रेट या स्टॉक बदलने के लिए मालिक का PIN चाहिए। बिल पूरा करना, रिफंड, खरीद प्राप्ति, टैक्स, कर्मचारी, इंटीग्रेशन और विशेष व्यवसाय के बदलाव अभी संबंधित स्क्रीन पर करने होते हैं। स्क्रीन खोलना काम पूरा करना नहीं है।"
    : "Price and stock changes need the owner PIN. Checkout, refunds, purchase receiving, taxes, staff, integrations and trade-specific changes still need their own screens. Opening a screen does not complete its task.";
  return [...renderShopReadCapabilities(result, language), names.length ? intro + "\n" + names.map(name => `• ${name}`).join("\n")
    : hi ? "आपकी भूमिका में कोई बदलाव करने की अनुमति नहीं है।" : "No change actions are available to your role.", limits].join("\n\n");
}
