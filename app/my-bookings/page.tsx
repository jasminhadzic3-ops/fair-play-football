"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface Booking {
  id: number;
  game_id: number;
  user_id: string;
}

interface Game {
  id: number;
  title: string;
  location: string;
  time?: string;
  price?: number;
}

interface JoinedBooking {
  booking: Booking;
  game: Game;
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<JoinedBooking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [leavingBookingId, setLeavingBookingId] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchBookings = async () => {
    setIsLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setUserId(user?.id ?? null);

    if (!user) {
      setBookings([]);
      setIsLoading(false);
      return;
    }

    const { data: bookingData, error: bookingError } = await supabase
      .from("bookings")
      .select("id, game_id, user_id")
      .eq("user_id", user.id);

    if (bookingError) {
      console.error("Unable to load bookings:", bookingError.message);
      setBookings([]);
      setIsLoading(false);
      return;
    }

    const gameIds = [...new Set((bookingData ?? []).map((booking) => booking.game_id))];

    if (gameIds.length === 0) {
      setBookings([]);
      setIsLoading(false);
      return;
    }

    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .select("id, title, location, time, price")
      .in("id", gameIds);

    if (gameError) {
      console.error("Unable to load booked games:", gameError.message);
      setBookings([]);
      setIsLoading(false);
      return;
    }

    const gamesById = new Map((gameData ?? []).map((game) => [game.id, game]));

    const joinedBookings = (bookingData ?? []).reduce<JoinedBooking[]>((items, booking) => {
      const game = gamesById.get(booking.game_id);

      if (game) {
        items.push({ booking, game });
      }

      return items;
    }, []);

    setBookings(joinedBookings);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchBookings();

    const refreshBookings = () => {
      fetchBookings();
    };

    const refreshVisibleBookings = () => {
      if (document.visibilityState === "visible") {
        fetchBookings();
      }
    };

    window.addEventListener("focus", refreshBookings);
    window.addEventListener("storage", refreshBookings);
    document.addEventListener("visibilitychange", refreshVisibleBookings);

    return () => {
      window.removeEventListener("focus", refreshBookings);
      window.removeEventListener("storage", refreshBookings);
      document.removeEventListener("visibilitychange", refreshVisibleBookings);
    };
  }, []);

  const leaveGame = async (bookingId: number) => {
    if (leavingBookingId) return;

    setLeavingBookingId(bookingId);

    const session = (await supabase.auth.getSession()).data.session;

    if (!session?.access_token) {
      console.error("Unable to leave game: missing session.");
      setLeavingBookingId(null);
      return;
    }

    const response = await fetch(`/api/bookings/${bookingId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Unable to leave game:", result?.error || "Unknown error");
    } else {
      await fetchBookings();
    }

    setLeavingBookingId(null);
  };

  return (
    <main className="min-h-screen bg-black text-white p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-10 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500 mb-3">
              Account
            </p>
            <h1 className="text-4xl md:text-5xl font-bold">My Bookings</h1>
          </div>
          <Link
            href="/"
            className="rounded-3xl border border-stone-300/20 bg-zinc-950 px-6 py-3 font-bold text-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-stone-200/35 hover:bg-zinc-900 text-sm md:text-base whitespace-nowrap"
          >
            Back to Home
          </Link>
        </div>

        {!userId && !isLoading ? (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            Sign in to view your bookings.
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            Loading bookings...
          </div>
        ) : null}

        {userId && !isLoading && bookings.length === 0 ? (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            You have not joined any games yet.
          </div>
        ) : null}

        {bookings.length > 0 ? (
          <div className="space-y-5">
            {bookings.map(({ booking, game }) => (
              <div
                key={booking.id}
                className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.32)] transition hover:border-stone-200/20 hover:shadow-[0_22px_70px_rgba(0,0,0,0.42)] sm:p-6"
              >
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-2xl font-bold tracking-tight text-white">{game.title}</h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                        <p className="truncate text-sm font-semibold text-zinc-200">{game.location}</p>
                      </div>
                      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                        <p className="text-sm font-semibold text-zinc-200">{game.time || "TBD"}</p>
                      </div>
                      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                        <p className="text-sm font-semibold text-zinc-200">£{game.price ?? 0}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-stone-300">
                      Payment status: Paid
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => leaveGame(booking.id)}
                    disabled={leavingBookingId === booking.id}
                    className="w-full rounded-full border border-stone-300/20 bg-zinc-900 px-5 py-3 text-sm font-bold text-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:border-red-300/40 hover:bg-red-500/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                  >
                    {leavingBookingId === booking.id ? "Leaving..." : "Leave Game"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
