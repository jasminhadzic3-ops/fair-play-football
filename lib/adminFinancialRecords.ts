export type AdminFinancialRecordType =
  | "paid_sumup_payment"
  | "other_booking_payment"
  | "wallet_booking_payment"
  | "cancellation_credit"
  | "refund_request"
  | "refund_completed"
  | "sumup_refund_attempt"
  | "waiting_list"
  | "waiting_list_notification"
  | "reminder_delivery";

export type AdminFinancialRecord = {
  record_type: AdminFinancialRecordType;
  player_name: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  created_at: string | null;
  category: string;
};

type GameLike = {
  id: number;
};

type BookingLike = {
  id: number;
  game_id?: number | null;
  user_id?: string | null;
  player_name?: string | null;
};

type BookingPaymentLike = {
  id: number;
  user_id?: string | null;
  game_id?: number | null;
  booking_id?: number | null;
  player_name?: string | null;
  payment_status?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  created_at?: string | null;
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
  booking_payment_id?: number | null;
  status?: string | null;
  created_at?: string | null;
};

type WaitingListLike = {
  id: number;
  game_id?: number | null;
  user_id?: string | null;
  player_name?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type ReminderDeliveryLike = {
  id: number;
  game_id?: number | null;
  booking_id?: number | null;
  user_id?: string | null;
  status?: string | null;
  attempts?: number | null;
  created_at?: string | null;
};

type BuildAdminFinancialRecordsParams = {
  games: GameLike[];
  bookings: BookingLike[];
  bookingPayments: BookingPaymentLike[];
  walletTransactions: WalletTransactionLike[];
  sumUpRefundAttempts: SumUpRefundAttemptLike[];
  waitingList: WaitingListLike[];
  waitingListNotifications: WaitingListLike[];
  reminderDeliveries: ReminderDeliveryLike[];
};

function getMetadataNumber(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function toAmount(value: number | string | null | undefined) {
  const amount = Number(value);

  return Number.isFinite(amount) ? Math.abs(amount) : null;
}

function linkedBookingId(transaction: WalletTransactionLike) {
  return transaction.booking_id ?? getMetadataNumber(transaction.metadata, "original_booking_id");
}

function linkedPaymentId(transaction: WalletTransactionLike) {
  return transaction.payment_id ?? getMetadataNumber(transaction.metadata, "original_payment_id");
}

function addRecord(
  recordsByGameId: Map<number, AdminFinancialRecord[]>,
  gameId: number | null | undefined,
  record: AdminFinancialRecord
) {
  if (!gameId) {
    return;
  }

  recordsByGameId.set(gameId, [...(recordsByGameId.get(gameId) ?? []), record]);
}

function playerNameFor(
  bookingById: Map<number, BookingLike>,
  paymentById: Map<number, BookingPaymentLike>,
  row: {
    booking_id?: number | null;
    payment_id?: number | null;
    player_name?: string | null;
  }
) {
  if (row.player_name?.trim()) {
    return row.player_name.trim();
  }

  if (row.booking_id) {
    const bookingName = bookingById.get(row.booking_id)?.player_name?.trim();

    if (bookingName) {
      return bookingName;
    }
  }

  if (row.payment_id) {
    const paymentName = paymentById.get(row.payment_id)?.player_name?.trim();

    if (paymentName) {
      return paymentName;
    }
  }

  return null;
}

export function buildAdminFinancialRecordsByGame({
  games,
  bookings,
  bookingPayments,
  walletTransactions,
  sumUpRefundAttempts,
  waitingList,
  waitingListNotifications,
  reminderDeliveries,
}: BuildAdminFinancialRecordsParams) {
  const recordsByGameId = new Map<number, AdminFinancialRecord[]>();
  const gameIds = new Set(games.map((game) => game.id));
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const paymentById = new Map(bookingPayments.map((payment) => [payment.id, payment]));
  const refundRequestById = new Map(
    walletTransactions
      .filter((transaction) => transaction.transaction_type === "refund_requested")
      .map((transaction) => [transaction.id, transaction])
  );

  bookingPayments.forEach((payment) => {
    if (!payment.game_id || !gameIds.has(payment.game_id)) {
      return;
    }

    const isPaid = payment.payment_status?.toLowerCase() === "paid";

    addRecord(recordsByGameId, payment.game_id, {
      record_type: isPaid ? "paid_sumup_payment" : "other_booking_payment",
      player_name: playerNameFor(bookingById, paymentById, payment),
      amount: toAmount(payment.amount),
      currency: payment.currency ?? "GBP",
      status: payment.payment_status ?? "unknown",
      created_at: payment.created_at ?? null,
      category: isPaid ? "Paid SumUp payment" : "Other booking payment record",
    });
  });

  walletTransactions.forEach((transaction) => {
    const gameId = transaction.game_id ?? getMetadataNumber(transaction.metadata, "original_game_id");

    if (!gameId || !gameIds.has(gameId)) {
      return;
    }

    if (transaction.transaction_type === "wallet_booking_payment") {
      addRecord(recordsByGameId, gameId, {
        record_type: "wallet_booking_payment",
        player_name: playerNameFor(bookingById, paymentById, transaction),
        amount: toAmount(transaction.amount),
        currency: transaction.currency ?? "GBP",
        status: transaction.status ?? "unknown",
        created_at: transaction.created_at ?? null,
        category: "Wallet booking payment",
      });
      return;
    }

    if (transaction.transaction_type === "game_cancelled_credit") {
      addRecord(recordsByGameId, gameId, {
        record_type: "cancellation_credit",
        player_name: playerNameFor(bookingById, paymentById, transaction),
        amount: toAmount(transaction.amount),
        currency: transaction.currency ?? "GBP",
        status: transaction.status ?? "unknown",
        created_at: transaction.created_at ?? null,
        category: "Cancellation credit",
      });
      return;
    }

    if (transaction.transaction_type === "refund_requested") {
      addRecord(recordsByGameId, gameId, {
        record_type: "refund_request",
        player_name: playerNameFor(bookingById, paymentById, {
          booking_id: linkedBookingId(transaction),
          payment_id: linkedPaymentId(transaction),
        }),
        amount: toAmount(transaction.amount),
        currency: transaction.currency ?? "GBP",
        status: transaction.status ?? "unknown",
        created_at: transaction.created_at ?? null,
        category: "Refund request",
      });
      return;
    }

    if (transaction.transaction_type === "refund_completed") {
      const refundRequestId = getMetadataNumber(transaction.metadata, "refund_request_id");
      const refundRequest = refundRequestId ? refundRequestById.get(refundRequestId) : null;

      addRecord(recordsByGameId, gameId, {
        record_type: "refund_completed",
        player_name: playerNameFor(bookingById, paymentById, {
          booking_id: linkedBookingId(transaction) ?? (refundRequest ? linkedBookingId(refundRequest) : null),
          payment_id: linkedPaymentId(transaction) ?? (refundRequest ? linkedPaymentId(refundRequest) : null),
        }),
        amount: toAmount(transaction.amount),
        currency: transaction.currency ?? "GBP",
        status: transaction.status ?? "unknown",
        created_at: transaction.created_at ?? null,
        category: "Completed refund",
      });
    }
  });

  sumUpRefundAttempts.forEach((attempt) => {
    const refundRequest = refundRequestById.get(attempt.refund_request_id);
    const payment = attempt.booking_payment_id ? paymentById.get(attempt.booking_payment_id) : null;
    const gameId =
      refundRequest?.game_id ??
      getMetadataNumber(refundRequest?.metadata, "original_game_id") ??
      payment?.game_id;

    if (!gameId || !gameIds.has(gameId)) {
      return;
    }

    addRecord(recordsByGameId, gameId, {
      record_type: "sumup_refund_attempt",
      player_name: playerNameFor(bookingById, paymentById, {
        booking_id: refundRequest?.booking_id ?? payment?.booking_id ?? null,
        payment_id: refundRequest?.payment_id ?? payment?.id ?? null,
      }),
      amount: toAmount(refundRequest?.amount),
      currency: refundRequest?.currency ?? payment?.currency ?? "GBP",
      status: attempt.status ?? "unknown",
      created_at: attempt.created_at ?? null,
      category: "SumUp refund attempt",
    });
  });

  waitingList.forEach((entry) => {
    addRecord(recordsByGameId, entry.game_id, {
      record_type: "waiting_list",
      player_name: entry.player_name?.trim() || null,
      amount: null,
      currency: null,
      status: entry.status ?? "unknown",
      created_at: entry.created_at ?? null,
      category: "Waiting-list record",
    });
  });

  waitingListNotifications.forEach((entry) => {
    addRecord(recordsByGameId, entry.game_id, {
      record_type: "waiting_list_notification",
      player_name: entry.player_name?.trim() || null,
      amount: null,
      currency: null,
      status: entry.status ?? "unknown",
      created_at: entry.created_at ?? null,
      category: "Waiting-list notification",
    });
  });

  reminderDeliveries.forEach((delivery) => {
    addRecord(recordsByGameId, delivery.game_id, {
      record_type: "reminder_delivery",
      player_name: playerNameFor(bookingById, paymentById, delivery),
      amount: null,
      currency: null,
      status: delivery.status ?? "unknown",
      created_at: delivery.created_at ?? null,
      category: "Reminder delivery",
    });
  });

  recordsByGameId.forEach((records, gameId) => {
    recordsByGameId.set(
      gameId,
      records.slice().sort((a, b) => {
        const bTime = Date.parse(b.created_at ?? "");
        const aTime = Date.parse(a.created_at ?? "");

        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      })
    );
  });

  return recordsByGameId;
}
