# Fair Play Football Email Notifications Spec

## Purpose

The transactional email system should send clear, reliable emails for key player booking events without changing the current booking, payment, SumUp, waiting-list, auth, or database behavior.

This document is a planning spec only. It does not implement email sending.

## Recommended Provider

Use Resend for the first implementation.

Reasons:

- Simple server-side API for Next.js.
- Good fit for transactional emails.
- Supports verified sending domains.
- Supports HTML, text, and React-based templates.
- Supports idempotency headers for duplicate prevention.

## Required Environment Variables

Required:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `NEXT_PUBLIC_SITE_URL`

Recommended:

- `EMAIL_REPLY_TO`
- `EMAIL_DRY_RUN`

Example values:

```bash
RESEND_API_KEY=
EMAIL_FROM="Fair Play Football <bookings@fairplayfootball.example>"
EMAIL_REPLY_TO="Fair Play Football <support@fairplayfootball.example>"
NEXT_PUBLIC_SITE_URL="https://fairplayfootball.example"
EMAIL_DRY_RUN=false
```

## Email Events

### 1. `booking_confirmed`

Sent when a player payment has succeeded and a booking has been created or confirmed.

Trigger point:

- `lib/sumupPayments.ts`
- Inside `finalizeCheckoutPayment()`
- After `booking_payments.payment_status` is set to `paid`
- After `booking_payments.booking_id` is written

Recipient:

- The authenticated player attached to the paid booking/payment.

Subject line:

- `Booking confirmed: {{game_title}}`

Required data:

- Player email
- Player name
- Game title
- Game location
- Game time
- Game price
- Booking id
- Payment id
- Checkout id or checkout reference
- Site URL

### 2. `booking_cancelled_by_player`

Sent when a player leaves/cancels their own confirmed booking.

Trigger point:

- `app/api/bookings/[id]/route.ts`
- After the booking delete succeeds
- Before returning `{ ok: true }`

Recipient:

- The authenticated player who cancelled the booking.

Subject line:

- `Booking cancelled: {{game_title}}`

Required data:

- Player email
- Player name
- Game title
- Game location
- Game time
- Booking id
- Related payment id if available
- Cancellation timestamp
- Site URL

### 3. `waiting_list_spot_available`

Sent when a space may be available for a player on the waiting list.

Trigger point:

- `lib/waitingListNotifications.ts`
- Inside `notifyWaitingListForOpenSpace()`
- After the in-app waiting-list notification is successfully inserted

Recipient:

- The waiting-list player attached to the notification row.

Subject line:

- `A space may be available: {{game_title}}`

Required data:

- Player email
- Player name
- Game title
- Game location
- Game time
- Waiting-list entry id
- Waiting-list notification id
- Game id
- Site URL with `open_game_id` link

### 4. `game_cancelled_by_organiser`

Sent when an organiser cancels a game.

This is a later-phase event. It should not be attached to hard game deletion.

Future trigger point:

- A future admin route that marks a game as cancelled.
- After the game cancellation state is persisted.
- After confirmed player bookings are fetched.

Recipient:

- All confirmed players for the cancelled game.

Subject line:

- `Game cancelled: {{game_title}}`

Required data:

- Player email
- Player name
- Game title
- Game location
- Game time
- Booking id
- Payment id if available
- Refund or credit policy text
- Site URL

## Idempotency Rules

Email sending must be idempotent.

Recommended idempotency keys:

- `booking_confirmed:booking:{{booking_id}}`
- `booking_cancelled_by_player:booking:{{booking_id}}`
- `waiting_list_spot_available:notification:{{notification_id}}`
- `game_cancelled_by_organiser:game:{{game_id}}:user:{{user_id}}`

Rules:

- Each event should be sent at most once for the same key.
- Retrying a failed request should not send duplicate emails.
- Store provider message ids in a future email log table before adding broad automation.
- If no email log exists in Phase 1, use provider idempotency headers where available and keep triggers narrow.

## Failure Handling

Email failure should not break core app flows.

Rules:

- Booking confirmation must not fail because email failed.
- Booking cancellation must not fail because email failed.
- Waiting-list notification creation must not fail because email failed.
- Game cancellation should still persist even if one or more emails fail.
- Email errors should be logged server-side.
- Failed emails should be retryable later in a future admin/tooling phase.

Recommended behavior:

- Wrap sends in `try/catch`.
- Log event name, idempotency key, recipient, and error message.
- Return the normal booking/payment/waiting-list response even if email fails.

## Phased Implementation Plan

### Phase 1: Documentation

Define email events, subjects, required data, trigger points, and idempotency rules.

### Phase 2: Server Email Helper

Add a server-only helper for sending transactional emails through Resend. Do not connect it to app events yet.

### Phase 3: Booking Confirmed Email

Send `booking_confirmed` only after a paid booking is fully finalized.

### Phase 4: Player Cancellation Email

Send `booking_cancelled_by_player` after a player successfully leaves a booking.

### Phase 5: Waiting List Email

Send `waiting_list_spot_available` after the existing in-app waiting-list notification is inserted.

### Phase 6: Email Log Table

Add an `email_events` or `email_deliveries` table to track idempotency keys, provider ids, statuses, retries, and errors.

### Phase 7: Game Cancelled Email

Implement only after games have a real cancellation state instead of hard deletion.

## Risks to Avoid

- Do not send booking confirmation before the booking exists.
- Do not send emails directly from client components.
- Do not expose email provider API keys to the browser.
- Do not let email failure break payment finalisation.
- Do not trigger organiser cancellation emails from hard delete.
- Do not send duplicate emails from both webhook and status polling.
- Do not email waiting-list players before the in-app notification is created.
- Do not add marketing or broadcast emails to the transactional system.
- Do not include sensitive payment payloads or raw SumUp responses in emails.
- Do not implement retries without idempotency.
