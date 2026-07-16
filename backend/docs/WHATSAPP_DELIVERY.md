# WhatsApp delivery receipts

KiranaOS keeps provider API acceptance separate from real delivery:

- `accepted`: the provider API returned a message id; this is not delivery.
- `sent`: a signed provider callback says the message was sent downstream.
- `delivered`: a signed callback confirms delivery to the recipient device.
- `read`: a signed callback confirms a read receipt (when the recipient permits receipts).
- `failed`: the API request or delivery callback reported a terminal failure.

Callbacks are idempotent and monotonic. Late `sent` callbacks cannot regress a `delivered` or `read` record. Signed events are stored without phone numbers or message bodies; an unmatched event stays pending and is reconciled when the worker stores the provider message id.
Processed event proofs are retained for 90 days; unmatched race records expire after 30 days so callback storage remains bounded.

## Required configuration

```env
WHATSAPP_WEBHOOK_PUBLIC_URL=https://api.example.com/api/reminders/webhooks
WHATSAPP_WEBHOOK_SECRET=<at-least-32-random-characters>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<meta-verification-token>
```

`WHATSAPP_WEBHOOK_PUBLIC_URL` is the base. KiranaOS appends `/meta`, `/twilio`, `/gupshup`, or `/interakt`. Production startup rejects HTTP callback URLs.

### Meta Cloud API

Configure `.../webhooks/meta` as the callback URL, set the Meta verification token to `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and set `WHATSAPP_WEBHOOK_SECRET` to the Meta app secret used for `X-Hub-Signature-256`. Subscribe to message status callbacks.

### Twilio

KiranaOS adds a per-message `StatusCallback` URL automatically. `WHATSAPP_API_SECRET` must be the primary Twilio Auth Token because the official Twilio SDK validates `X-Twilio-Signature` using the exact public URL and every form parameter. Do not rewrite or reorder the callback query at the proxy.

### Gupshup

Configure `.../webhooks/gupshup?token=<WHATSAPP_WEBHOOK_SECRET>` for message events. The application logger redacts token query values. Configure the reverse proxy to redact query strings too and use Gupshup's documented source-IP allowlist where available.

### Interakt

Configure `.../webhooks/interakt` and use `WHATSAPP_WEBHOOK_SECRET` as the Interakt webhook Secret Key. KiranaOS verifies the `Interakt-Signature` HMAC over the exact raw JSON bytes.

## Staging proof

1. Send a template reminder to a consenting test number.
2. Confirm history first shows `accepted`, not `sent`.
3. Confirm signed callbacks advance it to `sent`, `delivered`, and optionally `read`.
4. Replay the same callback and verify no duplicate audit/status transition appears.
5. Replay a valid older `sent` callback after `delivered`; status must remain `delivered`.
6. Change one payload byte or signature and verify HTTP 401.
7. Inspect `reminders_accepted_total`, `reminders_sent_total`, `reminders_delivered_total`, `reminders_read_total`, and failure metrics.

Provider references: [Meta WhatsApp Cloud API webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks), [Twilio status callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status), [Gupshup message events](https://docs.gupshup.io/docs/message-events), and [Interakt webhook formats/signatures](https://www.interakt.shop/resource-center/interakts-webhooks-for-customer-messages-sent-template-status/).
