"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AdminGameFilter,
  AdminGameLifecycle,
  AdminGameSafetySummary,
  getAdminGameLifecycle,
  isValidAdminMoveDestination,
} from "@/lib/adminGameSafety";
import { supabase } from "@/lib/supabase";

interface Game {
  id: number;
  title: string;
  location: string;
  time: string;
  starts_at?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  price: number;
  max_players: number;
  status?: "active" | "cancelled" | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  admin_safety?: AdminGameSafetySummary | null;
  refund_candidates?: AdminRefundCandidate[];
  financial_records?: AdminFinancialRecord[];
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

type AdminRefundCandidateStatus =
  | "eligible"
  | "requested"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"
  | "not_eligible";

interface AdminRefundCandidate {
  source_wallet_transaction_id: number;
  game_id: number | null;
  booking_id: number | null;
  payment_id: number | null;
  user_id?: string | null;
  player_name?: string | null;
  amount: number;
  currency: string;
  original_payment_method?: string | null;
  refund_status: AdminRefundCandidateStatus;
  refund_eligible: boolean;
  safe_reason: string;
  refund_request_id?: number | null;
  refund_request_status?: string | null;
  sumup_refund_attempt_id?: number | null;
  sumup_refund_attempt_status?: string | null;
}

type AdminFinancialRecord = {
  record_type:
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
  player_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  created_at?: string | null;
  category: string;
};

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
  automaticSumUpRefundMode?: "disabled" | "test_mock" | "local_sandbox_real" | "production_real";
  summary: AdminSummary;
}

type AdminRefundCandidateResponse = {
  refund_candidate?: AdminRefundCandidate | null;
  automatic_refund?: {
    status?: string | null;
    message?: string | null;
  } | null;
  error?: string;
};

interface CancelGameResponse {
  game?: Game;
  sumup_credited_count?: number;
  wallet_credited_count?: number;
  total_credited_count?: number;
  already_cancelled?: boolean;
  email_warning?: string;
  error?: string;
}

const londonFormFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const londonMoveFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const gameFilters: Array<{ value: AdminGameFilter; label: string }> = [
  { value: "active_upcoming", label: "Active / Upcoming" },
  { value: "cancelled", label: "Cancelled" },
  { value: "past_legacy", label: "Past / Legacy" },
  { value: "has_financial_history", label: "Has Financial History" },
  { value: "has_refunds", label: "Has Refunds" },
  { value: "safe_to_delete", label: "Safe to Delete" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

function getLondonKickoffFormValues(startsAt: string | null | undefined) {
  if (!startsAt) {
    return { kickoffDate: "", kickoffTime: "" };
  }

  const date = new Date(startsAt);

  if (Number.isNaN(date.getTime())) {
    return { kickoffDate: "", kickoffTime: "" };
  }

  const parts = londonFormFormatter.formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  const year = valueByType.get("year");
  const month = valueByType.get("month");
  const day = valueByType.get("day");
  const hour = valueByType.get("hour");
  const minute = valueByType.get("minute");

  if (!year || !month || !day || !hour || !minute) {
    return { kickoffDate: "", kickoffTime: "" };
  }

  return {
    kickoffDate: `${year}-${month}-${day}`,
    kickoffTime: `${hour}:${minute}`,
  };
}

function formatLondonKickoff(startsAt: string | null | undefined) {
  if (!startsAt) {
    return "Legacy time";
  }

  const date = new Date(startsAt);

  return Number.isNaN(date.getTime()) ? "Invalid kickoff" : londonMoveFormatter.format(date);
}

function getFallbackGameSafety(game: Game, bookingsCount: number): AdminGameSafetySummary {
  return {
    bookings_count: bookingsCount,
    spaces_remaining: Math.max(0, game.max_players - bookingsCount),
    paid_sumup_payments_count: 0,
    wallet_bookings_count: 0,
    waiting_list_count: 0,
    cancellation_credits_count: 0,
    pending_refund_requests_count: 0,
    completed_refunds_count: 0,
    unresolved_refund_attempts_count: 0,
    reminder_deliveries_count: 0,
    payment_records_count: 0,
    wallet_transactions_count: 0,
    refund_attempts_count: 0,
    waiting_list_notifications_count: 0,
    has_financial_history: false,
    has_refunds: false,
    safe_to_delete: bookingsCount === 0,
    delete_block_reasons: bookingsCount > 0 ? [`${bookingsCount} booking${bookingsCount === 1 ? "" : "s"}`] : [],
  };
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
  const [gameSearch, setGameSearch] = useState("");
  const [gameFilter, setGameFilter] = useState<AdminGameFilter>("active_upcoming");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [kickoffDate, setKickoffDate] = useState("");
  const [kickoffTime, setKickoffTime] = useState("");
  const [legacyDisplayTime, setLegacyDisplayTime] = useState("");
  const [price, setPrice] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingGameId, setEditingGameId] = useState<number | null>(null);
  const [cancellingGameId, setCancellingGameId] = useState<number | null>(null);
  const [processingRefundRequestId, setProcessingRefundRequestId] = useState<number | null>(null);
  const [processingAdminRefundSourceId, setProcessingAdminRefundSourceId] = useState<number | null>(null);
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

  const visibleGames = useMemo(() => {
    const query = gameSearch.trim().toLowerCase();
    const now = new Date();

    return games.filter((game) => {
      const bookingsCount = bookings.filter((booking) => booking.game_id === game.id).length;
      const safety = game.admin_safety ?? getFallbackGameSafety(game, bookingsCount);
      const lifecycle = getAdminGameLifecycle(game, now);
      const archived = lifecycle === "archived";
      const matchesSearch =
        !query ||
        game.title?.toLowerCase().includes(query) ||
        game.location?.toLowerCase().includes(query);
      const matchesFilter =
        gameFilter === "archived"
          ? archived
          : !archived &&
            (gameFilter === "all" ||
              lifecycle === gameFilter ||
              (gameFilter === "has_financial_history" && safety.has_financial_history) ||
              (gameFilter === "has_refunds" && safety.has_refunds) ||
              (gameFilter === "safe_to_delete" && safety.safe_to_delete));

      return matchesSearch && matchesFilter;
    });
  }, [gameFilter, gameSearch, games, bookings]);

  const getValidMoveDestinations = useCallback(
    (booking: Booking) => {
      const now = new Date();

      return games
        .filter((game) =>
          isValidAdminMoveDestination(
            game,
            booking.game_id,
            bookings.filter((gameBooking) => gameBooking.game_id === game.id).length,
            now
          )
        )
        .map((game) => ({
          ...game,
          remainingSpaces: Math.max(
            0,
            game.max_players - bookings.filter((gameBooking) => gameBooking.game_id === game.id).length
          ),
        }));
    },
    [games, bookings]
  );

  const resetForm = () => {
    setTitle("");
    setLocation("");
    setKickoffDate("");
    setKickoffTime("");
    setLegacyDisplayTime("");
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
    const hasStructuredKickoff = Boolean(kickoffDate && kickoffTime);
    const hasPartialKickoff = Boolean(kickoffDate || kickoffTime);

    if (
      !title.trim() ||
      !location.trim() ||
      (!hasStructuredKickoff && (!editingGameId || !legacyDisplayTime.trim())) ||
      (hasPartialKickoff && !hasStructuredKickoff) ||
      Number.isNaN(numericPrice) ||
      Number.isNaN(numericMaxPlayers) ||
      ![12, 14, 16].includes(numericMaxPlayers)
    ) {
      alert("Please fill in all fields with a valid kickoff date and time. Max players must be 12 (6v6), 14 (7v7), or 16 (8v8).");
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
        ...(hasStructuredKickoff
          ? {
              kickoff_date: kickoffDate,
              kickoff_time: kickoffTime,
            }
          : {
              time: legacyDisplayTime,
            }),
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
    setLegacyDisplayTime(game.time);
    const formValues = getLondonKickoffFormValues(game.starts_at);
    setKickoffDate(formValues.kickoffDate);
    setKickoffTime(formValues.kickoffTime);
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

  const archiveGame = async (game: Game, action: "archive" | "unarchive") => {
    const confirmed = window.confirm(
      action === "archive"
        ? [
            `Archive "${game.title}"?`,
            "",
            "It will disappear from normal Admin filters and public booking.",
            "No payment, wallet, refund, booking, or cancellation history will be deleted.",
            "It remains available under Archived and can be restored later.",
          ].join("\n")
        : `Unarchive "${game.title}"? It will return to the normal Admin filters for its current status and kickoff.`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/games/${game.id}`, {
        method: "PATCH",
        headers: await getAdminAuthHeaders(),
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        alert(await readApiError(response));
        return;
      }

      await fetchAdminData();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to update archive state.");
    }
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
      "This moves the player booking and current payment linkage to the destination. It does not refund payment or edit historical refund/credit records."
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

  const processAdminRefundCandidate = async (game: Game, candidate: AdminRefundCandidate) => {
    if (processingAdminRefundSourceId || !candidate.refund_eligible) {
      return;
    }

    const amount = formatAdminRefundCandidateAmount(candidate);
    const confirmed = window.confirm(
      [
        `Refund ${candidate.player_name || "this player"} for ${game.title}?`,
        "",
        `Amount: ${amount}`,
        `Original payment method: ${candidate.original_payment_method || "SumUp"}`,
        "",
        "This will create or reserve the existing wallet refund request, then attempt one real SumUp card refund if live refunds are enabled.",
        "Do not retry if SumUp returns an unknown outcome; use Recheck SumUp in the Refund Requests queue.",
      ].join("\n")
    );

    if (!confirmed) {
      return;
    }

    setProcessingAdminRefundSourceId(candidate.source_wallet_transaction_id);

    try {
      const response = await fetch("/api/admin/refund-requests", {
        method: "POST",
        headers: await getAdminAuthHeaders(),
        body: JSON.stringify({
          source_wallet_transaction_id: candidate.source_wallet_transaction_id,
        }),
      });
      const result = (await response.json().catch(() => null)) as AdminRefundCandidateResponse | null;

      if (!response.ok) {
        alert(result?.error || "Unable to create admin refund.");
        return;
      }

      if (result?.refund_candidate) {
        setGames((currentGames) =>
          currentGames.map((currentGame) =>
            currentGame.id === game.id
              ? {
                  ...currentGame,
                  refund_candidates: (currentGame.refund_candidates ?? []).map((currentCandidate) =>
                    currentCandidate.source_wallet_transaction_id === candidate.source_wallet_transaction_id
                      ? result.refund_candidate!
                      : currentCandidate
                  ),
                }
              : currentGame
          )
        );
      }

      alert(result?.automatic_refund?.message || "Refund request updated.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to create admin refund.");
    } finally {
      setProcessingAdminRefundSourceId(null);
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

  const formatAdminRefundCandidateAmount = (candidate: AdminRefundCandidate) => {
    const amount = Number(candidate.amount);

    if (Number.isNaN(amount)) {
      return "—";
    }

    return `${candidate.currency === "GBP" || !candidate.currency ? "£" : `${candidate.currency} `}${amount.toFixed(2)}`;
  };

  const formatFinancialRecordAmount = (record: AdminFinancialRecord) => {
    if (record.amount === null || record.amount === undefined) {
      return "—";
    }

    const amount = Number(record.amount);

    if (Number.isNaN(amount)) {
      return "—";
    }

    return `${record.currency === "GBP" || !record.currency ? "£" : `${record.currency} `}${amount.toFixed(2)}`;
  };

  const formatFinancialRecordDate = (record: AdminFinancialRecord) =>
    formatJoinedDate(record.created_at);

  const formatArchiveDate = (archivedAt: string | null | undefined) => {
    if (!archivedAt) {
      return "Archive date unavailable";
    }

    const date = new Date(archivedAt);

    if (Number.isNaN(date.getTime())) {
      return "Archive date unavailable";
    }

    return `Archived on ${date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`;
  };

  const getLifecycleLabel = (game: Game, lifecycle: AdminGameLifecycle) => {
    if (lifecycle === "archived") {
      const unarchivedLifecycle = getAdminGameLifecycle({ ...game, archived_at: null });

      return unarchivedLifecycle === "cancelled"
        ? "Cancelled"
        : unarchivedLifecycle === "active_upcoming"
          ? "Active"
          : "Past / Legacy";
    }

    return lifecycle === "cancelled"
      ? "Cancelled"
      : lifecycle === "active_upcoming"
        ? "Active"
        : "Past / Legacy";
  };

  const getFinancialSummary = (safety: AdminGameSafetySummary, financialRecords: AdminFinancialRecord[]) => {
    const totalPaidSumUpAmount = financialRecords
      .filter((record) => record.record_type === "paid_sumup_payment")
      .reduce((total, record) => total + Number(record.amount ?? 0), 0);
    const totalRefundedAmount = financialRecords
      .filter((record) => record.record_type === "refund_completed")
      .reduce((total, record) => total + Number(record.amount ?? 0), 0);

    return {
      bookingsCount: safety.bookings_count,
      totalPaidSumUpAmount,
      totalRefundedAmount,
      paymentCount: safety.payment_records_count,
      cancellationCreditCount: safety.cancellation_credits_count,
      completedRefundCount: safety.completed_refunds_count,
    };
  };

  const canArchiveGame = (lifecycle: AdminGameLifecycle) =>
    lifecycle === "cancelled" || lifecycle === "past_legacy";

  const renderFinancialRecordsPanel = (financialRecords: AdminFinancialRecord[]) =>
    financialRecords.length > 0 ? (
      <details className="mt-5 border-t border-zinc-800 pt-4">
        <summary className="cursor-pointer text-xs uppercase tracking-[0.3em] text-zinc-500">
          Financial records
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-semibold">Type</th>
                <th className="py-2 pr-4 font-semibold">Player</th>
                <th className="py-2 pr-4 font-semibold">Amount</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 font-semibold">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {financialRecords.map((record, index) => (
                <tr key={`${record.record_type}-${record.created_at ?? "unknown"}-${index}`}>
                  <td className="py-3 pr-4 font-semibold text-white">{record.record_type.replaceAll("_", " ")}</td>
                  <td className="py-3 pr-4">{record.player_name?.trim() || "Unknown player"}</td>
                  <td className="py-3 pr-4">{formatFinancialRecordAmount(record)}</td>
                  <td className="py-3 pr-4">{record.status || "unknown"}</td>
                  <td className="py-3 pr-4">{formatFinancialRecordDate(record)}</td>
                  <td className="py-3">{record.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    ) : null;

  const getAdminRefundCandidateStatusLabel = (candidate: AdminRefundCandidate) => {
    switch (candidate.refund_status) {
      case "eligible":
        return "Eligible";
      case "requested":
        return "Requested";
      case "processing":
        return "Processing";
      case "needs_review":
        return "Needs review";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      default:
        return "Not eligible";
    }
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

          <div className="grid gap-4 md:grid-cols-2">
            <input
              aria-label="Kickoff date"
              type="date"
              value={kickoffDate}
              onChange={(e) => setKickoffDate(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4"
            />

            <input
              aria-label="Kickoff time"
              type="time"
              value={kickoffTime}
              onChange={(e) => setKickoffTime(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4"
            />
          </div>

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
              {visibleGames.length} shown / {games.length} total
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <label className="sr-only" htmlFor="admin-game-search">
              Search games
            </label>
            <input
              id="admin-game-search"
              value={gameSearch}
              onChange={(event) => setGameSearch(event.target.value)}
              placeholder="Search games by title or location"
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-semibold text-white placeholder:text-zinc-500"
            />
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:justify-end lg:overflow-visible lg:pb-0">
              {gameFilters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setGameFilter(filter.value)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                    gameFilter === filter.value
                      ? "border-emerald-400 bg-emerald-500/15 text-emerald-100"
                      : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-white/20"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {games.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
              No games created yet.
            </div>
          ) : visibleGames.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
              No games match this search and filter.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleGames.map((game) => {
                const gameBookings = getGameBookings(game.id);
                const safety = game.admin_safety ?? getFallbackGameSafety(game, gameBookings.length);
                const lifecycle = getAdminGameLifecycle(game);
                const isArchived = lifecycle === "archived";
                const financialRecords = game.financial_records ?? [];
                const financialSummary = getFinancialSummary(safety, financialRecords);

                if (isArchived) {
                  return (
                    <div
                      key={game.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
                    >
                      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-lg font-bold text-white">{game.title}</h3>
                            <span className="rounded-full border border-zinc-600 bg-zinc-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                              Archived
                            </span>
                            <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-xs font-semibold text-zinc-300">
                              {getLifecycleLabel(game, lifecycle)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-zinc-400">
                            {formatArchiveDate(game.archived_at)} • {formatLondonKickoff(game.starts_at)} • {game.location}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                            <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                              {financialSummary.bookingsCount} bookings
                            </span>
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                              £{financialSummary.totalPaidSumUpAmount.toFixed(2)} paid SumUp
                            </span>
                            <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200">
                              £{financialSummary.totalRefundedAmount.toFixed(2)} refunded
                            </span>
                            <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                              {financialSummary.paymentCount} payments
                            </span>
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-100">
                              {financialSummary.cancellationCreditCount} credits
                            </span>
                            <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                              {financialSummary.completedRefundCount} completed refunds
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void archiveGame(game, "unarchive")}
                          className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-400"
                        >
                          Restore
                        </button>
                      </div>

                      <details className="mt-4 border-t border-zinc-800 pt-3">
                        <summary className="cursor-pointer text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Expand
                        </summary>

                        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                          <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                            {safety.spaces_remaining} spaces
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                            {safety.wallet_bookings_count} wallet bookings
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                            {safety.waiting_list_count} waiting
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                            {safety.refund_attempts_count} refund attempts
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-black px-3 py-1 text-zinc-300">
                            {safety.reminder_deliveries_count} reminders
                          </span>
                        </div>

                        {!safety.safe_to_delete ? (
                          <p className="mt-3 text-sm text-amber-100">
                            Delete is blocked by {safety.delete_block_reasons.join(", ")}.
                          </p>
                        ) : (
                          <p className="mt-3 text-sm text-emerald-200">Safe to delete.</p>
                        )}

                        {renderFinancialRecordsPanel(financialRecords)}

                        {gameBookings.length > 0 ? (
                          <details className="mt-5 border-t border-zinc-800 pt-4">
                            <summary className="cursor-pointer text-xs uppercase tracking-[0.3em] text-zinc-500">
                              Booked-player history
                            </summary>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {gameBookings.map((booking) => (
                                <span
                                  key={booking.id}
                                  className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-black px-3 py-2 text-sm font-medium text-zinc-200"
                                >
                                  <span>{booking.player_name?.trim() || "Unnamed player"}</span>
                                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-zinc-400">
                                    {getPaymentStatusForBooking(booking)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </details>
                    </div>
                  );
                }

                return (
                  <div
                    key={game.id}
                    className={`rounded-3xl border p-5 ${
                      isArchived ? "border-zinc-800 bg-zinc-950" : "border-zinc-800 bg-zinc-900"
                    }`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-bold text-white">{game.title}</h3>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                              isArchived
                                ? "border-zinc-600 bg-zinc-950 text-zinc-300"
                                : game.status === "cancelled"
                                ? "border-red-500/30 bg-red-500/10 text-red-200"
                                : lifecycle === "active_upcoming"
                                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                  : "border-zinc-600 bg-zinc-950 text-zinc-300"
                            }`}
                          >
                            {isArchived
                              ? "Archived"
                              : game.status === "cancelled"
                              ? "Cancelled"
                              : lifecycle === "active_upcoming"
                                ? "Active"
                                : "Past / Legacy"}
                          </span>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                              safety.safe_to_delete
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                            }`}
                          >
                            {safety.safe_to_delete ? "Safe to delete" : "Delete blocked"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-400">
                          {game.location} • {game.time} • £{game.price} • {game.max_players} players
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-300">
                            {safety.bookings_count} bookings
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-300">
                            {safety.spaces_remaining} spaces
                          </span>
                          {safety.paid_sumup_payments_count > 0 ? (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                              {safety.paid_sumup_payments_count} paid SumUp
                            </span>
                          ) : null}
                          {safety.wallet_bookings_count > 0 ? (
                            <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200">
                              {safety.wallet_bookings_count} wallet bookings
                            </span>
                          ) : null}
                          {safety.waiting_list_count > 0 ? (
                            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-300">
                              {safety.waiting_list_count} waiting
                            </span>
                          ) : null}
                          {safety.cancellation_credits_count > 0 ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-100">
                              {safety.cancellation_credits_count} credits
                            </span>
                          ) : null}
                          {safety.pending_refund_requests_count > 0 ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-100">
                              {safety.pending_refund_requests_count} pending refunds
                            </span>
                          ) : null}
                          {safety.completed_refunds_count > 0 ? (
                            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-300">
                              {safety.completed_refunds_count} completed refunds
                            </span>
                          ) : null}
                          {safety.unresolved_refund_attempts_count > 0 ? (
                            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-200">
                              {safety.unresolved_refund_attempts_count} refund review
                            </span>
                          ) : null}
                          {safety.reminder_deliveries_count > 0 ? (
                            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-300">
                              {safety.reminder_deliveries_count} reminders
                            </span>
                          ) : null}
                        </div>
                        {!safety.safe_to_delete ? (
                          <p className="mt-3 text-sm text-amber-100">
                            Keep for records. Delete is blocked by {safety.delete_block_reasons.join(", ")}.
                          </p>
                        ) : null}
                      </div>

                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => editGame(game)}
                          className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20"
                        >
                          Edit
                        </button>
                        {!isArchived && canArchiveGame(lifecycle) ? (
                          <button
                            type="button"
                            onClick={() => void archiveGame(game, "archive")}
                            className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-white/20"
                          >
                            Archive
                          </button>
                        ) : null}
                        {isArchived ? (
                          <button
                            type="button"
                            onClick={() => void archiveGame(game, "unarchive")}
                            className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-400"
                          >
                            Unarchive
                          </button>
                        ) : null}
                        {!isArchived && game.status !== "cancelled" ? (
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

                    {renderFinancialRecordsPanel(financialRecords)}

                    {game.refund_candidates && game.refund_candidates.length > 0 ? (
                      <details className="mt-5 border-t border-zinc-800 pt-4" open={gameFilter === "has_refunds"}>
                        <summary className="cursor-pointer text-xs uppercase tracking-[0.3em] text-zinc-500">
                          Refunds / cancellation credits
                        </summary>
                        <div className="mt-3 space-y-2">
                          {game.refund_candidates.map((candidate) => (
                            <div
                              key={candidate.source_wallet_transaction_id}
                              className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 md:grid-cols-[1fr_auto_auto] md:items-center"
                            >
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-white">
                                    {candidate.player_name || "Unknown player"}
                                  </p>
                                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
                                    {getAdminRefundCandidateStatusLabel(candidate)}
                                  </span>
                                </div>
                                <p className="mt-1 text-sm text-zinc-400">
                                  {formatAdminRefundCandidateAmount(candidate)} •{" "}
                                  {candidate.original_payment_method === "sumup" ? "SumUp" : "Wallet"} cancellation credit
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">{candidate.safe_reason}</p>
                              </div>

                              <div className="text-sm font-semibold text-zinc-300 md:text-right">
                                Credit {candidate.source_wallet_transaction_id}
                              </div>

                              {candidate.refund_eligible ? (
                                <button
                                  type="button"
                                  onClick={() => void processAdminRefundCandidate(game, candidate)}
                                  disabled={
                                    processingAdminRefundSourceId === candidate.source_wallet_transaction_id
                                  }
                                  className="w-full rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                                >
                                  {processingAdminRefundSourceId === candidate.source_wallet_transaction_id
                                    ? "Processing..."
                                    : "Refund via SumUp"}
                                </button>
                              ) : (
                                <p className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-center text-sm font-semibold text-zinc-400">
                                  No action
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    <details className="mt-5 border-t border-zinc-800 pt-4" open={!isArchived}>
                      <summary className="cursor-pointer text-xs uppercase tracking-[0.3em] text-zinc-500">
                        Booked players
                      </summary>

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
                    </details>
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
                const validMoveDestinations = getValidMoveDestinations(booking);

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
                          {validMoveDestinations.length > 0 ? (
                            <>
                              <select
                                name="target_game_id"
                                defaultValue=""
                                className="w-full min-w-0 rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 sm:w-auto"
                              >
                                <option value="" disabled>
                                  Move to...
                                </option>
                                {validMoveDestinations.map((gameOption) => (
                                  <option key={gameOption.id} value={gameOption.id}>
                                    {gameOption.title} - {formatLondonKickoff(gameOption.starts_at)} -{" "}
                                    {gameOption.remainingSpaces} spaces
                                  </option>
                                ))}
                              </select>

                              <button
                                type="submit"
                                className="w-full rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 sm:w-auto"
                              >
                                Move
                              </button>
                            </>
                          ) : (
                            <p className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-400">
                              No safe move destination
                            </p>
                          )}

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
