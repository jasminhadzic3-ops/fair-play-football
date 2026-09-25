"use client";

import { useEffect, useRef, useState } from "react";
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
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedBookingId(null);
      }
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (listRef.current && !listRef.current.contains(event.target as Node)) {
        setSelectedBookingId(null);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
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
      : null;
    const secondaryPosition = details.secondary_position && POSITION_SHORT_LABELS[details.secondary_position as PlayerPosition]
      ? POSITION_SHORT_LABELS[details.secondary_position as PlayerPosition]
      : null;
    const movementDescription = details.accelerate_type
      ? ACCELERATE_DESCRIPTIONS[details.accelerate_type as AccelerateType]
      : null;

    return (
      <div role="dialog" aria-label={`${displayName} player details`} className="mt-2 rounded-2xl border border-stone-200/15 bg-zinc-950/95 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.3)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-stone-200/20 bg-stone-200 text-sm font-black text-zinc-950">
              {details.avatar_url ? (
                <img src={details.avatar_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                getInitials(displayName)
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-white">{displayName}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {primaryPosition ? <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-300">{primaryPosition}</span> : null}
                {secondaryPosition ? <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{secondaryPosition}</span> : null}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => setSelectedBookingId(null)} className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-white/5 hover:text-white" aria-label="Close player details">
            Close
          </button>
        </div>
        {(details.age !== null && details.age !== undefined) || details.gender || details.preferred_foot ? (
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {details.age !== null && details.age !== undefined ? <div className="rounded-xl bg-white/[0.04] p-2.5"><p className="text-zinc-500">Age</p><p className="mt-1 font-semibold text-stone-200">{details.age}</p></div> : null}
            {details.gender ? <div className="rounded-xl bg-white/[0.04] p-2.5"><p className="text-zinc-500">Gender</p><p className="mt-1 font-semibold text-stone-200">{details.gender}</p></div> : null}
            {details.preferred_foot ? <div className="rounded-xl bg-white/[0.04] p-2.5"><p className="text-zinc-500">Preferred foot</p><p className="mt-1 font-semibold text-stone-200">{details.preferred_foot}</p></div> : null}
          </div>
        ) : null}
        {details.accelerate_type ? (
          <div className="mt-3 border-t border-white/[0.08] pt-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">Movement profile</p>
            <p className="mt-1 text-sm font-bold text-white">{details.accelerate_type}</p>
            {movementDescription ? <p className="mt-1 text-xs leading-5 text-zinc-500">{movementDescription}</p> : null}
          </div>
        ) : null}
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
              {selectedBookingId === booking.id ? renderPlayerDetails(booking) : null}
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
    <div ref={listRef} className="grid grid-cols-1 gap-3.5 md:grid-cols-2 md:gap-4">
      {renderTeam(teamA, "Team A", "A")}
      {renderTeam(teamB, "Team B", "B")}
    </div>
  );
}
