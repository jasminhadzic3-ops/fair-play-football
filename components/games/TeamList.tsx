"use client";

import { useEffect, useState } from "react";
import {
  ACCELERATE_DESCRIPTIONS,
  POSITION_SHORT_LABELS,
  getInitials,
  type AccelerateType,
  type PlayerPosition,
} from "@/lib/playerProfile";

interface Booking {
  id: number;
  game_id: number;
  player_name: string;
  is_current_user?: boolean | null;
  avatar_url?: string | null;
  favourite_position?: string | null;
  player_details?: {
    display_name: string;
    avatar_url: string | null;
    age?: number | null;
    gender?: string | null;
    primary_position: string | null;
    secondary_position: string | null;
    preferred_foot: string | null;
    accelerate_type: string | null;
  } | null;
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
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedBookingId(null);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const renderPlayerDetails = (booking: Booking) => {
    if (!booking.player_details) {
      return null;
    }

    const details = booking.player_details;
    const displayName = details.display_name || booking.player_name;
    const primaryPosition = details.primary_position && POSITION_SHORT_LABELS[details.primary_position as PlayerPosition]
      ? POSITION_SHORT_LABELS[details.primary_position as PlayerPosition]
      : details.primary_position || null;
    const secondaryPosition = details.secondary_position && POSITION_SHORT_LABELS[details.secondary_position as PlayerPosition]
      ? POSITION_SHORT_LABELS[details.secondary_position as PlayerPosition]
      : details.secondary_position || null;
    const movementDescription = details.accelerate_type
      ? ACCELERATE_DESCRIPTIONS[details.accelerate_type as AccelerateType]
      : null;

    const detailRows = [
      { label: "Age", value: details.age ?? "N/A" },
      { label: "Gender", value: details.gender || "N/A" },
      { label: "Primary position", value: primaryPosition || "N/A" },
      { label: "Secondary position", value: secondaryPosition || "N/A" },
      { label: "Preferred foot", value: details.preferred_foot || "N/A" },
      { label: "AcceleRATE Type", value: details.accelerate_type || "N/A" },
    ];

    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
        role="presentation"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedBookingId(null);
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${displayName} player details`}
          className="max-h-[min(680px,calc(100vh-2rem))] w-full max-w-md overflow-y-auto rounded-[2rem] border border-stone-200/20 bg-zinc-950 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.55)] sm:p-6"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-stone-400">Player details</p>
              <p className="mt-1 text-xs text-zinc-500">Fair Play match profile</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedBookingId(null)}
              className="flex size-9 items-center justify-center rounded-full border border-white/10 text-lg text-zinc-400 transition hover:border-white/25 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
              aria-label="Close player details"
            >
              ×
            </button>
          </div>

          <div className="mt-6 flex items-center gap-4 border-b border-white/[0.08] pb-5">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-stone-200/25 bg-stone-200 text-xl font-black text-zinc-950 shadow-[0_12px_35px_rgba(214,211,209,0.16)]">
              {details.avatar_url ? (
                <img src={details.avatar_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                getInitials(displayName)
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xl font-black tracking-tight text-white">{displayName}</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-stone-300">{primaryPosition || "Player"}</p>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-white/[0.08] rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4">
            {detailRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-3 text-sm">
                <dt className="text-zinc-500">{row.label}</dt>
                <dd className="text-right font-semibold text-stone-200">{row.value}</dd>
              </div>
            ))}
          </dl>

          {details.accelerate_type ? (
            <div className="mt-5 border-t border-white/[0.08] pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">Movement profile</p>
              <p className="mt-1 text-sm font-bold text-white">{details.accelerate_type}</p>
              {movementDescription ? <p className="mt-1 text-xs leading-5 text-zinc-500">{movementDescription}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

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
          const displayName = booking.player_details?.display_name || booking.player_name;
          const initials = getInitials(displayName);
          const position = booking.favourite_position
            ? POSITION_SHORT_LABELS[booking.favourite_position as PlayerPosition]
            : null;

          return (
            <div key={booking.id}>
              <div className="group flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-transparent bg-white/[0.035] px-3 py-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.055] sm:px-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-zinc-800 text-xs font-bold tracking-[0.06em] text-stone-100 shadow-[0_8px_24px_rgba(0,0,0,0.3)] sm:size-12">
                  {booking.avatar_url ? (
                    <img
                      src={booking.avatar_url}
                      alt={`${displayName} profile`}
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
                      {displayName}
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
              <div className="flex shrink-0 items-center gap-1">
                {booking.player_details ? (
                  <button
                    type="button"
                    onClick={() => setSelectedBookingId(selectedBookingId === booking.id ? null : booking.id)}
                    aria-expanded={selectedBookingId === booking.id}
                    className="rounded-full px-2.5 py-2 text-[11px] font-semibold text-stone-300 transition hover:bg-stone-200/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/30 sm:px-3"
                  >
                    Player details
                  </button>
                ) : null}
                {isCurrentUserBooking ? (
                  <button
                    type="button"
                    onClick={() => onLeaveGame(booking.id)}
                    className="rounded-full px-2.5 py-2 text-[11px] font-semibold text-zinc-500 transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 sm:px-3"
                  >
                    Leave
                  </button>
                ) : null}
              </div>
              </div>
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

  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId);

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 md:gap-4">
      {renderTeam(teamA, "Team A", "A")}
      {renderTeam(teamB, "Team B", "B")}
      {selectedBooking ? renderPlayerDetails(selectedBooking) : null}
    </div>
  );
}
