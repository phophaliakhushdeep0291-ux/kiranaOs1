// Kept separate from the cache index so importing the architecture root never
// initializes queue infrastructure as a side effect.
export * from "../../lib/queue.js";
