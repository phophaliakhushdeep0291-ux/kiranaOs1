// Role permissions for the Financial Assurance module.
//
// KiranaOS User.role is a free string, so the product's AUDIT_REVIEWER role
// maps to the new "audit_reviewer" value without a schema change. Existing
// roles map as: owner → OWNER, admin → MANAGER, staff → STAFF.
//
// Two invariants hold for every role, including OWNER:
//   * nobody can delete a finding, an evidence record or a history row;
//   * nothing in this module can write to a canonical financial table.
import { AppError } from "../../middleware/error.js";
import { FINDING_STATUS } from "./assurance.constants.js";

export const AUDIT_ROLES = Object.freeze({
  OWNER: "owner",
  MANAGER: "admin",
  STAFF: "staff",
  AUDIT_REVIEWER: "audit_reviewer",
});

export const CAPABILITIES = Object.freeze({
  VIEW_ALL_FINDINGS: "VIEW_ALL_FINDINGS",
  VIEW_ASSIGNED_FINDINGS: "VIEW_ASSIGNED_FINDINGS",
  REQUEST_EVIDENCE: "REQUEST_EVIDENCE",
  SUBMIT_EVIDENCE: "SUBMIT_EVIDENCE",
  VERIFY_EVIDENCE: "VERIFY_EVIDENCE",
  REVIEW_FINDING: "REVIEW_FINDING",
  RESOLVE_FINDING: "RESOLVE_FINDING",
  CLOSE_FINDING: "CLOSE_FINDING",
  ASSIGN_REVIEWER: "ASSIGN_REVIEWER",
  CONFIGURE_RULES: "CONFIGURE_RULES",
  TRIGGER_RUN: "TRIGGER_RUN",
  VIEW_REPORTS: "VIEW_REPORTS",
});

const ROLE_CAPABILITIES = Object.freeze({
  [AUDIT_ROLES.OWNER]: [
    CAPABILITIES.VIEW_ALL_FINDINGS,
    CAPABILITIES.REQUEST_EVIDENCE,
    CAPABILITIES.SUBMIT_EVIDENCE,
    CAPABILITIES.VERIFY_EVIDENCE,
    CAPABILITIES.REVIEW_FINDING,
    CAPABILITIES.RESOLVE_FINDING,
    CAPABILITIES.CLOSE_FINDING,
    CAPABILITIES.ASSIGN_REVIEWER,
    CAPABILITIES.CONFIGURE_RULES,
    CAPABILITIES.TRIGGER_RUN,
    CAPABILITIES.VIEW_REPORTS,
  ],
  [AUDIT_ROLES.MANAGER]: [
    CAPABILITIES.VIEW_ALL_FINDINGS,
    CAPABILITIES.SUBMIT_EVIDENCE,
    CAPABILITIES.REVIEW_FINDING,
    CAPABILITIES.TRIGGER_RUN,
    CAPABILITIES.VIEW_REPORTS,
  ],
  [AUDIT_ROLES.AUDIT_REVIEWER]: [
    CAPABILITIES.VIEW_ALL_FINDINGS,
    CAPABILITIES.REQUEST_EVIDENCE,
    CAPABILITIES.SUBMIT_EVIDENCE,
    CAPABILITIES.VERIFY_EVIDENCE,
    CAPABILITIES.REVIEW_FINDING,
    CAPABILITIES.RESOLVE_FINDING,
    CAPABILITIES.CLOSE_FINDING,
    CAPABILITIES.VIEW_REPORTS,
  ],
  [AUDIT_ROLES.STAFF]: [
    CAPABILITIES.VIEW_ASSIGNED_FINDINGS,
    CAPABILITIES.SUBMIT_EVIDENCE,
  ],
});

// Resolutions that only a reviewer or the owner may set. A manager can review
// and comment but cannot declare a finding a false positive or accept the risk.
const RESTRICTED_RESOLUTIONS = Object.freeze([
  FINDING_STATUS.FALSE_POSITIVE,
  FINDING_STATUS.ACCEPTED_RISK,
  FINDING_STATUS.CLOSED,
]);

export function capabilitiesForRole(role) {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function can(role, capability) {
  return capabilitiesForRole(role).includes(capability);
}

export function assertCapability(role, capability) {
  if (!can(role, capability)) {
    throw new AppError("Your role cannot perform this assurance action", 403, "AUDIT_FORBIDDEN");
  }
}

/**
 * Staff may only ever see findings assigned to them. Returns the extra Prisma
 * `where` clause for the caller's role — shopId scoping is applied separately
 * and always.
 */
export function findingVisibilityFilter({ role, userId }) {
  if (can(role, CAPABILITIES.VIEW_ALL_FINDINGS)) return {};
  if (can(role, CAPABILITIES.VIEW_ASSIGNED_FINDINGS)) return { assignedReviewerId: userId };
  throw new AppError("Your role cannot view assurance findings", 403, "AUDIT_FORBIDDEN");
}

export function assertCanSetStatus(role, newStatus) {
  if (RESTRICTED_RESOLUTIONS.includes(newStatus)) {
    if (!can(role, CAPABILITIES.CLOSE_FINDING)) {
      throw new AppError(`Only an owner or audit reviewer can set a finding to ${newStatus}`, 403, "AUDIT_FORBIDDEN_STATUS");
    }
    return;
  }
  if (!can(role, CAPABILITIES.REVIEW_FINDING) && !can(role, CAPABILITIES.RESOLVE_FINDING)) {
    throw new AppError("Your role cannot change a finding's status", 403, "AUDIT_FORBIDDEN");
  }
}
