# Frontend vertical packs

Every business type has one explicit folder and `pack.ts`. A pack declares only
exclusive routes/navigation. Shared billing, inventory and settings screens stay
under `features/core` and are filtered by the server bootstrap capabilities.

Rules enforced by tests:

- core never imports a vertical;
- a vertical never imports a sibling vertical;
- every business type is claimed exactly once;
- every pack claims exactly one business type;
- a vertical route must declare its owned path.
