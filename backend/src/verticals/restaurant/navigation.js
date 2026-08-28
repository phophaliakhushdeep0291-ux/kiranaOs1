/**
 * Trade-specific sidebar entries for Restaurant & cafe. The shared spine
 * (dashboard, customers, purchases, money, staff, settings) is composed on by
 * `defineBusinessProfile` and must not be repeated here.
 */
export const navigation = [
  "pos",
  "tables",
  // Dine-in QR orders are accepted from Tables. The generic Orders Received
  // inbox stays out of the restaurant profile until an official marketplace
  // connector (for example Swiggy or Zomato) can add the `orders` key for the
  // connected shop. A generic developer API key is not marketplace proof.
  "kitchen-kot",
  "menu",
  "recipes",
  "inventory",
  "takeaway",
  "delivery",
  "reservations",
];

export default navigation;
