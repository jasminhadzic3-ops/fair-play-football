"use client";

interface Booking {
  id: number;
  game_id: number;
  player_name: string;
}

interface TeamListProps {
  bookings: Booking[];
  onLeaveGame: (bookingId: number) => Promise<void> | void;
  currentPlayerName?: string;
}

export default function TeamList({ bookings, onLeaveGame, currentPlayerName }: TeamListProps) {
  const midpoint = Math.ceil(bookings.length / 2);
  const teamA = bookings.slice(0, midpoint);
  const teamB = bookings.slice(midpoint);
  const normalizedCurrentPlayerName = currentPlayerName?.trim().toLowerCase();

  const renderTeam = (team: Booking[], teamName: string) => (
    <div className="flex-1">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold uppercase tracking-[0.2em] text-white">
          {teamName}
        </h3>
        <span className="text-xs text-zinc-500">{team.length} players</span>
      </div>
      <div className="space-y-3">
        {team.map((booking) => (
          <div
            key={booking.id}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl px-4 py-3 flex items-center justify-between gap-3 transition hover:border-zinc-600"
          >
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-11 h-11 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-semibold text-white shadow-sm">
                {booking.player_name
                  .split(" ")
                  .map((part) => part.charAt(0).toUpperCase())
                  .slice(0, 2)
                  .join("")}
              </div>
              <span className="text-sm text-white font-medium truncate">
                {booking.player_name}
              </span>
            </div>
            {normalizedCurrentPlayerName &&
            booking.player_name.trim().toLowerCase() === normalizedCurrentPlayerName ? (
              <button
                onClick={() => onLeaveGame(booking.id)}
                className="text-xs uppercase tracking-[0.1em] text-zinc-300 hover:text-white transition"
              >
                Leave
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );

  if (bookings.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      {renderTeam(teamA, "TEAM A ⚪")}
      {renderTeam(teamB, "TEAM B ⚫")}
    </div>
  );
}
