import type { CustomerWithLedger } from "@/features/core/customers/customer-ledger-data";

const DEVANAGARI: Record<string, string> = Object.fromEntries([
  ["0905","a"],["0906","aa"],["0907","i"],["0908","ee"],["0909","u"],["090a","oo"],["090f","e"],["0910","ai"],["0913","o"],["0914","au"],
  ["0915","k"],["0916","kh"],["0917","g"],["0918","gh"],["091a","ch"],["091b","chh"],["091c","j"],["091d","jh"],["091f","t"],["0920","th"],["0921","d"],["0922","dh"],
  ["0924","t"],["0925","th"],["0926","d"],["0927","dh"],["0928","n"],["092a","p"],["092b","ph"],["092c","b"],["092d","bh"],["092e","m"],["092f","y"],["0930","r"],["0932","l"],["0935","v"],["0936","sh"],["0937","sh"],["0938","s"],["0939","h"],
  ["093e","a"],["093f","i"],["0940","ee"],["0941","u"],["0942","oo"],["0947","e"],["0948","ai"],["094b","o"],["094c","au"],["0902","n"],["0901","n"],["094d",""]
].map(([code, latin]) => [String.fromCodePoint(Number.parseInt(code, 16)), latin]));

export function normalizeUdharSearch(value: unknown): string {
  return String(value ?? "").normalize("NFKD").toLowerCase().split("").map((char) => DEVANAGARI[char] ?? char).join("").replace(/[^a-z0-9\u0900-\u097f]+/g, " ").replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u").trim();
}

export function customerUdharSearchText(customer: CustomerWithLedger): string {
  const row = customer as Record<string, unknown>;
  const aliases = Array.isArray(row.aliases) ? row.aliases : [];
  return [customer.name, customer.mobile, row.phone, ...aliases].map(normalizeUdharSearch).join(" ");
}

export function customerMatchesUdharSearch(customer: CustomerWithLedger, query: string): boolean {
  const needle = normalizeUdharSearch(query);
  return !needle || customerUdharSearchText(customer).includes(needle);
}
