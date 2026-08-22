import assert from "node:assert/strict";
import { allocateAmountByWeights, allocateInvoiceDiscount, calculateInvoiceGst } from "../src/utils/gst.js";

{
  const allocation = allocateInvoiceDiscount([100, 200, 0.01], 100.01);
  assert.equal(allocation.discount, 100.01);
  assert.deepEqual(allocation.allocations, [33.34, 66.67, 0]);
  assert.deepEqual(allocation.discountedLineTotals, [66.66, 133.33, 0.01]);
  assert.equal(allocation.allocations.reduce((sum, value) => sum + value, 0), 100.01);
}

{
  const result = calculateInvoiceGst([{ lineTotal: 100, gstRate: 18 }], 10, "exclusive");
  assert.equal(result.discountedLineTotals[0], 90);
  assert.equal(result.gst, 16.2);
  assert.deepEqual(result.lineGst, [16.2]);
}

{
  const allocation = allocateAmountByWeights([16.2, 5, 0], 32.41);
  assert.deepEqual(allocation, [24.77, 7.64, 0]);
  assert.equal(allocation.reduce((sum, value) => sum + value, 0), 32.41);
}

{
  const result = calculateInvoiceGst([{ lineTotal: 118, gstRate: 18 }], 11.8, "inclusive");
  assert.equal(result.discountedLineTotals[0], 106.2);
  assert.equal(result.gst, 16.2);
}

{
  const result = calculateInvoiceGst([{ lineTotal: 100, gstRate: 18 }], 150, "exclusive");
  assert.equal(result.discount, 100);
  assert.equal(result.discountedLineTotals[0], 0);
  assert.equal(result.gst, 0);
}

console.log("GST invoice discount examples passed");
