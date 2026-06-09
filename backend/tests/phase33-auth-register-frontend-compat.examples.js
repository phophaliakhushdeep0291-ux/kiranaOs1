import assert from "assert/strict";
import { registerSchema, loginSchema, normalizeIndianMobile } from "../src/modules/auth/auth.schema.js";

assert.equal(normalizeIndianMobile("+91 98765-43210"), "9876543210");
assert.equal(normalizeIndianMobile("91 98765 43210"), "9876543210");

const parsed = registerSchema.parse({
  shopName: "  Khushdeep Store  ",
  ownerName: " Khushdeep ",
  city: " Jodhpur ",
  address: " Main Market Jodhpur ",
  mobile: "+91 98765 43210",
  password: "123456",
  ownerPin: "1234",
});

assert.equal(parsed.shopName, "Khushdeep Store");
assert.equal(parsed.ownerName, "Khushdeep");
assert.equal(parsed.mobile, "9876543210");
assert.equal(parsed.ownerPin, "1234");

const login = loginSchema.parse({ mobile: "91-98765-43210", password: "123456" });
assert.equal(login.mobile, "9876543210");

assert.equal(registerSchema.safeParse({
  shopName: "A",
  ownerName: "Khushdeep",
  city: "Jodhpur",
  address: "Main Market Jodhpur",
  mobile: "12345",
  password: "123456",
  ownerPin: "1234",
}).success, false);

console.log("Phase 33 auth register frontend compatibility examples passed");
