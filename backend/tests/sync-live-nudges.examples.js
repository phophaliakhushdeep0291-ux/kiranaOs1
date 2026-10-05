import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import express from "express";
import compression from "compression";
import {
  MAX_STREAMS_PER_DEVICE,
  MAX_STREAMS_PER_SHOP,
  NUDGE_COALESCE_MS,
  announceShopChanges,
  announceShopChangesAfterWrite,
  closeAllLiveStreams,
  liveStreamStats,
  openLiveStream,
  streamShopChanges,
} from "../src/modules/sync/sync-live.js";

// Two-counter QA run: an idle till pulls every 45s, so a sale on counter A took
// 9–36s to reach counter B. The live stream lets the server tell the shop's other
// devices to pull the moment a change commits. These checks pin who is told, when,
// and that the stream really streams through compression().

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(NUDGE_COALESCE_MS + 60);

function recorder(deviceId, shopId = "shop-1") {
  const received = [];
  let closed = false;
  const live = openLiveStream(shopId, deviceId, {
    send: (event, data) => received.push({ event, data }),
    close: () => { closed = true; },
  });
  return { live, received, isClosed: () => closed };
}

// 1) The device that made the change is not told about it; the others are, once
//    per burst however many writes the burst held.
{
  const a = recorder("dev-A");
  const b = recorder("dev-B");
  announceShopChanges("shop-1", "dev-A");
  announceShopChanges("shop-1", "dev-A");
  announceShopChanges("shop-1", "dev-A");
  await settle();
  assert.equal(a.received.length, 0, "the originating counter already has its own change");
  assert.equal(b.received.length, 1, "a burst of writes is one nudge, not three pulls");
  assert.equal(b.received[0].event, "changes");
  assert.deepEqual(Object.keys(b.received[0].data), ["at"], "a nudge carries no shop data");
  closeAllLiveStreams();
}

// 2) Both counters changed data in the same burst: each must pull the other's.
{
  const a = recorder("dev-A");
  const b = recorder("dev-B");
  announceShopChanges("shop-1", "dev-A");
  announceShopChanges("shop-1", "dev-B");
  await settle();
  assert.equal(a.received.length, 1);
  assert.equal(b.received.length, 1);
  closeAllLiveStreams();
}

// 3) A write without a device header cannot be attributed, so everyone pulls.
{
  const a = recorder("dev-A");
  announceShopChanges("shop-1", null);
  await settle();
  assert.equal(a.received.length, 1);
  closeAllLiveStreams();
}

// 4) Shops never hear about each other.
{
  const mine = recorder("dev-A", "shop-1");
  const theirs = recorder("dev-X", "shop-2");
  announceShopChanges("shop-1", "dev-B");
  await settle();
  assert.equal(mine.received.length, 1);
  assert.equal(theirs.received.length, 0, "a nudge is scoped to the shop that changed");
  closeAllLiveStreams();
}

// 5) A reloaded tab's lingering stream is replaced, not stacked; a shop is capped.
{
  const streams = Array.from({ length: MAX_STREAMS_PER_DEVICE + 1 }, () => recorder("dev-A"));
  assert.equal(streams[0].isClosed(), true, "the oldest stream of a device is closed when it reconnects");
  assert.equal(streams.at(-1).isClosed(), false);
  assert.equal(liveStreamStats().streams, MAX_STREAMS_PER_DEVICE);
  closeAllLiveStreams();

  for (let i = 0; i < MAX_STREAMS_PER_SHOP; i += 1) assert.equal(recorder(`dev-${i}`).live.ok, true);
  const refused = recorder("dev-overflow");
  assert.equal(refused.live.ok, false);
  assert.equal(refused.live.reason, "LIVE_STREAM_LIMIT");
  assert.equal(recorder("dev-0").live.ok, true, "a device already holding a stream may still replace it");
  closeAllLiveStreams();
}

// 6) Released and shut-down streams leave nothing behind.
{
  const a = recorder("dev-A");
  a.live.release();
  assert.deepEqual(liveStreamStats(), { shops: 0, streams: 0 });
  const b = recorder("dev-B");
  closeAllLiveStreams();
  assert.equal(b.isClosed(), true, "shutdown ends open streams instead of waiting on them");
  assert.deepEqual(liveStreamStats(), { shops: 0, streams: 0 });
}

// 7) The REST hook nudges only for a successful write to a shop's data.
{
  function run(method, statusCode, shopId = "shop-1") {
    const res = Object.assign(new EventEmitter(), { statusCode });
    const req = { method, shopId: undefined, get: (name) => (name === "x-device-id" ? "dev-A" : undefined) };
    announceShopChangesAfterWrite(req, res, () => {});
    req.shopId = shopId; // set later by requireShop inside the router
    res.emit("finish");
  }
  const b = recorder("dev-B");
  run("GET", 200);
  run("POST", 422);
  run("POST", 201, null);
  await settle();
  assert.equal(b.received.length, 0, "reads, refusals and shop-less writes are not changes");
  run("PATCH", 200);
  await settle();
  assert.equal(b.received.length, 1, "a successful write nudges the other counters");
  closeAllLiveStreams();
}

// 8) Over real HTTP, through compression(): headers arrive at once, the stream is
//    not gzip-buffered, and a change reaches the other device within the window.
{
  const app = express();
  app.use(compression());
  app.use((req, _res, next) => {
    req.shopId = "shop-http";
    req.device = { deviceId: req.get("x-device-id") };
    next();
  });
  app.get("/events", streamShopChanges);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const url = `http://127.0.0.1:${server.address().port}/events`;

  async function open(deviceId) {
    const controller = new AbortController();
    const response = await fetch(url, { headers: { "x-device-id": deviceId, "accept-encoding": "gzip" }, signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = async (needle, ms = 2_000) => {
      const deadline = Date.now() + ms;
      while (!text.includes(needle)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        const chunk = await Promise.race([reader.read(), wait(remaining).then(() => null)]);
        if (!chunk || chunk.done) return text.includes(needle);
        text += decoder.decode(chunk.value, { stream: true });
      }
      return true;
    };
    return { response, until, text: () => text, close: () => controller.abort() };
  }

  const counterA = await open("dev-A");
  const counterB = await open("dev-B");
  assert.equal(counterB.response.status, 200);
  assert.match(counterB.response.headers.get("content-type"), /^text\/event-stream/);
  assert.equal(counterB.response.headers.get("content-encoding"), null, "compression must not buffer the stream");
  assert.equal(await counterB.until("event: ready"), true, "the stream announces itself without waiting for a change");

  const startedAt = Date.now();
  announceShopChanges("shop-http", "dev-A");
  assert.equal(await counterB.until("event: changes"), true, "counter B is told to pull");
  assert.ok(Date.now() - startedAt < 1_000, "within the coalescing window, not the 45s cadence");
  assert.equal(await counterA.until("event: changes", 400), false, "counter A is not told about its own sale");

  counterA.close();
  counterB.close();
  await wait(100);
  assert.deepEqual(liveStreamStats(), { shops: 0, streams: 0 }, "a closed connection releases its stream");
  closeAllLiveStreams();
  await new Promise((resolve) => server.close(resolve));
}

console.log("sync live nudges: all checks passed");
