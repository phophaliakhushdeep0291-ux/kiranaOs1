import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checklist = readFileSync(new URL('./frontend-manual-checklist.md', import.meta.url), 'utf8');

const requiredItems = [
  'Add product',
  'Delete product',
  'Restore product from recycle bin',
  'Remove cart item',
  'Restore cart item',
  'Clear cart',
  'Restore cleared cart',
  'Buyer Paid starts equal to bill total',
  'Buyer Paid arrows increase/decrease properly',
  'Buyer Paid never exceeds bill total',
  'Changing quantity updates Buyer Paid to new total',
  'Waived amount appears correctly',
  'Confirm bill stores waived amount',
  'Reports include waived amount',
  'Offline bill goes pending sync',
  'Online reconnect syncs pending bill',
];

for (const item of requiredItems) {
  assert.ok(checklist.includes(item), `Manual checklist missing: ${item}`);
}

console.log('Frontend manual checklist examples passed');
