# Frontend vertical packs

Every business type has one explicit folder and `pack.ts`. A pack declares only
exclusive routes/navigation. Shared billing, inventory and settings screens stay
under `features/core` and are filtered by the server bootstrap capabilities.

Folder names read as trade names and match their twin under
`backend/src/verticals/`. The `businessType` a shop stores does not always match
— it is persisted in `settingsJson` and cannot be renamed without a migration:

| folder / pack id   | stored businessType |
| ------------------ | ------------------- |
| `auto-parts`       | `auto_parts`        |
| `stationery-books` | `stationery`        |
| `furniture-home`   | `furniture`         |
| `beauty-cosmetics` | `cosmetics`         |
| `custom`           | `other`             |

`VerticalId` is the folder name and is routing identity only. Never persist one;
`BusinessType` is the value that goes on a shop.

Rules enforced by tests:

- core never imports a vertical;
- a vertical never imports a sibling vertical;
- every business type is claimed exactly once;
- every pack claims exactly one business type;
- a vertical route must declare its owned path.
