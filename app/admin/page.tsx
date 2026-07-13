"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Game {
  id: number;
  title: string;
  location: string;
  time: string;
  price: number;
  max_players: number;
  status?: "active" | "cancelled" | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
}

interface Booking {
  id: number;
  game_id: number;
  user_id?: string | null;
  player_name?: string | null;
}

interface BookingPayment {
  id: number;
  game_id: number;
  user_id?: string | null;
  player_name?: string | null;
  payment_status?: string | null;
  booking_id?: number | null;
  amount?: number | string | null;
  currency?: string | null;
}

interface WalletTransaction {
  id: number;
  game_id: number | null;
  user_id?: string | null;
  booking_id?: number | null;
  amount?: number | string | null;
  currency?: string | null;
  transaction_type?: string | null;
  status?: string | null;
}

interface RefundRequest {
  id: number;
  user_id?: string | null;
  player_name?: string | null;
  player_email?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  status?: string | null;
  description?: string | null;
  source_wallet_transaction_id?: number | null;
  original_payment_id?: number | null;
  original_game_id?: number | null;
  original_booking_id?: number | null;
  source_game_title?: string | null;
  source_booking_player_name?: string | null;
  source_payment_status?: string | null;
  source_payment_checkout_reference?: string | null;
  source_payment_transaction_code?: string | null;
  sumup_refund_attempt_id?: number | null;
  sumup_refund_attempt_status?: string | null;
  sumup_refund_attempt_error?: string | null;
  created_at?: string | null;
}

type BookingPaymentDisplay = {
  payment_status?: string | null;
  amount?: number | string | null;
  currency?: string | null;
};

interface WaitingListEntry {
  id: number;
  game_id: number;
  user_id?: string | null;
  player_name?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface AdminSummary {
  games_count: number;
  bookings_count: number;
  players_count: number;
  profiles_count: number;
  paid_payments_amount_total: number;
}

interface AdminDashboardData {
  games: Game[];
  bookings: Booking[];
  booking_payments: BookingPayment[];
  wallet_transactions?: WalletTransaction[];
  refund_requests?: RefundRequest[];
  waiting_list: WaitingListEntry[];
  automaticSumUpRefundEnabled?: boolean;
  automaticSumUpRefundMockEnabled?: boolean;
  automaticSumUpRefundMode?: "disabled" | "test_mock" | "production_real";
  summary: AdminSummary;
}

interface CancelGameResponse {
  game?: Game;
  sumup_credited_count?: number;
  wallet_credited_count?: number;
  total_credited_count?: number;
  already_cancelled?: boolean;
  email_warning?: string;
  error?: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [games, setGames] = useState<Game[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingPayments, setBookingPayments] = useState<BookingPayment[]>([]);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);
  const [waitingList, setWaitingList] = useState<WaitingListEntry[]>([]);
  const [automaticSumUpRefundEnabled, setAutomaticSumUpRefundEnabled] = useState(false);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [time, setTime] = useState("");
  const [price, setPrice] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingGameId, setEditingGameId] = useState<number | null>(null);
  const [cancellingGameId, setCancellingGameId] = useState<number | null>(null);
  const [processingRefundRequestId, setProcessingRefundRequestId] = useState<number | null>(null);
  const [summary, setSummary] = useState<AdminSummary>({
    games_count: 0,
    bookings_count: 0,
    players_count: 0,
    profiles_count: 0,
    paid_payments_amount_total: 0,
  });

  const getAdminAuthHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Please sign in as an admin before managing games.");
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const fetchAdminData = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/dashboard", {
        headers: await getAdminAuthHeaders(),
      });

      const result = (await response.json().catch(() => null)) as AdminDashboardData | { error?: string } | null;

      if (!response.ok) {
        alert(result && "error" in result ? result.error || "Unable to load admin dashboard." : "Unable to load admin dashboard.");
        return;
      }

      if (result && "games" in result) {
        setGames(result.games ?? []);
        setBookings(result.bookings ?? []);
        setBookingPayments(result.booking_payments ?? []);
        setWalletTransactions(result.wallet_transactions ?? []);
        setRefundRequests(result.refund_requests ?? []);
        setWaitingList(result.waiting_list ?? []);
        setAutomaticSumUpRefundEnabled(result.automaticSumUpRefundEnabled === true);
        setSummary(result.summary);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to load admin dashboard.");
    }
  }, [getAdminAuthHeaders]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchAdminData();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [fetchAdminData]);

  const resetForm = () => {
    setTitle("");
    setLocation("");
    setTime("");
    setPrice("");
    setMaxPlayers("");
    setEditingGameId(null);
  };

  const refreshAdminDataAfterSave = () => {
    void fetchAdminData().catch((error) => {
      console.warn("Unable to refresh admin dashboard after saving game:", error);
      alert("Game saved, but the dashboard refresh failed. Please refresh the page if the list looks outdated.");
    });
  };

  const readApiError = async (response: Response) => {
    const result = await response.json().catch(() => null);
    return result?.error || "Unable to save game.";
  };

  const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const alertAfterPaint = (message: string) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => alert(message), 0);
    });
  };

  const saveGame = async () => {
    if (isSubmitting) return;

    const numericPrice = Number(price);
    const numericMaxPlayers = Number(maxPlayers);

    if (
      !title.trim() ||
      !location.trim() ||
      !time.trim() ||
      Number.isNaN(numericPrice) ||
      Number.isNaN(numericMaxPlayers) ||
      ![12, 14, 16].includes(numericMaxPlayers)
    ) {
      alert("Please fill in all fields. Max players must be 12 (6v6), 14 (7v7), or 16 (8v8).");
      return;
    }

    let adminHeaders: HeadersInit;

    try {
      adminHeaders = await getAdminAuthHeaders();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to save game.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        title,
        location,
        time,
        price: numericPrice,
        max_players: numericMaxPlayers,
      };

      const response = await fetchWithTimeout(
        editingGameId ? `/api/admin/games/${editingGameId}` : "/api/admin/games",
        {
          method: editingGameId ? "PATCH" : "POST",
          headers: adminHeaders,
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        setIsSubmitting(false);
        alertAfterPaint(await readApiError(response));
      } else {
        setIsSubmitting(false);
        alertAfterPaint(editingGameId ? "Game updated!" : "Game created!");
        resetForm();
        refreshAdminDataAfterSave();
      }
    } catch (error) {
      setIsSubmitting(false);
      alertAfterPaint(error instanceof Error ? error.message : "Unable to save game.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const editGame = (game: Game) => {
    setEditingGameId(game.id);
    setTitle(game.title);
    setLocation(game.location);
    setTime(game.time);
    setPrice(String(game.price));
    setMaxPlayers(String(game.max_players));
  };

  const deleteGame = async (game: Game) => {
    const confirmed = window.confirm(`Delete "${game.title}"? This cannot be undone.`);

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/games/${game.id}`, {
        method: "DELETE",
        headers: await getAdminAuthHeaders(),
      });

      if (!response.ok) {
        alert(await readApiError(response));
        return;
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to delete game.");
      return;
    }

    if (editingGameId === game.id) {
      resetForm();
    }

    await fetchAdminData();
  };

  const cancelGame = async (game: Game) => {
    if (cancellingGameId) {
      return;
    }

    const confirmed = window.confirm(
      `Cancel "${game.title}"? Paid players will be credited to wallet and cancellation emails may be sent. This does not delete bookings or payment records.`
    );

    if (!confirmed) {
      return;
    }

    const reason = window.prompt("Optional cancellation reason for admin records:");

    setCancellingGameId(game.id);

    try {
      const response = await fetch(`/api/admin/games/${game.id}`, {
        method: "PATCH",
        headers: await getAdminAuthHeaders(),
        body: JSON.stringify({
          action: "cancel",
          cancellation_reason: reason?.trim() || null,
        }),
      });
      const result = (await response.json().catch(() => null)) as CancelGameResponse | null;

      if (!response.ok) {
        alert(result?.error || "Unable to cancel game.");
        return;
      }

      const message = result?.already_cancelled
        ? "This game was already cancelled. No new credits were created."
        : [
            "Game cancelled.",
            "",
            `SumUp payments credited: ${result?.sumup_credited_count ?? 0}`,
            `Wallet payments restored: ${result?.wallet_credited_count ?? 0}`,
            `Total credits: ${result?.total_credited_count ?? 0}`,
          ].join("\n");
      const emailWarning = result?.email_warning ? `\n\nEmail warning: ${result.email_warning}` : "";

      alert(`${message}${emailWarning}`);

      if (editingGameId === game.id) {
        resetForm();
      }

      await fetchAdminData();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to cancel game.");
    } finally {
      setCancellingGameId(null);
    }
  };

  const removeBooking = async (booking: Booking) => {
    const confirmed = window.confirm(
      "This only removes the player from the game. It does not refund payment or add credit."
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: "DELETE",
        headers: await getAdminAuthHeaders(),
      });

      if (!response.ok) {
        alert(await readApiError(response));
        return;
      }

      await fetchAdminData();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to remove booking.");
    }
  };

  const moveBooking = async (booking: Booking, formData: FormData) => {
    const targetGameId = Number(formData.get("target_game_id"));

    if (!Number.isInteger(targetGameId) || targetGameId <= 0) {
      alert("Please choose a game to move this booking to.");
      return;
    }

    const confirmed = window.confirm(
      "This only moves the player booking. It does not change payment, refund, or credit."
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/bookings/${booking.id}/move`, {
        method: "PATCH",
        headers: await getAdminAuthHeaders(),
        body: JSON.stringify({ target_game_id: targetGameId }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        alert(result?.error || "Unable to move booking.");
        return;
      }

      await fetchAdminData();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to move booking.");
    }
  };

  const exportBookingsCsv = async () => {
    try {
      const response = await fetch("/api/admin/export/bookings", {
        headers: await getAdminAuthHeaders(),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        alert(result?.error || "Unable to export bookings.");
        return;
      }

      const csvBlob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(csvBlob);
      const downloadLink = document.createElement("a");

      downloadLink.href = downloadUrl;
      downloadLink.download = "fair-play-bookings.csv";
      downloadLink.click();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to export bookings.");
    }
  };

  const processRefundRequest = async (
    request: RefundRequest,
    action: "approve" | "reject" | "refund_via_sumup" | "recheck_sumup_refund"
  ) => {
    if (processingRefundRequestId) {
      return;
    }

    const amount = formatRefundRequestAmount(request);
    const isSumUpRefund = action === "refund_via_sumup";
    const isSumUpRecheck = action === "recheck_sumup_refund";
    const confirmed = window.confirm(
      isSumUpRefund
        ? `Refund request ${request.id} for ${amount} via SumUp? This will attempt a card refund before completing the wallet refund.`
        : isSumUpRecheck
        ? `Recheck SumUp evidence for refund request ${request.id} for ${amount}? This will not issue another refund.`
        : action === "approve"
        ? `Mark refund request ${request.id} for ${amount} as manually refunded? This will deduct the amount from the wallet balance.`
        : `Reject refund request ${request.id} for ${amount}? This will not change the wallet balance.`
    );

    if (!confirmed) {
      return;
    }

    const reason = isSumUpRefund || isSumUpRecheck
      ? null
      : window.prompt(
          action === "approve"
            ? "Optional admin note for this manual refund:"
            : "Optional rejection reason:"
        );

    setProcessingRefundRequestId(request.id);

    try {
      const response = await fetch(`/api/admin/refund-requests/${request.id}`, {
        method: "PATCH",
        headers: await getAdminAuthHeaders(),
        body: JSON.stringify({
          action,
          reason: reason?.trim() || null,
        }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        alert(result?.message || result?.error || "Unable to process refund request.");
        return;
      }

      alert(
        isSumUpRefund || isSumUpRecheck
          ? result?.message || "SumUp refund action completed."
          : action === "approve"
            ? "Refund marked as completed."
            : "Refund request rejected."
      );
      await fetchAdminData();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to process refund request.");
    } finally {
      setProcessingRefundRequestId(null);
    }
  };

  const getBookingCount = (gameId: number) =>
    bookings.filter((booking) => booking.game_id === gameId).length;

  const getGameBookings = (gameId: number) =>
    bookings.filter((booking) => booking.game_id === gameId);

  const getPaymentStatusForBooking = (booking: Booking) => {
    const matchedPayment = getPaymentDisplayForBooking(booking);

    return matchedPayment?.payment_status || "unknown";
  };

  const isPaidBookingPayment = (payment: BookingPayment) =>
    payment.payment_status?.toLowerCase() === "paid";

  const getWalletTransactionForBooking = (booking: Booking) =>
    walletTransactions.find(
      (transaction) =>
        transaction.booking_id === booking.id &&
        transaction.transaction_type === "wallet_booking_payment" &&
        transaction.status === "completed" &&
        Number(transaction.amount) < 0
    );

  const getPaymentDisplayForBooking = (booking: Booking): BookingPaymentDisplay | undefined => {
    const normalizedPlayerName = booking.player_name?.trim().toLowerCase();
    const directBookingPayment = bookingPayments.find((payment) => payment.booking_id === booking.id);
    const walletTransaction = getWalletTransactionForBooking(booking);

    if (directBookingPayment) {
      return directBookingPayment;
    }

    if (walletTransaction) {
      return {
        payment_status: "wallet paid",
        amount: Math.abs(Number(walletTransaction.amount)),
        currency: walletTransaction.currency ?? "GBP",
      };
    }

    return (
      bookingPayments.find(
        (payment) =>
          isPaidBookingPayment(payment) &&
          booking.user_id &&
          payment.user_id === booking.user_id &&
          payment.game_id === booking.game_id
      ) ||
      bookingPayments.find(
        (payment) =>
          isPaidBookingPayment(payment) &&
          normalizedPlayerName &&
          payment.game_id === booking.game_id &&
          payment.player_name?.trim().toLowerCase() === normalizedPlayerName
      )
    );
  };

  const getGameForBooking = (booking: Booking) =>
    games.find((game) => game.id === booking.game_id);

  const getGameById = (gameId: number) =>
    games.find((game) => game.id === gameId);

  const formatJoinedDate = (dateValue: string | null | undefined) => {
    if (!dateValue) {
      return "—";
    }

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const formatPaymentAmount = (payment: BookingPaymentDisplay | undefined) => {
    if (payment?.amount === null || payment?.amount === undefined) {
      return "—";
    }

    const amount = Number(payment.amount);

    if (Number.isNaN(amount)) {
      return "—";
    }

    return `${payment.currency === "GBP" || !payment.currency ? "£" : `${payment.currency} `}${amount.toFixed(2)}`;
  };

  const formatRefundRequestAmount = (request: RefundRequest) => {
    if (request.amount === null || request.amount === undefined) {
      return "—";
    }

    const amount = Math.abs(Number(request.amount));

    if (Number.isNaN(amount)) {
      return "—";
    }

    return `${request.currency === "GBP" || !request.currency ? "£" : `${request.currency} `}${amount.toFixed(2)}`;
  };

  const formatRefundRequestSource = (request: RefundRequest) => {
    const sourceParts = [
      request.source_game_title || (request.original_game_id ? `Game ${request.original_game_id}` : null),
      request.original_payment_id ? `Payment ${request.original_payment_id}` : null,
      request.source_wallet_transaction_id ? `Credit ${request.source_wallet_transaction_id}` : null,
    ].filter(Boolean);

    return sourceParts.length > 0 ? sourceParts.join(" • ") : "Source not linked";
  };

  const getRefundRequestStatusMessage = (request: RefundRequest) => {
    if (request.sumup_refund_attempt_status === "unknown") {
      return "SumUp outcome is unknown. Recheck SumUp before retrying.";
    }

    if (request.sumup_refund_attempt_status === "succeeded" && request.status === "processing") {
      return "SumUp refund succeeded. Wallet completion is pending.";
    }

    if (request.sumup_refund_attempt_status === "processing") {
      return "SumUp refund attempt is processing. No duplicate refund will be sent.";
    }

    if (request.sumup_refund_attempt_status === "failed") {
      return "Previous SumUp refund attempt failed. The request can be retried or handled manually.";
    }

    return null;
  };

  const canRefundViaSumUp = (request: RefundRequest) =>
    automaticSumUpRefundEnabled &&
    (request.status === "pending" ||
      (request.status === "processing" && request.sumup_refund_attempt_status === "succeeded"));

  const canManuallyProcessRefund = (request: RefundRequest) =>
    request.status === "pending";

  const canRecheckSumUpRefund = (request: RefundRequest) =>
    request.status === "processing" &&
    request.sumup_refund_attempt_status === "unknown" &&
    Boolean(request.sumup_refund_attempt_id);

  const summaryCards = [
    { label: "Total games", value: summary.games_count },
    { label: "Total bookings", value: summary.bookings_count },
    { label: "Total players", value: summary.players_count },
    { label: "Total registered users", value: summary.profiles_count },
    {
      label: "Paid payments amount",
      value: `£${summary.paid_payments_amount_total.toFixed(2)}`,
    },
  ];

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-10 flex-wrap">
          <h1 className="text-5xl font-bold">Admin Panel</h1>
          <button
            onClick={() => router.push("/")}
            className="rounded-3xl bg-emerald-500 hover:bg-emerald-400 transition px-6 py-3 font-bold text-black text-sm md:text-base whitespace-nowrap"
          >
            Back to Home
          </button>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-4">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5"
            >
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                {card.label}
              </p>
              <p className="mt-3 text-2xl font-bold text-white">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <input
            placeholder="Game Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4"
          />

          <input
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4"
          />

          <input
            placeholder="Time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4"
          />

          <input
            placeholder="Price"
            type="number"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4"
          />

          <input
            placeholder="Max Players (12 for 6v6, 14 for 7v7, 16 for 8v8)"
            type="number"
            inputMode="numeric"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4"
          />

          <button
            type="button"
            onClick={saveGame}
            disabled={isSubmitting}
            className="w-full bg-green-500 hover:bg-green-400 transition duration-300 py-4 rounded-2xl font-bold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : editingGameId ? "Update Game" : "Create Game"}
          </button>

          {editingGameId ? (
            <button
              type="button"
              onClick={resetForm}
              className="w-full border border-zinc-700 bg-zinc-900 hover:border-white/20 transition duration-300 py-4 rounded-2xl font-bold text-white"
            >
              Cancel Edit
            </button>
          ) : null}
        </div>

        <div className="mt-12 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-2xl font-bold">Games</h2>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-400">
              {games.length} total
            </span>
          </div>

          {games.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
              No games created yet.
            </div>
          ) : (
            <div className="space-y-3">
              {games.map((game) => {
                const gameBookings = getGameBookings(game.id);

                return (
                  <div
                    key={game.id}
                    className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-bold text-white">{game.title}</h3>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                              game.status === "cancelled"
                                ? "border-red-500/30 bg-red-500/10 text-red-200"
                                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                            }`}
                          >
                            {game.status === "cancelled" ? "Cancelled" : "Active"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-400">
                          {game.location} • {game.time} • £{game.price} • {game.max_players} players
                        </p>
                        <p className="mt-2 text-sm font-semibold text-emerald-300">
                          {getBookingCount(game.id)} bookings
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => editGame(game)}
                          className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20"
                        >
                          Edit
                        </button>
                        {game.status !== "cancelled" ? (
                          <button
                            type="button"
                            onClick={() => cancelGame(game)}
                            disabled={cancellingGameId === game.id}
                            className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {cancellingGameId === game.id ? "Cancelling..." : "Cancel Game"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => deleteGame(game)}
                          className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 border-t border-zinc-800 pt-4">
                      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                        Booked players
                      </p>

                      {gameBookings.length === 0 ? (
                        <p className="mt-3 text-sm text-zinc-500">No players booked yet.</p>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {gameBookings.map((booking) => (
                            <span
                              key={booking.id}
                              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200"
                            >
                              <span>{booking.player_name?.trim() || "Unnamed player"}</span>
                              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-zinc-400">
                                {getPaymentStatusForBooking(booking)}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeBooking(booking)}
                                className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-200 transition hover:border-red-400"
                              >
                                Remove booking
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-12 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-2xl font-bold">Bookings</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={exportBookingsCsv}
                className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20"
              >
                Export bookings CSV
              </button>
              <span className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-400">
                {bookings.length} total
              </span>
            </div>
          </div>

          {bookings.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
              No bookings yet.
            </div>
          ) : (
            <div className="space-y-3">
              {bookings.map((booking) => {
                const game = getGameForBooking(booking);
                const payment = getPaymentDisplayForBooking(booking);

                return (
                  <div
                    key={booking.id}
                    className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5"
                  >
                    <div className="grid gap-4 md:grid-cols-[1fr_1.3fr_1fr_0.7fr_auto] md:items-center">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Player
                        </p>
                        <p className="mt-2 font-semibold text-white">
                          {booking.player_name?.trim() || "Unnamed player"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Game
                        </p>
                        <p className="mt-2 font-semibold text-white">
                          {game?.title || "Unknown game"}
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">
                          {game ? `${game.time || "TBD"} • ${game.location}` : "TBD"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Payment
                        </p>
                        <span className="mt-2 inline-flex rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                          {payment?.payment_status || "unknown"}
                        </span>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Amount
                        </p>
                        <p className="mt-2 font-semibold text-white">
                          {formatPaymentAmount(payment)}
                        </p>
                      </div>

                      <div className="md:text-right">
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void moveBooking(booking, new FormData(event.currentTarget));
                          }}
                          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap md:justify-end"
                        >
                          <select
                            name="target_game_id"
                            defaultValue={booking.game_id}
                            className="w-full min-w-0 rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 sm:w-auto"
                          >
                            {games.map((gameOption) => (
                              <option key={gameOption.id} value={gameOption.id}>
                                {gameOption.title}
                              </option>
                            ))}
                          </select>

                          <button
                            type="submit"
                            className="w-full rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 sm:w-auto"
                          >
                            Move
                          </button>

                          <button
                            type="button"
                            onClick={() => removeBooking(booking)}
                            className="w-full rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400 sm:w-auto"
                          >
                            Remove booking
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-12 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-2xl font-bold">Refund Requests</h2>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-400">
              {refundRequests.length} active
            </span>
          </div>

          {refundRequests.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
              No pending refund requests.
            </div>
          ) : (
            <div className="space-y-3">
              {refundRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5"
                >
                  <div className="grid gap-4 md:grid-cols-[1fr_1fr_0.7fr_0.9fr_auto] md:items-center">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                        Player
                      </p>
                      <p className="mt-2 font-semibold text-white">
                        {request.player_name || "Unknown player"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {request.player_email || request.user_id || "No email"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                        Request
                      </p>
                      <p className="mt-2 font-semibold text-white">
                        {request.description || "Refund requested"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {formatJoinedDate(request.created_at)}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {formatRefundRequestSource(request)}
                      </p>
                      {request.source_payment_transaction_code ? (
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                          SumUp {request.source_payment_transaction_code}
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                        Amount
                      </p>
                      <p className="mt-2 font-semibold text-white">
                        {formatRefundRequestAmount(request)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                        Status
                      </p>
                      <span className="mt-2 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">
                        {request.status || "pending"}
                      </span>
                      {request.status === "processing" ? (
                        <p className="mt-2 text-xs font-semibold text-amber-100">
                          {getRefundRequestStatusMessage(request)}
                        </p>
                      ) : null}
                      {request.status === "pending" && getRefundRequestStatusMessage(request) ? (
                        <p className="mt-2 text-xs font-semibold text-amber-100">
                          {getRefundRequestStatusMessage(request)}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2 md:items-end">
                      {canRefundViaSumUp(request) ? (
                        <button
                          type="button"
                          onClick={() => void processRefundRequest(request, "refund_via_sumup")}
                          disabled={processingRefundRequestId === request.id}
                          className="w-full rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                        >
                          {processingRefundRequestId === request.id ? "Processing..." : "Refund via SumUp"}
                        </button>
                      ) : null}
                      {canRecheckSumUpRefund(request) ? (
                        <button
                          type="button"
                          onClick={() => void processRefundRequest(request, "recheck_sumup_refund")}
                          disabled={processingRefundRequestId === request.id}
                          className="w-full rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                        >
                          {processingRefundRequestId === request.id ? "Checking..." : "Recheck SumUp"}
                        </button>
                      ) : null}
                      {canManuallyProcessRefund(request) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void processRefundRequest(request, "approve")}
                            disabled={processingRefundRequestId === request.id}
                            className="w-full rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                          >
                            {processingRefundRequestId === request.id ? "Processing..." : "Mark Refunded"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void processRefundRequest(request, "reject")}
                            disabled={processingRefundRequestId === request.id}
                            className="w-full rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {!canRefundViaSumUp(request) &&
                      !canRecheckSumUpRefund(request) &&
                      !canManuallyProcessRefund(request) ? (
                        <p className="max-w-48 text-right text-xs text-zinc-400">
                          {getRefundRequestStatusMessage(request) || "No automatic action is available."}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-12 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-2xl font-bold">Waiting List</h2>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-400">
              {waitingList.length} total
            </span>
          </div>

          {waitingList.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
              No waiting list entries yet.
            </div>
          ) : (
            <div className="space-y-3">
              {waitingList.map((entry) => {
                const game = getGameById(entry.game_id);

                return (
                  <div
                    key={entry.id}
                    className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5"
                  >
                    <div className="grid gap-4 md:grid-cols-[1fr_1.3fr_0.8fr_1fr] md:items-center">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Player
                        </p>
                        <p className="mt-2 font-semibold text-white">
                          {entry.player_name?.trim() || "Unnamed player"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Game
                        </p>
                        <p className="mt-2 font-semibold text-white">
                          {game?.title || "Unknown game"}
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">
                          {game ? `${game.time || "TBD"} • ${game.location}` : "TBD"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Status
                        </p>
                        <span className="mt-2 inline-flex rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                          {entry.status || "waiting"}
                        </span>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Joined
                        </p>
                        <p className="mt-2 font-semibold text-white">
                          {formatJoinedDate(entry.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
