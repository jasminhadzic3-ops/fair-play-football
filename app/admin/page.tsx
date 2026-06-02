"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Game {
  id: number;
  title: string;
  location: string;
  time: string;
  price: number;
  max_players: number;
}

interface Booking {
  id: number;
  game_id: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [games, setGames] = useState<Game[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [time, setTime] = useState("");
  const [price, setPrice] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingGameId, setEditingGameId] = useState<number | null>(null);

  const fetchAdminData = async () => {
    const { data: gamesData, error: gamesError } = await supabase
      .from("games")
      .select("*")
      .order("id", { ascending: true });
    const { data: bookingsData, error: bookingsError } = await supabase
      .from("bookings")
      .select("id, game_id");

    if (gamesError) {
      console.log(gamesError);
      alert(JSON.stringify(gamesError));
    } else {
      setGames(gamesData ?? []);
    }

    if (bookingsError) {
      console.log(bookingsError);
      alert(JSON.stringify(bookingsError));
    } else {
      setBookings(bookingsData ?? []);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const resetForm = () => {
    setTitle("");
    setLocation("");
    setTime("");
    setPrice("");
    setMaxPlayers("");
    setEditingGameId(null);
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

    setIsSubmitting(true);

    try {
      const payload = {
        title,
        location,
        time,
        price: numericPrice,
        max_players: numericMaxPlayers,
      };

      const { error } = editingGameId
        ? await supabase.from("games").update(payload).eq("id", editingGameId)
        : await supabase.from("games").insert([payload]);

      if (error) {
        console.log(error);
        alert(JSON.stringify(error));
      } else {
        alert(editingGameId ? "Game updated!" : "Game created!");
        resetForm();
        await fetchAdminData();
      }
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

    const { error } = await supabase.from("games").delete().eq("id", game.id);

    if (error) {
      console.log(error);
      alert(JSON.stringify(error));
      return;
    }

    if (editingGameId === game.id) {
      resetForm();
    }

    await fetchAdminData();
  };

  const getBookingCount = (gameId: number) =>
    bookings.filter((booking) => booking.game_id === gameId).length;

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
              {games.map((game) => (
                <div
                  key={game.id}
                  className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-white">{game.title}</h3>
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
                      <button
                        type="button"
                        onClick={() => deleteGame(game)}
                        className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
