export const REMINDER_CHANNELS = Object.freeze(["whatsapp", "sms", "email"]);

export const DEFAULT_REMINDER_TEMPLATES = Object.freeze([
  {
    name: "Friendly udhar reminder",
    channel: "whatsapp",
    templateText: "Namaste {{customerName}}, aapka ₹{{balance}} udhar pending hai. Kripya payment kar dein. - {{shopName}}",
  },
  {
    name: "Payment due reminder",
    channel: "whatsapp",
    templateText: "Namaste {{customerName}}, aapka ₹{{balance}} payment due hai. Last payment date: {{lastPaymentDate}}. - {{shopName}}",
  },
  {
    name: "Statement summary",
    channel: "whatsapp",
    templateText: "Namaste {{customerName}}, aapka current udhar balance ₹{{balance}} hai. Total bills: {{billCount}}, payments received: ₹{{paidAmount}}. - {{shopName}}",
  },
]);

export const ALLOWED_TEMPLATE_VARIABLES = Object.freeze([
  "customerName",
  "shopName",
  "balance",
  "dueDate",
  "lastPaymentDate",
  "billCount",
  "paidAmount",
  "statementPeriod",
]);

const allowedSet = new Set(ALLOWED_TEMPLATE_VARIABLES);

export function extractTemplateVariables(templateText = "") {
  const found = [];
  const re = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  let match;
  while ((match = re.exec(String(templateText))) !== null) found.push(match[1]);
  return [...new Set(found)];
}

export function validateTemplateVariables(templateText = "") {
  const unknown = extractTemplateVariables(templateText).filter((key) => !allowedSet.has(key));
  if (unknown.length) {
    const error = new Error(`Unknown reminder template variable: ${unknown.join(", ")}`);
    error.code = "UNKNOWN_TEMPLATE_VARIABLE";
    error.statusCode = 400;
    error.meta = { unknown };
    throw error;
  }
  return true;
}

export function sanitizeTemplateValue(value) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function renderReminderTemplate(templateText, variables = {}) {
  validateTemplateVariables(templateText);
  return String(templateText).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_raw, key) => sanitizeTemplateValue(variables[key] ?? ""));
}

export function moneyForReminder(value = 0) {
  const number = Number(value || 0);
  return number.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function messagePreview(message = "", length = 160) {
  const clean = String(message || "").replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

export function maskPhone(phone = "") {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export const __reminderFormatterInternals = { allowedSet };
