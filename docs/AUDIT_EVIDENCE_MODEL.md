# Audit Evidence Model

Implementation: `AuditEvidenceRequirement` + `AuditEvidence` (Prisma), workflow in
`backend/src/modules/assurance/assurance.service.js`.

The governing principle: **a submitted document is not evidence until a human
verifies it.** Nothing in this module treats the existence of a file or reference
as proof of anything.

## Two records, two jobs

**`AuditEvidenceRequirement`** — what the engine asks for. Created automatically
when a finding is raised: each triggered rule declares `evidenceTypes`, and the
union becomes the finding's requirements (de-duplicated, and never duplicated on
re-evaluation). Owners and reviewers can add further requests via
`POST /api/audit/findings/:id/evidence-requests`.

**`AuditEvidence`** — what someone actually provided. Multiple evidence records
may satisfy one requirement, and evidence can also be attached with no
requirement at all.

## Evidence types

| Type | Typical source |
|---|---|
| `SALES_INVOICE` | the shop's own bill |
| `PURCHASE_INVOICE` | supplier's paper/PDF invoice |
| `PAYMENT_RECEIPT` | receipt book entry, counter slip |
| `UPI_REFERENCE` | UTR / transaction id from the payment app |
| `BANK_TRANSACTION` | bank statement line |
| `SUPPLIER_INVOICE_NUMBER` | invoice identifier for cross-checking |
| `GOODS_RECEIPT_CONFIRMATION` | who received the delivery and what arrived |
| `CUSTOMER_CONFIRMATION` | customer confirms the amount or the khata |
| `STOCK_COUNT_CONFIRMATION` | physical count result |
| `EXPENSE_RECEIPT` | vendor receipt for a spend |
| `STAFF_EXPLANATION` | written explanation from the person involved |
| `OWNER_APPROVAL` | owner's authorisation for the action |
| `CANCELLATION_REASON` | why a bill was cancelled |
| `CORRECTION_REASON` | why a correction was posted |
| `DEVICE_TIMESTAMP_METADATA` | device/sync trail for a timing question |

## Verification lifecycle

```
REQUESTED ──► PROVIDED ──► VERIFIED
                  │
                  ├────────► REJECTED
                  ├────────► INSUFFICIENT ──► (more evidence) ──► PROVIDED
                  └────────► NOT_APPLICABLE
```

- Submission always lands as **PROVIDED**. The API has no way to create
  pre-verified evidence.
- Only a role holding `VERIFY_EVIDENCE` (owner, audit reviewer) can move evidence
  to VERIFIED / REJECTED / INSUFFICIENT / NOT_APPLICABLE. A manager can submit but
  not verify.
- Verifying writes `verifiedByUserId` + `verifiedAt` and mirrors the status onto
  the linked requirement.
- Every submission and verification also appends a row to
  `AuditFindingStatusHistory`, so the evidence trail and the finding trail are one
  chronology.
- **Nothing is ever deleted.** Rejected evidence stays on the record with its
  rejection note.

## Record fields

| Field | Purpose |
|---|---|
| `evidenceId`, `shopId`, `findingId`, `requirementId` | identity and scope |
| `evidenceType` | one of the types above |
| `referenceKind` | `text \| reference \| url \| file \| transaction_ref` |
| `referenceValue` | the invoice number, UTR, URL or written explanation |
| `originalFilename`, `mimeType`, `sizeBytes` | file metadata when a file is involved |
| `checksumSha256` | integrity anchor (see below) |
| `storageKey` | object-storage key when file bytes are stored |
| `uploadedByUserId`, `createdAt` | who provided it, when |
| `verificationStatus`, `verifiedByUserId`, `verifiedAt`, `reviewerNotes` | the human decision |
| `extractedMetadataJson` | submitter role, checksum source, and reuse detection |

## Checksums and reuse detection

Every submission gets a `checksumSha256`: the caller's file checksum when
supplied, otherwise a hash of the reference text. On submission the service
searches the shop's other findings for the same checksum and records the matches
in `extractedMetadata.reusedOnOtherFindings`, returning `reuseWarningCount` to the
caller. The UI shows "also attached to N other finding(s)".

This is how "same receipt used more than once" (requested rule E10) is covered:
rather than a rule guessing from expense fields, the evidence layer detects the
reuse at the moment it happens. Reuse is **surfaced, not blocked** — a genuine
shared document (one invoice covering two flagged purchases) is legitimate, and
the reviewer decides.

A checksum proves a submitted reference has not changed since submission. It does
**not** prove the underlying document is genuine.

## File storage in v1

Reference-type evidence (invoice numbers, UTRs, URLs, written explanations) works
everywhere and is the primary path for this phase. Binary uploads ride on the
existing `lib/objectStorage.js` (S3-compatible) when configured; when storage is
disabled, `storageKey` stays null and the reference/text path is used. There is no
generic attachment model anywhere else in KiranaOS, so this module is the first
place a purchase invoice or expense receipt can be attached at all.

Attachments are never sent to an external AI provider unless
`AUDIT_AI_ALLOW_ATTACHMENTS=true` (default false); see `AUDIT_SECURITY_AND_PRIVACY.md`.

## Evidence and finding resolution

Evidence does not resolve a finding by itself. A reviewer must transition the
finding explicitly, optionally citing the evidence id — which is validated as
belonging to that finding and that shop before it is recorded. Requesting the
first piece of evidence moves an `OPEN` finding to `EVIDENCE_REQUESTED`; the
reviewer's decision moves it onward.
