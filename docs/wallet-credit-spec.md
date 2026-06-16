# Fair Play Football Wallet/Credit Spec

## Purpose

The wallet/credit system should let Fair Play Football issue account credit to players as an alternative to a cash refund. Credit can then be used in a future phase toward eligible game bookings.

This document is a planning spec only. It does not change the current SumUp payment flow, booking flow, cancellation flow, database, or app behavior.

## When Credit Can Be Issued

Credit may be issued when a player is owed value after a booking or payment event, such as:

- A player cancels a booking within the eligible refund window.
- A game is cancelled by the organiser.
- A paid checkout succeeds but no space is available.
- An admin chooses to compensate a player for a support issue.
- A refund is impractical, delayed, or the player chooses credit instead.

Credit should not be issued automatically until the exact business rules are confirmed.

## Refund vs Credit Rules

Players should eventually be able to receive either:

- A cash refund through the original payment channel, where supported.
- Account credit held by Fair Play Football.

Initial implementation should keep refunds and credit separate:

- SumUp payments continue to work as they do today.
- Credit issuance does not modify the original `booking_payments` row.
- Credit records should reference the original payment and booking when possible.
- A player should not receive both full cash refund and full credit for the same booking unless an admin explicitly records a special adjustment.

Before launch, define:

- Whether player choice is required.
- Whether credit can be issued instead of a refund by default.
- Whether partial credit is allowed.
- Whether admin approval is required.
- Whether credit can be reversed.

## Admin Permissions

Admins should be able to:

- View a player's wallet balance.
- View wallet transaction history.
- Issue credit manually.
- Reverse or void an incorrect credit transaction with an audit trail.
- Link credit to a booking, payment, game, or support note.
- See who created each wallet transaction and when.

Admins should not directly edit a stored balance without creating a ledger transaction.

## Player Permissions

Players should eventually be able to:

- View their wallet balance.
- View their wallet transaction history.
- See which booking, payment, or game a credit relates to.
- Use available credit toward an eligible future booking.

Players should not be able to:

- Create credit.
- Edit credit.
- Delete wallet transactions.
- Transfer credit to another player.
- Withdraw credit as cash unless a later policy explicitly supports that.

## Credit Expiry Decision

Credit expiry must be decided before implementation.

Recommended starting position:

- No automatic expiry for the first wallet release.
- Store an optional `expires_at` field for future flexibility.
- If expiry is introduced later, make it visible to players before they accept credit.

Open decisions:

- Does credit expire after a fixed period?
- Can admins extend expiry?
- What happens to expired credit?
- Are promotional credits handled differently from refund credits?

## Audit and Ledger Principles

The wallet must use an immutable transaction ledger.

Core principles:

- Every balance change is a transaction.
- Transactions are append-only where possible.
- Corrections are made with reversing transactions, not by editing history.
- Each transaction stores an amount, currency, direction, reason, status, and source.
- Each transaction stores timestamps and actor information.
- Balance is derived from ledger transactions, even if a cached balance is stored for performance.

Suggested transaction types:

- `credit_issued`
- `credit_reversed`
- `credit_used`
- `credit_refunded`
- `admin_adjustment`
- `expiry`

Suggested transaction statuses:

- `pending`
- `posted`
- `voided`
- `expired`

## Related Records

Wallet records should link back to existing records whenever possible.

Related records:

- `bookings`: identifies the game place the player held or cancelled.
- `booking_payments`: identifies the SumUp checkout/payment that created the paid value.
- `games`: identifies the match involved in the credit event.
- `profiles` or `auth.users`: identifies the player receiving credit.

Important relationship rules:

- A credit can be linked to one booking.
- A credit can be linked to one payment.
- A credit can be linked to one game.
- Manual admin credits may have no booking/payment, but must have a reason.
- Wallet transactions should not depend on a booking continuing to exist forever.

## Future Phases

### Phase 1: Spec and Rules

Document eligibility, admin policy, player policy, expiry, audit requirements, and how credit relates to existing bookings and payments.

### Phase 2: Database Ledger

Add wallet account and wallet transaction tables with RLS. Do not change checkout or booking behavior yet.

### Phase 3: Admin Manual Credit

Allow admins to issue and reverse credit manually from the admin area. Keep this independent from SumUp.

### Phase 4: Player Wallet View

Show wallet balance and transaction history on the profile page. Keep it read-only.

### Phase 5: Cancellation Credit Option

Allow eligible cancellation flows to offer account credit instead of refund. Keep cash refund and credit paths explicit.

### Phase 6: Pay With Credit

Allow players to use wallet credit for future bookings. Start with a separate credit-only booking path before considering mixed SumUp plus credit payments.

## Risks to Avoid

- Do not store only a mutable balance without a transaction ledger.
- Do not edit or delete historical wallet transactions.
- Do not modify SumUp checkout creation for the first wallet phase.
- Do not overload `booking_payments` as a wallet table.
- Do not treat a deleted booking as a refund or credit record.
- Do not issue automatic credit before eligibility rules are final.
- Do not allow client-side wallet writes.
- Do not create negative balances unless explicitly supported.
- Do not mix cash refunds and account credit without clear audit records.
- Do not allow credit to be used for bookings until race conditions and capacity checks are designed.
