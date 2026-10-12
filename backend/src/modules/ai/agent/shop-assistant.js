import { replyText } from "./reply-localization.js";
import { BUSINESS_PROFILES } from "../../shops/businessProfiles.js";

/** Trusted, trade-owned copy. Nothing in shop settings or a model response is a prompt. */
export function shopAssistantProfile(businessType) {
  return Object.hasOwn(BUSINESS_PROFILES, businessType) ? BUSINESS_PROFILES[businessType].assistant : null;
}

export function shopAssistantPresentation(ctx, available) {
  const profile = shopAssistantProfile(ctx.businessType);
  if (!profile) return null;
  const reads = new Set(available.filter(tool => tool.kind === "read").map(tool => tool.name));
  return {
    title: profile.title,
    examples: profile.reads.filter(item => reads.has(item.tool)).map(item => item.question),
  };
}

const normalize = value => String(value ?? "").normalize("NFKC").toLowerCase().trim().replace(/[?!.।]+$/u, "").replace(/\s+/g, " ");
/** Exact reviewed read questions only; the agent still checks the live tool gate. */
export function shopAssistantQuickAnswer(message, businessType) {
  const query = normalize(message);
  const item = shopAssistantProfile(businessType)?.reads.find(read => Object.values(read.question).some(text => normalize(text) === query));
  return item ? { tool: item.tool, args: structuredClone(item.args) } : null;
}

export function renderShopReadCapabilities(result, language) {
  const profile = shopAssistantProfile(result?.businessType);
  if (!profile) return [];
  const allowed = new Set(Array.isArray(result?.reads) ? result.reads : []);
  const labels = profile.reads.filter(item => allowed.has(item.tool)).map(item => replyText(item.label.en, item.label.hi, language));
  return [replyText(profile.title.en, profile.title.hi, language), ...(labels.length ? [replyText("I can check these records:", "मैं ये रिकॉर्ड देख सकता हूँ:", language) + "\n" + labels.map(label => `• ${label}`).join("\n")] : [])];
}
