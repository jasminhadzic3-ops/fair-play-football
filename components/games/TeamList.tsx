"use client";

interface Booking {
  id: number;
  game_id: number;
  player_name: string;
  is_current_user?: boolean | null;
  avatar_url?: string | null;
  favourite_position?: string | null;
}

const positionLabels: Record<string, string> = {
  Goalkeeper: "GK",
  Defender: "DEF",
  Midfielder: "MID",
  Forward: "FWD",
  Winger: "WING",
  Flexible: "FLEX",
};

function getInitials(playerName: string) {
  return playerName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("") || "FP";
}

interface TeamListProps {
  bookings: Booking[];
  onLeaveGame: (bookingId: number) => Promise<void> | void;
  currentUserId?: string | null;
}

export default function TeamList({
  bookings,
  onLeaveGame,
  currentUserId,
}: TeamListProps) {
  const midpoint = Math.ceil(bookings.length / 2);
  const teamA = bookings.slice(0, midpoint);
  const teamB = bookings.slice(midpoint);

  const renderTeam = (team: Booking[], teamName: string, teamMarker: string) => (
    <section className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/75 shadow-[0_18px_45px_rgba(0,0,0,0.22)]">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span
            className="flex size-9 items-center justify-center rounded-full border border-stone-200/15 bg-stone-100/[0.08] text-xs font-bold text-stone-200"
            aria-hidden="true"
          >
            {teamMarker}
          </span>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-[0.22em] text-white sm:text-[15px]">
              {teamName}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">Match squad</p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-400">
          {team.length} {team.length === 1 ? "player" : "players"}
        </span>
      </div>
      <div className="space-y-2 p-2.5 sm:p-3">
        {team.map((booking) => {
          const isCurrentUserBooking = currentUserId && booking.is_current_user === true;
          const initials = getInitials(booking.player_name);
          const position = booking.favourite_position
            ? positionLabels[booking.favourite_position]
            : null;

          return (
            <div
              key={booking.id}
              className="group flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-transparent bg-white/[0.035] px-3 py-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.055] sm:px-3.5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-zinc-800 text-xs font-bold tracking-[0.06em] text-stone-100 shadow-[0_8px_24px_rgba(0,0,0,0.3)] sm:size-12">
                  {booking.avatar_url ? (
                    <img
                      src={booking.avatar_url}
                      alt={`${booking.player_name} profile`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-stone-100 sm:text-[15px]">
                      {booking.player_name}
                    </p>
                    {isCurrentUserBooking ? (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">
                        You
                      </span>
                    ) : null}
                  </div>
                  {position ? (
                    <span className="mt-1 inline-flex rounded-full border border-stone-200/10 bg-stone-100/[0.045] px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-zinc-400">
                      {position}
                    </span>
                  ) : null}
                </div>
              </div>
              {isCurrentUserBooking ? (
                <button
                  type="button"
                  onClick={() => onLeaveGame(booking.id)}
                  className="shrink-0 rounded-full px-2.5 py-2 text-[11px] font-semibold text-zinc-500 transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 sm:px-3"
                >
                  Leave
                </button>
              ) : null}
            </div>
          );
        })}
        {team.length === 0 ? (
          <div className="flex min-h-16 items-center justify-center rounded-2xl border border-dashed border-white/[0.08] px-4 text-xs font-medium text-zinc-600">
            Awaiting players
          </div>
        ) : null}
      </div>
    </section>
  );

  if (bookings.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 md:gap-4">
      {renderTeam(teamA, "Team A", "A")}
      {renderTeam(teamB, "Team B", "B")}
    </div>
  );
}
