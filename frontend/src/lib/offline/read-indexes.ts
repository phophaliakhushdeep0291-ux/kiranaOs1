type Row = Record<string, unknown>;

const CUSTOMER_REFERENCE_FIELDS = ["customerId", "customer_id", "serverCustomerId", "server_customer_id", "localCustomerId", "local_customer_id"];

export function firstString(row: Row, fields: string[], trim = false): string | undefined {
  for (const field of fields) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return trim ? value.trim() : value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
}

export function customerReadIdentityKeys(row: Row): string[] {
  return [row.id, row.local_id, row.localId, row.server_id, row.serverId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function customerReference(row: Row): string | undefined {
  return firstString(row, CUSTOMER_REFERENCE_FIELDS, true);
}

/** Mirrors the bill display's identity rules, including older field spellings. */
export function billReadIdentityKeys(row: Row): string[] {
  return [
    ["id"], ["server_id", "serverId"], ["local_id", "localId"],
    ["merged_into_id", "mergedIntoId"], ["localBillId", "local_bill_id"],
    ["clientBillId", "client_bill_id"], ["idempotency_key", "idempotencyKey"],
    ["uniqueBillId", "unique_bill_id"],
  ].map((fields) => firstString(row, fields)).filter((value): value is string => Boolean(value));
}

/** Derived read keys only. The original business fields remain authoritative. */
export function offlineReadIndexes(table: string, row: Row): Row {
  if (table === "customers") return {
    _read_customer_ids: customerReadIdentityKeys(row),
  };
  if (table === "id_mappings") return {
    _read_mapping_ids: [firstString(row, ["local_id", "localId"], true), firstString(row, ["server_id", "serverId"], true)]
      .filter((value): value is string => Boolean(value)),
  };
  if (table === "local_audit_logs") return {
    _read_audit_customer_ids: [String(row.entity_id ?? ""), String(row.customerId ?? row.customer_id ?? "")].filter(Boolean),
  };
  if (["customer_ledger", "payments", "bills"].includes(table)) {
    const reference = { _read_customer_id: customerReference(row) ?? "" };
    if (table !== "bills") return reference;
    const time = new Date(String(row.createdAt ?? row.created_at ?? "")).getTime();
    return { ...reference, _read_bill_ids: billReadIdentityKeys(row), _read_created_at: Number.isFinite(time) ? time : 0 };
  }
  return {};
}

/** Build customer-only bidirectional links once for a snapshot. */
export function customerIdentityGraph(mappings: Record<string, unknown>[], trim = true) {
  const links = new Map<string, Set<string>>();
  const value = (row: Row, fields: string[]) => trim ? firstString(row, fields, true)
    : fields.map((field) => row[field]).find((raw): raw is string => typeof raw === "string" && raw.length > 0);
  for (const row of mappings) {
    const type = String(row.entity_type ?? row.entityType ?? "");
    if (type && type !== "customer" && type !== "customers") continue;
    const local = value(row, ["local_id", "localId"]), server = value(row, ["server_id", "serverId"]);
    if (!local || !server) continue;
    if (!links.has(local)) links.set(local, new Set());
    if (!links.has(server)) links.set(server, new Set());
    links.get(local)!.add(server); links.get(server)!.add(local);
  }
  return (seed: Iterable<string>): Set<string> => {
    const ids = new Set(seed), frontier = [...ids];
    for (let i = 0; i < frontier.length; i++) for (const linked of links.get(frontier[i]) ?? []) {
      if (!ids.has(linked)) { ids.add(linked); frontier.push(linked); }
    }
    return ids;
  };
}
