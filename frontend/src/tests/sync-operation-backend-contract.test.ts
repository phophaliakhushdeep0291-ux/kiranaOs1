/**
 * Every op the till queues must be one the server actually handles.
 *
 * `backendOperationTypeFor` passes unmapped names straight through, and the server's
 * dispatch ends in `default: throw new AppError("Unsupported sync event type")`. So an
 * op missing from BACKEND_OPERATION_TYPE_MAP is posted under a name nothing answers to:
 * it parks at CONFLICT for good while the device shows the change as done, and nothing
 * surfaces to the shop. That is not hypothetical — supplier delete AND supplier restore
 * both shipped that way, and both were found by hand rather than by a test, because the
 * suites around them assert the LOCAL row and the outbox envelope and stop there (one of
 * them mocks `buildOutboxOperation` away entirely, so it could never have seen the name).
 *
 * This reads the two sides from source rather than restating them, so renaming an event
 * on either side turns this red instead of going quiet.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { backendOperationTypeFor, isLocalOnlySyncEvent } from "@/features/core/sync/sync-operation-normalizer";
import type { PendingSyncEvent } from "@/lib/offline/db";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments quote op names in prose; stripping them keeps prose out of the parsed sets. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The op names the outbox can actually hold, read off the union it is typed by. */
function frontendOperationTypes(): string[] {
  const source = withoutComments(read("../features/core/sync/outbox.ts"));
  const union = /export type SyncOutboxOperationType\s*=([\s\S]*?);/.exec(source);
  if (!union) throw new Error("Could not find the SyncOutboxOperationType union in outbox.ts");
  return [...new Set([...union[1].matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]))];
}

/** SYNC_EVENT_TYPES, whose values are what actually travels on the wire. */
function backendEventValues(): Record<string, string> {
  const source = read("../../../backend/src/utils/syncRules.js");
  const values: Record<string, string> = {};
  for (const match of source.matchAll(/^\s*([A-Z_]+):\s*'([^']*)'/gm)) values[match[1]] = match[2];
  return values;
}

/** The events the server's dispatch has a `case` for — anything else hits the throw. */
function backendHandledEvents(): Set<string> {
  const source = read("../../../backend/src/modules/sync/sync.service.js");
  const names = backendEventValues();
  const handled = new Set<string>();
  for (const match of source.matchAll(/case\s+SYNC_EVENT_TYPES\.([A-Z_]+)\s*:/g)) {
    handled.add(names[match[1]] ?? match[1]);
  }
  return handled;
}

const asEvent = (operationType: string) => ({ operation_type: operationType }) as unknown as PendingSyncEvent;

describe("every queued sync op maps to one the backend handles", () => {
  const operationTypes = frontendOperationTypes();
  const handled = backendHandledEvents();
  const pushed = operationTypes.filter((type) => !isLocalOnlySyncEvent(asEvent(type)));

  it("reads both sides of the contract, so the checks below are not vacuous", () => {
    // A source-parsing test that quietly matches nothing passes forever. Pin the shapes.
    expect(operationTypes.length).toBeGreaterThan(30);
    expect(handled.size).toBeGreaterThan(25);
    expect(pushed.length).toBeGreaterThan(25);
    // Sanity: names known to exist on each side.
    expect(operationTypes).toContain("CREATE_BILL");
    expect(handled.has("RESTORE_SUPPLIER")).toBe(true);
  });

  it("leaves nothing queued under a name the server would reject", () => {
    const unhandled = pushed
      .map((type) => ({ type, sentAs: backendOperationTypeFor(asEvent(type)) }))
      .filter((row) => !handled.has(row.sentAs));

    // Named rather than counted: the failure should say which op and what it posts as.
    expect(unhandled).toEqual([]);
  });

  it("never posts a local '_PENDING' spelling to the server", () => {
    // The suffix is a local lifecycle marker. Every backend case is spelled without it,
    // so a "_PENDING" reaching the wire is the exact shape of the two shipped bugs.
    const leaked = pushed
      .map((type) => backendOperationTypeFor(asEvent(type)))
      .filter((sentAs) => sentAs.endsWith("_PENDING"));

    expect(leaked).toEqual([]);
  });

  it("keeps local-only ops off the wire entirely", () => {
    // These have no server handler by design; pushing one would throw as unsupported.
    const localOnly = operationTypes.filter((type) => isLocalOnlySyncEvent(asEvent(type)));

    expect(localOnly).toEqual(expect.arrayContaining(["AUDIT_LOG_APPEND", "UPDATE_SETTINGS"]));
    for (const type of localOnly) expect(handled.has(type)).toBe(false);
  });
});
