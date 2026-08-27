// Used only by the guarded, isolated DB test runner. No fixture routes are
// installed in the application and no real restaurant data is touched.
if (process.env.NODE_ENV !== "test" || process.env.FORCE_DB_TESTS !== "true") {
  throw new Error("Run this fixture with scripts/run-db-example-tests.js");
}
const { default: db } = await import("../src/db.js");
const { default: app } = await import("../src/app.js");
const { productData } = await import("./integration/factories.js");
const { createServer } = await import("node:http");
await db.shop.create({ data: { id: "http-test-shop", name: "HTTP Test Restaurant", ownerName: "Test Owner", city: "Test", address: "Test",
  settingsJson: JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" }, restaurant: { dineIn: { guestOrders: true, cancellationWindowMinutes: 5 } } }),
} });
await db.restaurantTable.create({ data: { id: "http-test-table", shopId: "http-test-shop", code: "t1", name: "T1" } });
await db.product.create({ data: { ...productData("http-test-shop", { name: "Test Dosa", defaultPricePerRateUnit: 120 }), id: "http-test-dish", menuCourse: "Mains", menuAvailable: true } });
// Fixture-only controls live on this loopback test server, never in app routes.
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/__fixture/state") return app(request, response);
  try {
    let body = "";
    for await (const chunk of request) { body += chunk; if (body.length > 4096) throw new Error("Fixture payload too large"); }
    const state = JSON.parse(body);
    if (state.orderId) {
      const update = {};
      if (["new", "accepted", "ready", "fulfilled", "cancelled"].includes(state.status)) update.status = state.status;
      if (["unpaid", "paid"].includes(state.paymentStatus)) update.paymentStatus = state.paymentStatus;
      await db.customerOrder.updateMany({ where: { shopId: "http-test-shop", id: state.orderId }, data: update });
    } else {
      await db.shop.update({ where: { id: "http-test-shop" }, data: { settingsJson: JSON.stringify({ customerOrdering: { enabled: true }, businessProfile: { businessType: "restaurant" }, restaurant: { brand: state.brand ?? {}, dineIn: { guestOrders: state.guestOrders !== false, cancellationWindowMinutes: 5 } } }) } });
      await db.product.update({ where: { id: "http-test-dish" }, data: { foodType: state.foodType ?? "veg", prepMinutes: null } });
    }
    response.writeHead(200, { "content-type": "application/json" }); response.end('{"ok":true}');
  } catch (error) { response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error.message })); }
}).listen(4399, "127.0.0.1", () => console.log("DineIn HTTP fixture ready on 4399"));
const stop = () => server.close(() => { void db.$disconnect().then(() => process.exit(0)); });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
