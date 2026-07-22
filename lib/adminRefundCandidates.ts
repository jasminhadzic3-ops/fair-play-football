export type AdminRefundCandidateStatus =
  | "eligible"
  | "requested"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"
  | "not_eligible";

export type AdminRefundCandidate = {
  source_wallet_transaction_id: number;
  game_id: number | null;
  booking_id: number | null;
  payment_id: number | null;
  user_id: string | null;
  player_name: string | null;
  amount: number;
  currency: string;
  original_payment_method: string | null;
  refund_status: AdminRefundCandidateStatus;
  refund_eligible: boolean;
  safe_reason: string;
  refund_request_id: number | null;
  refund_request_status: string | null;
  sumup_refund_attempt_id: number | null;
  sumup_refund_attempt_status: string | null;
};

type GameLike = {
  id: number;
  status?: string | null;
};

type BookingLike = {
  id: number;
  game_id?: number | null;
  user_id?: string | null;
  player_name?: string | null;
};

type ProfileLike = {
  id: string;
  username?: string | null;
};

type BookingPaymentLike = {
  id: number;
  user_id?: string | null;
  game_id?: number | null;
  booking_id?: number | null;
  payment_status?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  transaction_code?: string | null;
  sumup_transaction_id?: string | null;
};

type WalletTransactionLike = {
  id: number;
  user_id?: string | null;
  game_id?: number | null;
  booking_id?: number | null;
  payment_id?: number | null;
  amount?: number | string | null;
  currency?: string | null;
  transaction_type?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type SumUpRefundAttemptLike = {
  id: number;
  refund_request_id: number;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type BuildAdminRefundCandidatesParams = {
  games: GameLike[];
  bookings: BookingLike[];
  profiles: ProfileLike[];
  bookingPayments: BookingPaymentLike[];
  walletTransactions: WalletTransactionLike[];
  sumUpRefundAttempts: SumUpRefundAttemptLike[];
};

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function getMetadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];

  return typeof value === "string" ? value.trim() || null : null;
}

function isPaid(payment: BookingPaymentLike) {
  return payment.payment_status?.toLowerCase() === "paid";
}

function hasTransactionReference(payment: BookingPaymentLike | null | undefined) {
  return Boolean(payment?.sumup_transaction_id?.trim() || payment?.transaction_code?.trim());
}

function isValidWalletBookingPayment(transaction: WalletTransactionLike) {
  return (
    transaction.transaction_type === "wallet_booking_payment" &&
    transaction.status === "completed" &&
    Number(transaction.amount ?? 0) < 0
  );
}

function isBlockingRefundRequestStatus(status: string | null | undefined) {
  return status === "pending" || status === "processing" || status === "completed";
}

function getLatestAttempt(attempts: SumUpRefundAttemptLike[]) {
  return attempts
    .slice()
    .sort((a, b) => {
      const bTime = Date.parse(b.updated_at || b.created_at || "");
      const aTime = Date.parse(a.updated_at || a.created_at || "");

      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    })[0] ?? null;
}

function getRequestedStatus(
  request: WalletTransactionLike,
  attempt: SumUpRefundAttemptLike | null
): Pick<
  AdminRefundCandidate,
  "refund_status" | "refund_eligible" | "safe_reason" | "sumup_refund_attempt_id" | "sumup_refund_attempt_status"
> {
  if (request.status === "completed") {
    return {
      refund_status: "completed",
      refund_eligible: false,
      safe_reason: "Refund completed.",
      sumup_refund_attempt_id: attempt?.id ?? null,
      sumup_refund_attempt_status: attempt?.status ?? null,
    };
  }

  if (attempt?.status === "unknown") {
    return {
      refund_status: "needs_review",
      refund_eligible: false,
      safe_reason: "Refund needs review. Use Recheck SumUp before retrying.",
      sumup_refund_attempt_id: attempt.id,
      sumup_refund_attempt_status: attempt.status,
    };
  }

  if (attempt?.status === "succeeded") {
    return {
      refund_status: "processing",
      refund_eligible: false,
      safe_reason: "SumUp refund succeeded; wallet completion is pending.",
      sumup_refund_attempt_id: attempt.id,
      sumup_refund_attempt_status: attempt.status,
    };
  }

  if (attempt?.status === "failed") {
    return {
      refund_status: "failed",
      refund_eligible: false,
      safe_reason: "Previous SumUp refund attempt failed. Use the Refund Requests queue before retrying.",
      sumup_refund_attempt_id: attempt.id,
      sumup_refund_attempt_status: attempt.status,
    };
  }

  if (request.status === "processing" || attempt?.status === "processing") {
    return {
      refund_status: "processing",
      refund_eligible: false,
      safe_reason: "Refund processing.",
      sumup_refund_attempt_id: attempt?.id ?? null,
      sumup_refund_attempt_status: attempt?.status ?? null,
    };
  }

  return {
    refund_status: "requested",
    refund_eligible: false,
    safe_reason: "Refund request already exists. Use the Refund Requests queue for processing and recovery.",
    sumup_refund_attempt_id: attempt?.id ?? null,
    sumup_refund_attempt_status: attempt?.status ?? null,
  };
}

function notEligible(reason: string): Pick<AdminRefundCandidate, "refund_status" | "refund_eligible" | "safe_reason"> {
  return {
    refund_status: "not_eligible",
    refund_eligible: false,
    safe_reason: reason,
  };
}

export function buildAdminRefundCandidates({
  games,
  bookings,
  profiles,
  bookingPayments,
  walletTransactions,
  sumUpRefundAttempts,
}: BuildAdminRefundCandidatesParams): AdminRefundCandidate[] {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const paymentById = new Map(bookingPayments.map((payment) => [payment.id, payment]));
  const paymentsByBookingId = new Map<number, BookingPaymentLike[]>();
  const walletTransactionsByBookingId = new Map<number, WalletTransactionLike[]>();
  const refundRequestsBySourceId = new Map<number, WalletTransactionLike[]>();
  const attemptsByRequestId = new Map<number, SumUpRefundAttemptLike[]>();

  bookingPayments.forEach((payment) => {
    if (!payment.booking_id) {
      return;
    }

    paymentsByBookingId.set(payment.booking_id, [...(paymentsByBookingId.get(payment.booking_id) ?? []), payment]);
  });

  walletTransactions.forEach((transaction) => {
    if (transaction.booking_id) {
      walletTransactionsByBookingId.set(transaction.booking_id, [
        ...(walletTransactionsByBookingId.get(transaction.booking_id) ?? []),
        transaction,
      ]);
    }

    if (transaction.transaction_type === "refund_requested" && isBlockingRefundRequestStatus(transaction.status)) {
      const sourceWalletTransactionId = getMetadataNumber(transaction.metadata, "source_wallet_transaction_id");

      if (sourceWalletTransactionId) {
        refundRequestsBySourceId.set(sourceWalletTransactionId, [
          ...(refundRequestsBySourceId.get(sourceWalletTransactionId) ?? []),
          transaction,
        ]);
      }
    }
  });

  sumUpRefundAttempts.forEach((attempt) => {
    attemptsByRequestId.set(attempt.refund_request_id, [
      ...(attemptsByRequestId.get(attempt.refund_request_id) ?? []),
      attempt,
    ]);
  });

  return walletTransactions
    .filter((transaction) => transaction.transaction_type === "game_cancelled_credit" && transaction.status === "completed")
    .map((sourceCredit) => {
      const gameId = sourceCredit.game_id ?? getMetadataNumber(sourceCredit.metadata, "original_game_id");
      const bookingId = sourceCredit.booking_id ?? getMetadataNumber(sourceCredit.metadata, "original_booking_id");
      const paymentId = sourceCredit.payment_id ?? getMetadataNumber(sourceCredit.metadata, "original_payment_id");
      const game = gameId ? gameById.get(gameId) ?? null : null;
      const booking = bookingId ? bookingById.get(bookingId) ?? null : null;
      const payment = paymentId ? paymentById.get(paymentId) ?? null : null;
      const profile = sourceCredit.user_id ? profileById.get(sourceCredit.user_id) ?? null : null;
      const originalPaymentMethod = getMetadataString(sourceCredit.metadata, "original_payment_method");
      const amount = Number(sourceCredit.amount ?? 0);
      const currency = sourceCredit.currency?.trim() || payment?.currency?.trim() || "GBP";
      const activeRefundRequest = (refundRequestsBySourceId.get(sourceCredit.id) ?? [])[0] ?? null;
      const latestAttempt = activeRefundRequest
        ? getLatestAttempt(attemptsByRequestId.get(activeRefundRequest.id) ?? [])
        : null;

      let status:
        | Pick<
            AdminRefundCandidate,
            | "refund_status"
            | "refund_eligible"
            | "safe_reason"
            | "sumup_refund_attempt_id"
            | "sumup_refund_attempt_status"
          >
        | Pick<AdminRefundCandidate, "refund_status" | "refund_eligible" | "safe_reason">;

      if (activeRefundRequest) {
        status = getRequestedStatus(activeRefundRequest, latestAttempt);
      } else if (originalPaymentMethod !== "sumup") {
        status = notEligible("Only SumUp cancellation credits can be refunded to card.");
      } else if (!game || game.status !== "cancelled") {
        status = notEligible("Card refunds are only available after the game is cancelled.");
      } else if (!bookingId || !paymentId || !booking || !payment) {
        status = notEligible("Linked booking payment details are incomplete.");
      } else if (amount <= 0) {
        status = notEligible("Cancellation credit amount is invalid.");
      } else if (!isPaid(payment) || Number(payment.amount ?? 0) <= 0) {
        status = notEligible("Linked SumUp payment is not a paid positive payment.");
      } else if (!hasTransactionReference(payment)) {
        status = notEligible("Linked SumUp payment is missing a transaction reference.");
      } else if (
        sourceCredit.user_id !== payment.user_id ||
        sourceCredit.user_id !== booking.user_id ||
        sourceCredit.game_id !== gameId ||
        sourceCredit.booking_id !== bookingId ||
        sourceCredit.payment_id !== paymentId ||
        payment.game_id !== gameId ||
        payment.booking_id !== bookingId
      ) {
        status = notEligible("Linked player, game, booking and payment details do not match.");
      } else {
        const linkedPayments = paymentsByBookingId.get(bookingId) ?? [];
        const paidPayments = linkedPayments.filter(isPaid);
        const nonPaidPayments = linkedPayments.filter((linkedPayment) => !isPaid(linkedPayment));
        const linkedWalletBookingPayments = (walletTransactionsByBookingId.get(bookingId) ?? []).filter(
          (transaction) => transaction.transaction_type === "wallet_booking_payment"
        );
        const validWalletBookingPayments = linkedWalletBookingPayments.filter(isValidWalletBookingPayment);
        const ambiguousWalletBookingPayments = linkedWalletBookingPayments.filter(
          (transaction) => !isValidWalletBookingPayment(transaction)
        );

        if (
          paidPayments.length !== 1 ||
          nonPaidPayments.length > 0 ||
          validWalletBookingPayments.length > 0 ||
          ambiguousWalletBookingPayments.length > 0
        ) {
          status = notEligible("This booking has ambiguous payment history and cannot be refunded automatically.");
        } else {
          status = {
            refund_status: "eligible",
            refund_eligible: true,
            safe_reason: "Eligible for full SumUp refund.",
          };
        }
      }

      return {
        source_wallet_transaction_id: sourceCredit.id,
        game_id: gameId,
        booking_id: bookingId,
        payment_id: paymentId,
        user_id: sourceCredit.user_id ?? null,
        player_name: profile?.username ?? booking?.player_name ?? null,
        amount,
        currency,
        original_payment_method: originalPaymentMethod,
        refund_request_id: activeRefundRequest?.id ?? null,
        refund_request_status: activeRefundRequest?.status ?? null,
        sumup_refund_attempt_id:
          "sumup_refund_attempt_id" in status ? status.sumup_refund_attempt_id ?? null : null,
        sumup_refund_attempt_status:
          "sumup_refund_attempt_status" in status ? status.sumup_refund_attempt_status ?? null : null,
        refund_status: status.refund_status,
        refund_eligible: status.refund_eligible,
        safe_reason: status.safe_reason,
      };
    });
}
