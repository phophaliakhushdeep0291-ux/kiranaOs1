import assert from "node:assert/strict";
import { todayRangeQuery } from "./integration/setup.js";

const afterMidnightInIndia = new Date("2026-06-06T18:31:00.000Z");
const indiaQuery = new URLSearchParams(todayRangeQuery(afterMidnightInIndia, "Asia/Kolkata"));

assert.equal(indiaQuery.get("from"), "2026-06-07");
assert.equal(indiaQuery.get("to"), "2026-06-07");

const utcQuery = new URLSearchParams(todayRangeQuery(afterMidnightInIndia, "UTC"));
assert.equal(utcQuery.get("from"), "2026-06-06");
assert.equal(utcQuery.get("to"), "2026-06-06");

console.log("Integration today-range timezone examples passed");
