# Conversational voice tasks

The full Assistant accepts typed requests and recorded speech through the existing server transcription endpoint. Recent turns provide context for follow-up answers. Read-only questions run immediately. Changes produce a numbered, reviewable plan; `confirm`, `go ahead`, `haan kar do` or `हाँ कर दो` approve the displayed plan. `cancel`, `mat karo` or `नहीं` decline it. Mixed answers such as “yes, but make it 50” are new instructions, never approvals. Price/stock actions still require the owner's PIN in the private PIN field; the microphone and chat input are disabled during PIN entry.

The floating voice shortcut now hands business questions and mutations to the full Assistant when that module is enabled and the device is online. Navigation, search and local sync counts keep their existing fast path. Billing hands non-cart tasks and clarification into the full conversation. Existing manual/local draft workflows remain available without a model connection.

## Product listing and creation

- Existing products: `search_products` supports an empty search for a catalogue listing. It reports the match count and returns at most 25 records, with truncation stated.
- New products: owner/admin accounts with `basic_products` may propose `create_product`. Required details are exact name, unit, selling price, cost price, opening stock and tax percentage. The assistant asks for missing fields rather than defaulting financial values to zero. Optional barcode and category appear in the confirmation.
- Supported simple units: piece, kg, gram, litre and ml. Prices stay per selling unit; opening stock converts to base units once (2.5 kg becomes 2500 grams). Packs, variants and medicine configuration use the existing Products form.
- The server checks scope, current role/entitlement, PIN and duplicate names before delivering a client action. The till validates it and saves through `createProductLocalFirst`, including existing duplicate-name/code guards, audit and outbox. Confirmation itself is not a server-side product creation.
- A receipt keyed by plan and action is committed in the same IndexedDB transaction as product/audit/outbox. Re-delivery does not create another product. The visible result says saved on the device and queued for sync, not accepted by the server.

## Reliability

A clarification discards every proposal in that incomplete turn. Identical provider proposals are deduplicated. Corrections reject the old pending plan before asking for a replacement. Confirmation stays single-use server-side; uncertain results are not automatically retried. Execution outcomes enter conversation history so later questions have context. An optional read-aloud toggle uses the browser's speech synthesis; listening cancels speech output. Closing/cancelling recording suppresses late transcripts.

The app-shell lazy import now names `Layout.tsx` explicitly. Sharing assistant code changed Rollup's chunks and exposed an ambiguous `index` fallback in the offline manifest. Both service-worker stamping and offline-boot validation now resolve the named layout entry; no offline-cache gate was relaxed.

## Conversation recovery (12 October)

Closing and reopening the main Assistant in the same tab now restores recent messages, the unsent draft, the pending proposal and its outcome. Memory is scoped to the login session, shop, user and role. Ordinary access/refresh-token rotation keeps the conversation; logout or a new login disposes it and prevents late callbacks from repopulating it. The conversation is held in memory only, bounded to 40 displayed messages and 2,000 draft characters. Reopening after 30 minutes without an update clears it; reloading the tab also clears it. The private owner-PIN field is never part of this memory and must be re-entered after reopening.

The inline billing panel remains local to its mount because it has no stable bill ID to bind a restored action to. It must not restore a previous bill's proposal onto a new cart. An execution in progress remains blocked when the main panel remounts. Local action delivery rechecks the session between actions, and an interrupted confirmation is reported as uncertain instead of replayed automatically.

Corrections require an acknowledged cancellation of the previous plan. A lost cancellation response retains the correction draft and reports the cancellation failure. An already-resolved plan stops the replacement request and records an uncertain outcome in conversation history. Recent history sent to the API is limited to 12 messages of 4,000 characters each, including proposal summaries; older context is not unlimited model memory.

The browser recovery fixture verified closing/reopening at the clarification, draft, proposal, PIN and completed stages. It changed the selling price from 64.5 to 70, verified that cancellation preceded the replacement request, then saved one synthetic product with 2,500 grams of stock and one CREATE_PRODUCT outbox event. The entered synthetic PIN did not return after reopening. This uses the actual panel, launcher and local product pipeline with scripted API responses, not a live model or microphone.

## Verification and limits

Backend task tests exercise required arguments, multi-turn context, clarification blocking, duplicate proposals, role/feature/PIN/tenant checks, repeat confirmation, and exact unit conversion. Frontend tests exercise local product/outbox atomicity, receipt replay and concurrent delivery, write failures, unknown actions, explicit decision phrases, and cancelled-transcription callbacks. A browser fixture exercised clarification → Hinglish confirmation → PIN → real IndexedDB product/outbox save; it created exactly one test product (2500 grams, price 64.5 per kg) and one CREATE_PRODUCT operation.

The browser fixture and deterministic tests use scripted provider responses. They prove application behavior, not recognition or model accuracy for every phrase, accent or language. Live microphone/provider acceptance testing remains necessary on the intended shop devices. Broad interpretation/transcription requires a working provider connection; this is an assistant for registered app actions, not unrestricted autonomous access to every app feature. No production configuration, provider secrets or live shop records were changed.

Release checks completed locally: backend `test:ai-safety` and `prod:check` passed. Frontend `prod:check` passed with 3,507 tests and one existing skip, including typecheck, translation parity, production build, bundle budget and offline boot coverage. The billing variant uses the current cart callback instead of the navigation staging queue. Product delivery also rejects a shop change during its asynchronous local checks.

Recovery regressions cover token rotation, logout/new-login disposal, shop/user/role separation, late callbacks, expiry, pending-execution recovery, bounded history, cancellation failure, and session changes between delivered actions. The 12 October frontend release gate passed in full. Backend source did not change in this follow-up; the previous full CI certification also passed.
