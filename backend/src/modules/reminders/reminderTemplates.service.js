import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { DEFAULT_REMINDER_TEMPLATES, validateTemplateVariables } from "./reminderFormatter.js";

function appError(message, statusCode, code) {
  const err = new AppError(message, statusCode);
  err.code = code;
  return err;
}

async function writeRequiredReminderTemplateAudit(client, entry) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) throw appError("Reminder template change could not be audited", 503, "AUDIT_WRITE_FAILED");
  return audit;
}

export async function ensureDefaultReminderTemplates(shopId, userId = null) {
  const existing = await db.reminderTemplate.findMany({
    where: { shopId, deletedAt: null },
    select: { name: true, channel: true },
  });
  const existingKeys = new Set(existing.map((t) => `${t.channel}:${t.name}`));
  const created = [];
  for (const template of DEFAULT_REMINDER_TEMPLATES) {
    const key = `${template.channel}:${template.name}`;
    if (existingKeys.has(key)) continue;
    validateTemplateVariables(template.templateText);
    created.push(await db.reminderTemplate.create({
      data: { ...template, shopId, active: true, createdByUserId: userId },
    }));
  }
  return created;
}

export async function listReminderTemplates(shopId) {
  await ensureDefaultReminderTemplates(shopId);
  return db.reminderTemplate.findMany({
    where: { shopId, deletedAt: null },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

export async function getReminderTemplate(shopId, id) {
  const template = await db.reminderTemplate.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!template) throw appError("Reminder template not found", 404, "REMINDER_TEMPLATE_NOT_FOUND");
  return template;
}

export async function createReminderTemplate(shopId, userId, data, { req = null } = {}) {
  validateTemplateVariables(data.templateText);
  return db.$transaction(async (tx) => {
    const template = await tx.reminderTemplate.create({
      data: { shopId, createdByUserId: userId, active: data.active ?? true, name: data.name, channel: data.channel, templateText: data.templateText },
    });
    await writeRequiredReminderTemplateAudit(tx, { shopId, userId, action: "REMINDER_TEMPLATE_CREATED", entityType: "ReminderTemplate", entityId: template.id, metadata: { channel: template.channel, name: template.name }, req });
    return template;
  }, { isolationLevel: "Serializable" });
}

export async function updateReminderTemplate(shopId, id, userId, data, { req = null } = {}) {
  if (data.templateText) validateTemplateVariables(data.templateText);
  return db.$transaction(async (tx) => {
    const existing = await tx.reminderTemplate.findFirst({ where: { id, shopId, deletedAt: null } });
    if (!existing) throw appError("Reminder template not found", 404, "REMINDER_TEMPLATE_NOT_FOUND");
    const template = await tx.reminderTemplate.update({ where: { id: existing.id }, data });
    await writeRequiredReminderTemplateAudit(tx, { shopId, userId, action: "REMINDER_TEMPLATE_UPDATED", entityType: "ReminderTemplate", entityId: id, before: { channel: existing.channel, active: existing.active, name: existing.name }, after: { channel: template.channel, active: template.active, name: template.name }, req });
    return template;
  }, { isolationLevel: "Serializable" });
}

export async function deleteReminderTemplate(shopId, id, userId, { req = null } = {}) {
  return db.$transaction(async (tx) => {
    const existing = await tx.reminderTemplate.findFirst({ where: { id, shopId, deletedAt: null } });
    if (!existing) throw appError("Reminder template not found", 404, "REMINDER_TEMPLATE_NOT_FOUND");
    const template = await tx.reminderTemplate.update({ where: { id: existing.id }, data: { deletedAt: new Date(), active: false } });
    await writeRequiredReminderTemplateAudit(tx, { shopId, userId, action: "REMINDER_TEMPLATE_DELETED", entityType: "ReminderTemplate", entityId: id, before: { active: existing.active, deletedAt: existing.deletedAt }, after: { active: false, deletedAt: template.deletedAt }, metadata: { channel: existing.channel, softDelete: true }, req });
    return template;
  }, { isolationLevel: "Serializable" });
}
