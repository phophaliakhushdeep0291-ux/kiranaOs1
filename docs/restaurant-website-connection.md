# Connect a restaurant's QR codes to DineIn

## Deploy first

Deploy both the KiranaOS backend (public catalog branding export) and frontend
(Menu Branding setting, QR generation and legacy redirects). No database
migration is required: the URL is stored in the shop's existing settings JSON.
Do not remove the shared customer-order pages; unconfigured shops still use them.

## Activate for the correct shop

Sign in as the owner of **KRN-5JSVS3** (shop ID
`cmsg1iw0x002p1bsy515jsvs3`). Open Restaurant Menu > Menu Branding and set
**Restaurant website URL** to:

`https://dinein-production.up.railway.app/r/my-restaurant`

Preview the destination, then Save while online. Do not print replacement QR
codes if the save reports failure. This is a per-shop setting, not a global
Vercel/Railway environment change. The implementation does not automatically
modify a live owner's settings or assume that another signed-in shop is this one.

## Behaviour

- New shop-wide QR codes open the configured `/r/my-restaurant` URL.
- New table codes open `/r/my-restaurant/t/<encoded-table-code>`.
- Existing `/order/<shop>` and `/t/<shop>` links obtain the current public catalog
  and redirect only if this is a restaurant with an approved destination.
- Existing `/t/<shop>/<table>` links and `?table=<code>` links preserve the table.
- Query-string redirect destinations are never trusted or forwarded.
- Offline cached catalogs do not trigger redirects; this prevents a stale cached
  address from overriding a subsequently disabled website setting.
- Removing the URL and saving an empty value disables redirects for old POS links.
  QR codes printed directly to DineIn remain direct links and would need replacing
  if DineIn is later retired.
- Old printed POS QR codes need not be replaced while the POS host remains live.

## Verify before customer use

1. Check the public catalog includes `storefront.branding.websiteUrl` for this shop.
2. Scan an existing shop QR: confirm it reaches `/r/my-restaurant`.
3. Scan an existing table QR: confirm the same table appears in DineIn.
4. Confirm a different, unconfigured shop still opens the original frontend.
5. Confirm the browse-only page cannot place a table order without a valid table QR.

Existing orders/carts stored in the old frontend are not migrated. Complete active
guest sessions before activating the new website. No payment credentials are copied.
