import { dexieDB, offlineDB } from "@/lib/offline/db";

export type LocalDbHealthStatus = "checking" | "healthy" | "warning" | "problem";

export interface LocalDbHealthCheck {
  name: string;
  status: Exclude<LocalDbHealthStatus, "checking">;
  message: string;
  detail?: string;
}

export interface LocalDbHealthReport {
  status: LocalDbHealthStatus;
  checked_at: string;
  checks: LocalDbHealthCheck[];
}

const CORE_TABLES = ["products", "customers", "bills", "bill_items", "payments", "customer_ledger", "sync_outbox"] as const;

function worstStatus(checks: LocalDbHealthCheck[]): LocalDbHealthStatus {
  if (checks.some((check) => check.status === "problem")) return "problem";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "healthy";
}

export async function runLocalDbHealthCheck(): Promise<LocalDbHealthReport> {
  const checks: LocalDbHealthCheck[] = [];

  if (typeof indexedDB === "undefined") {
    return {
      status: "problem",
      checked_at: new Date().toISOString(),
      checks: [{ name: "Browser storage", status: "problem", message: "IndexedDB is not available in this browser.", detail: "Use a modern Chrome/Edge browser and avoid private/incognito mode for POS billing." }],
    };
  }

  try {
    await dexieDB.open();
    checks.push({ name: "Database open", status: "healthy", message: "Local database opens correctly." });
  } catch (error) {
    return {
      status: "problem",
      checked_at: new Date().toISOString(),
      checks: [{ name: "Database open", status: "problem", message: "Local database could not open.", detail: error instanceof Error ? error.message : String(error) }],
    };
  }

  for (const tableName of CORE_TABLES) {
    try {
      const count = await dexieDB.table(tableName).count();
      checks.push({ name: `Table: ${tableName}`, status: "healthy", message: `${count.toLocaleString("en-IN")} local row${count === 1 ? "" : "s"} readable.` });
    } catch (error) {
      checks.push({ name: `Table: ${tableName}`, status: "problem", message: "Could not read this local table.", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    const pending = await dexieDB.sync_outbox.filter((row) => row.status === "PENDING" || row.status === "FAILED" || row.status === "CONFLICT").count();
    if (pending > 0) {
      checks.push({ name: "Pending cloud backup", status: "warning", message: `${pending.toLocaleString("en-IN")} change${pending === 1 ? "" : "s"} still need cloud backup.` });
    } else {
      checks.push({ name: "Pending cloud backup", status: "healthy", message: "No pending/failed/conflict operations found." });
    }
  } catch (error) {
    checks.push({ name: "Pending cloud backup", status: "problem", message: "Could not read sync queue.", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const draft = await offlineDB.getSetting<unknown>("kirana-os:billing-draft:v1");
    checks.push({ name: "Billing draft", status: draft ? "warning" : "healthy", message: draft ? "An unsaved bill draft exists and can be restored from Billing." : "No unsaved bill draft found." });
  } catch (error) {
    checks.push({ name: "Billing draft", status: "warning", message: "Could not inspect billing draft.", detail: error instanceof Error ? error.message : String(error) });
  }

  return {
    status: worstStatus(checks),
    checked_at: new Date().toISOString(),
    checks,
  };
}
