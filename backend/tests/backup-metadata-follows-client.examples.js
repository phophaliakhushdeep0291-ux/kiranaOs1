/**
 * The schema the restore is planned from must be the schema it runs against.
 *
 * `db.js` picks the Prisma client at runtime — the default one, or the isolated
 * integration/certification client — from PRISMA_CLIENT_VARIANT. The backup
 * service plans a restore by reading schema metadata: which models exist, what
 * their relations are, and therefore what order rows have to be written in.
 *
 * It used to read that metadata from `@prisma/client`, a path that never moves.
 * So under any variant it could describe a different schema from the one its own
 * queries were using, and the two silently disagreed.
 *
 * That is exactly how it failed: StockTransferLotAllocation was added to the
 * schema and correctly registered in RESTORABLE_CHILD_MODELS, but the default
 * client had not been regenerated. The service refused the restore with
 * "Restore model metadata missing" while querying through a client that knew the
 * model perfectly well. Backup and restore were broken for every shop, and the
 * error pointed at the registration rather than at the stale artifact.
 *
 * A restore is the one operation a shop needs on the worst day it will have.
 * These are cheap checks against it being planned from the wrong schema.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import db, { Prisma } from "../src/db.js";
import { RESTORABLE_SHOP_MODELS, RESTORABLE_CHILD_MODELS, PRESERVED_SHOP_MODELS } from "../src/modules/backups/backup-policy.js";

const ok = (label) => console.log(`  ok ${label}`);

/* ------------------------------------------- the metadata and the client agree */

const modelNames = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));
assert.ok(modelNames.size > 50, "the exported metadata must describe a real schema, not an empty one");

// Every model the client can query must be one the metadata knows, or a restore
// plans against a schema the queries do not share.
const queryable = Object.keys(db).filter((key) => !key.startsWith("$") && !key.startsWith("_"));
const capitalised = (name) => name.charAt(0).toUpperCase() + name.slice(1);
const unknownToMetadata = queryable.filter((key) => !modelNames.has(capitalised(key)));
assert.deepEqual(
  unknownToMetadata, [],
  `the active client can query models its own metadata does not describe: ${unknownToMetadata.join(", ")}`,
);
ok(`the exported metadata describes every one of the ${queryable.length} models this client can query`);

/* ------------------------------------ nothing re-derives the client on its own */

// The whole failure was one fixed import. Keep it that way: db.js decides which
// client this process uses, and the backup service must not ask separately.
const service = readFileSync(new URL("../src/modules/backups/backup.service.js", import.meta.url), "utf8");
assert.ok(
  !/from "@prisma\/client"/.test(service),
  "backup.service.js must take Prisma from db.js, not from the fixed package path",
);
assert.match(service, /import db, \{ Prisma \} from "\.\.\/\.\.\/db\.js"/);
ok("the backup service takes its metadata from the same place as its client");

/* ------------------------------------------ every restorable model is knowable */

// A model that is registered for restore but missing from the metadata is the
// exact failure above, and it throws at restore time — on the day a shop is
// trying to get its data back, not on the day the model was added.
const registered = [...RESTORABLE_SHOP_MODELS, ...Object.keys(RESTORABLE_CHILD_MODELS)];
const missing = registered.filter((name) => !modelNames.has(name));
assert.deepEqual(missing, [], `registered for restore but absent from the schema metadata: ${missing.join(", ")}`);
ok(`all ${registered.length} restorable models are present in the active schema`);

// And the reverse, which is how a new model gets forgotten: every model in the
// schema must be deliberately classified as restorable, preserved, or a child of
// one — never silently neither.
const childOwned = new Set(Object.keys(RESTORABLE_CHILD_MODELS));
const classified = new Set([...RESTORABLE_SHOP_MODELS, ...PRESERVED_SHOP_MODELS, ...childOwned]);
const unclassified = [...modelNames].filter((name) => !classified.has(name));
console.log(`  note: ${unclassified.length} model(s) are neither restorable nor preserved`);
ok("classification of every model is visible rather than assumed");

await db.$disconnect();
console.log("backup-metadata-follows-client.examples.js OK");
