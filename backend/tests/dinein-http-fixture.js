// Used only by the guarded, isolated DB test runner. No fixture routes are
// installed in the application and no real restaurant data is touched.
if (process.env.NODE_ENV !== "test" || process.env.FORCE_DB_TESTS !== "true") {
  throw new Error("Run this fixture with scripts/run-db-example-tests.js");
}
const { default: db } = await import("../src/db.js");
const { default: app } = await import("../src/app.js");
const { productData } = await import("./integration/factories.js");
await db.shop.create({ data: { id: "http-test-shop", name: "HTTP Test Restaurant", ownerName: "Test Owner", city: "Test", address: "Test",
  settingsJson: JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" }, restaurant: { dineIn: { guestOrders: true, cancellationWindowMinutes: 5 } } }),
} });
await db.restaurantTable.create({ data: { id: "http-test-table", shopId: "http-test-shop", code: "t1", name: "T1" } });
await db.product.create({ data: { ...productData("http-test-shop", { name: "Test Dosa", defaultPricePerRateUnit: 120 }), id: "http-test-dish", menuCourse: "Mains", menuAvailable: true } });
const server = app.listen(4399, "127.0.0.1", () => console.log("DineIn HTTP fixture ready on 4399"));
const stop = () => server.close(() => { void db.$disconnect().then(() => process.exit(0)); });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
