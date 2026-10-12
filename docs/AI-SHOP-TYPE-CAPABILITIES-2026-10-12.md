# Assistant abilities by shop type — 12 October 2026

Each of KiranaOS's twelve registered business types now owns reviewed assistant context, English/Hindi example questions and specialist clarification fields in its own vertical directory. The shared assistant uses that context together with the live permitted tool registry. This is a shared assistant engine with trade-specific capabilities, not twelve separately trained models.

The capabilities endpoint reads the shop type from the authenticated shop's stored settings. It does not accept a client-selected trade or tenant. The UI requests capabilities only when the assistant opens, then shows the current trade's title and up to three permitted example questions. A failed capability request falls back to generic read questions; it never advertises a product-creation action to a pharmacy or read-only user.

## Per-type record access

The table describes the specialized records the assistant can read, subject to role and feature access. Core stock/sales/credit reads and the nine existing confirmed change tools remain shared where available. A register summary does not establish an individual item's status when that detail was not returned.

| Assistant | Reviewed reads | Example question |
| --- | --- | --- |
| Auto-parts assistant | Fitment coverage and part references, Stock health | Show my vehicle fitment register summary |
| Cosmetics assistant | Counter testers and replacement status, Stock health | Show my counter tester summary |
| Clothing assistant | Rental bookings, pickups and returns, Stock health | Show my rental register summary |
| Business assistant | Sales reports, Stock health, Outstanding credit | Show sales for today |
| Electronics assistant | Serial units, warranty and service register, Stock health | Show my serial and warranty register summary |
| Footwear assistant | Size runs and pair stock, Stock health | Show my footwear size-run summary |
| Furniture assistant | Quotations, advances and delivery status, Stock health | Show my furniture order-book summary |
| Grocery assistant | Stock health, Outstanding credit, Sales reports | Show my stock health |
| Manufacturing assistant | Production runs and quality holds, Stock health | Show my production and quality overview |
| Pharmacy assistant | Prescription register and dispensing status, Stock health | Show my prescription register summary |
| Restaurant assistant | Table occupancy, Kitchen ticket status, Menu and dish availability | Which restaurant tables are free? |
| Books and stationery assistant | School, class and book-list coverage, Stock health | Show my school book-list summary |

## Behavior and boundaries

- Trade tools remain registered under their own business type. The capability reply and suggested questions are filtered by actual available tools, role and feature access. Adding profile text does not grant a tool or permission.
- Reviewed example questions can run their exact read tool without a model call on a new conversation. Required arguments, role, feature and trade checks still run. Compound requests and follow-ups retain the normal agent path.
- Missing details can use reviewed questions for variants, rentals, vehicles, serial/IMEI units, prescription references, school/class/year, order references, testers, tables, tickets, dishes and production runs. These questions collect a target; they do not promise an unsupported edit.
- Trade context explicitly distinguishes rental deposits from sales, planned output from received stock, quotations from settled orders, testers from saleable stock, and kitchen tickets from paid bills. Pharmacy help stays within business operations and recorded prescription status.
- The main conversation is also scoped by shop type. When the type changes, old memory/proposals are not shown in the new context. New server plans record their originating type; confirmation under a different type fails before any action runs. Older stored plans without that field keep existing tool-level checks.
- Specialist writes remain in their forms: rentals, prescriptions/dispensing, footwear size runs, fitment edits, serial/service updates, book lists, furniture orders, testers, restaurant operations and manufacturing transitions. Existing workflow buttons remain explicitly manual handoffs. This change does not add specialist autonomous writers or offline language understanding.

## Verification

- Backend AI safety suite passes, including a matrix of 12 shop types × 4 roles × enabled/disabled features. Tests verify English/Hindi metadata, exact read routing, available-tool filtering, absence of other trades' tools, grounded rendering of real scoped service results, specialist clarification fields, server-owned identity and trade-change rejection.
- All 23 business-profile and vertical architecture tests pass. Backend production checks pass.
- Full frontend production check passes: TypeScript, translations, build, bundle/offline checks, 3,537 passing tests and one existing skip.
- Synthetic browser verification opened every assistant type. Restaurant showed tables/kitchen/menu questions; pharmacy showed prescription/stock questions, while a pharmacy viewer saw stock only. Capability fixture responses were generated from the real backend tool registry; no live shop or provider was used.
- Live provider and microphone accuracy on intended devices remains an acceptance step. No claim of understanding every phrase, accent or language is made. The change remains on the existing assistant PR until merged and deployed.
