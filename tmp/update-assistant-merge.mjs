import fs from 'node:fs';
const path = 'frontend/src/features/core/billing/pages/BillingPage.tsx';
let s = fs.readFileSync(path, 'utf8');
const start = s.indexOf('  function mergeAssistantLines(lines: StagedBillLine[]): number {');
const end = s.indexOf('  function addVoiceDraftToCart()',start);
if (start < 0 || end < 0) throw Error('Assistant merge anchors unavailable');
s = s.slice(0,start) + `  function mergeAssistantLines(lines: StagedBillLine[]): number {
    const resolved = mergeAssistantCart([], lines, productById).applied;
    if (!resolved.length) return 0;
    setCart(previous => mergeAssistantCart(previous, resolved, productById).cart);
    for (const line of resolved) {
      rememberRecentProduct(line.productId);
      trackEvent(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: line.productId, productName: line.name, via: "assistant" });
    }
    if (billingStartedAtRef.current === null) billingStartedAtRef.current = Date.now();
    return resolved.length;
  }

` + s.slice(end);
fs.writeFileSync(path,s);
