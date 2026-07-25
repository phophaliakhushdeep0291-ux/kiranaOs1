# KiranaAudit — Section-144 Safe Independence Architecture

> The single biggest legal risk to this business is being caught **preparing books AND auditing them**. Section 144 of the Companies Act 2013 forbids the statutory auditor from providing accounting, book-keeping, and internal-audit services to the audit client. Even if we're not the statutory auditor in Phase-1, the *appearance* of joint operation with KiranaOS (the accounting product) could taint our credibility with the CA channel and lock us out of Phase-2/3 forever.
>
> This document defines the **structural firewall** between the two products.

## 1. The rule we're respecting

**Section 144, Companies Act 2013:**  the statutory auditor of a company shall not, directly or through any relative, render specified services to the company or its holding/subsidiary/associate — including accounting, book-keeping, internal audit, management services, investment advisory, and rendering of outsourced financial services.

**Section 141:** only a Chartered Accountant (or a firm where a majority of partners are CAs) may be appointed as a company's auditor.

**ICAI Code of Ethics, Sec 400+:** the same firm and its network firms must not create a self-review threat by first preparing accounting records and then auditing them.

## 2. What "independence architecture" means concretely

We build **two products that cannot legally be shown to share personnel, data, or decision-making** — even if the ultimate owner is the same holding company.

## 3. The two-entity structure

```
                   ┌──────────────────────────────┐
                   │   NewCo Holdings Pvt Ltd     │
                   │ (or founder as individual)   │
                   └───────┬──────────────┬───────┘
                           │              │
                           │              │
        ┌──────────────────┴──┐        ┌─┴────────────────────┐
        │  KiranaOS Pvt Ltd    │        │  KiranaAudit LLP     │
        │  (Section 8 or       │        │  (Limited Liability  │
        │   private limited)   │        │   Partnership,       │
        │                      │        │   ICAI-registered    │
        │  Sells POS/accounting│        │   in Phase-3;        │
        │  software to shops   │        │   tech-LLP           │
        │                      │        │   in Phase-1/2)      │
        └──────────────────────┘        └──────────────────────┘
              │                                    │
              │  NO shared:                        │
              │  - client engagements              │
              │  - customer databases              │
              │  - direct staff assignments        │
              │  - hosting infra (physical or      │
              │    logical separation)             │
              │  - decision-making meetings on     │
              │    audit engagements               │
              │                                    │
              ▼                                    ▼
```

Both entities may share:
- Same investors / cap table
- Same central legal counsel (with a "chinese wall" if they advise on client-facing matters)
- Same finance/HR back office (with data separation for client records)
- **A commercial arrangement** where KiranaAudit purchases data from KiranaOS at arm's length pricing, but ONLY if the client has expressly opted in AND their statutory auditor has approved

Both entities may NOT share:
- Employees who work on the same client on both sides
- Login systems that grant a single person access to both a KiranaOS shop's data AND that shop's audit engagement
- Any product-to-product API that allows KiranaAudit to modify KiranaOS data or vice-versa

## 4. Data-plane firewall

| Concern | Rule | Enforced by |
|---|---|---|
| Storage | KiranaOS DB and KiranaAudit DB run on **separate database servers under separate AWS/GCP accounts**. NOT separate schemas in one Postgres. | Infra provisioning IaC (Terraform) + quarterly evidence |
| Object storage | Separate S3 buckets, separate KMS keys, separate IAM principals | Terraform + AWS Organizations SCP |
| Network | Backends in separate VPCs; NO VPC peering; no private links | AWS Config rules |
| Identity | Separate Cognito/Auth0 tenants (or separate JWT signing keys) — a KiranaOS token MUST NOT authenticate on KiranaAudit and vice-versa | Different `JWT_SECRET` + issuer claim; validated in middleware |
| Logging | Separate CloudWatch/Datadog projects | Terraform + access reviews |
| Backup | Independent DR plans; backups NOT restorable to the other side | Documented DR runbook |
| Personnel | Named "Chinese wall" employee list; anyone on the list may work ONLY on one side; violations → immediate termination | HR policy + quarterly audit |
| Emergency access | Two-person rule on cross-entity data access; every such access logged and reviewed weekly | Break-glass log |

## 5. Client onboarding flow (Phase-1)

```
   Client CFO signs up for KiranaAudit
                    │
                    ▼
   Signs ENGAGEMENT LETTER stating:
     - "I understand KiranaAudit is not my statutory auditor"
     - "KiranaAudit will not prepare my books"
     - "My statutory auditor may view KiranaAudit's findings"
     - "I authorise KiranaAudit to connect to my ERP/GSTN read-only"
                    │
                    ▼
   Client authorises data connectors
   (Tally read-only export, GSTN OTP consent flow via Setu,
    bank statement upload)
                    │
                    ▼
   KiranaAudit ingests data → detectors run →
   monthly Audit Pack delivered → CA (client's existing CA)
   may verify findings independently
                    │
                    ▼
   Client's CA does statutory audit as usual
   (may or may not reference our findings)
```

**Under no circumstance does KiranaAudit change the client's Tally / accounting data.** Findings are external notes. If the client acts on a finding, they (or their CA) make the correction in their own books.

## 6. Product-level firewall in code

If KiranaOS is a shop's POS AND that shop is a KiranaAudit client:
- The KiranaAudit ingestion connector treats KiranaOS as **just another data source** — it uses the shop-owner's read-only API token, same as if it were Tally
- No shared code library that could leak audit findings back into the POS UI
- No cross-product notifications
- Financial impact of an audit finding is NEVER auto-corrected in KiranaOS

## 7. Legal disclosures we ship

Every KiranaAudit report includes on page 1:
```
This report is prepared by KiranaAudit LLP for internal use by
the management of [Client]. It is not an audit under the Companies
Act 2013 or the Standards on Auditing issued by the ICAI.
KiranaAudit LLP is not the statutory auditor of [Client] and does
not sign the Independent Auditor's Report. Findings herein are
generated using automated procedures and are provided as
management-information; the client's statutory auditor and
Chartered Accountant remain the professionals responsible for the
opinion on the financial statements.
```

## 8. What happens in Phase-3 (KiranaAudit LLP becomes an ICAI-registered audit firm)

At that point:
- **KiranaAudit LLP** may take on statutory audit engagements — but ONLY for clients where NEITHER KiranaAudit LLP NOR its network firms have provided any Section-144-prohibited service in the past two years
- We build a **conflict register**: every client we've ever done any work for has an entry stating what service and when. Before we accept a statutory audit, the register is checked
- If a client uses KiranaOS as their POS AND we want to be their statutory auditor, we must first document that KiranaAudit LLP did NOT provide accounting/book-keeping/management services — the client used KiranaOS themselves, and we merely read its output like any other data source. Get counsel's written opinion each time. Ideally, offer such clients a **choice**: KiranaOS or statutory audit by KiranaAudit LLP, not both

## 9. Counsel signoff (must obtain BEFORE Phase-1 launch)

Retain a specialist Companies Act + ICAI counsel and get **written opinions on**:
1. Two-entity structure clears Sec 141 / 144 for Phase-1 (internal audit only)
2. The commercial arrangement between KiranaOS and KiranaAudit does not create prohibited "outsourced financial services" flow
3. The way we phrase marketing does not misrepresent us as statutory auditors
4. The engagement letter template
5. The independence questionnaire we make each new client sign
6. The auditor-independence declaration that every KiranaAudit staffer signs annually

Budget: ₹3-6 lakh in Year 1 for counsel opinions + retainer.

## 10. Enforcement — audit trail of the auditors

Every quarter, we produce an **Independence Assurance Report** for our own board:
- Personnel movement between KiranaOS and KiranaAudit (should be zero unless with 12-month cooling-off)
- Data-plane access reviews (any cross-DB reads? — should be zero)
- New KiranaAudit clients: does any employee assigned to them have KiranaOS role on the same shop? — should be zero
- Break-glass access log — reviewed by CFO + General Counsel

If ANY breach is discovered, immediate incident response and disclosure to the affected client + ICAI (in Phase-3 onwards).

---

**Summary: independence is not a checkbox, it is an architectural choice. Build it into the corporate structure, the data plane, the personnel policy, and the code from day one — because after you have 50 clients, retrofitting it is impossible.**
