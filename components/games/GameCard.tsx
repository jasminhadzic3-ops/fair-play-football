"use client";

import { useEffect, useState } from "react";
import GameDetails from "./GameDetails";
import GameTagPills from "./GameTagPills";
import { getFormatFromMaxPlayers } from "@/lib/gameUtils";

interface GameCardProps {
  game: {
    id: number;
    title: string;
    location: string;
    time?: string;
    price?: number;
    pricing_mode?: "paid" | "free";
    format?: string;
    host?: string;
    playerName?: string;
    max_players?: number;
    tags?: string[] | null;
    [key: string]: any;
  };
  bookings: Array<{
    id: number;
    game_id: number;
    player_name: string;
    is_current_user?: boolean | null;
    avatar_url?: string | null;
  }>;
  successGameId: number | null;
  user: any | null;
  profile: any | null;
  onPlayerNameChange: (gameId: number, playerName: string) => void;
  onLeaveGame: (bookingId: number) => Promise<void> | void;
  onRefreshProfile?: () => Promise<void>;
  onPaymentComplete?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
  pendingCheckoutId?: string | null;
  pendingCheckoutReference?: string | null;
  continueToPayment?: boolean;
  onContinueToPaymentHandled?: () => void;
  paymentReturnStatus?: "checking" | "failed" | null;
  paymentReturnResolved?: boolean;
  openDetails?: boolean;
  onOpenDetailsHandled?: () => void;
  openAuthModal?: boolean;
  onOpenAuthModalHandled?: () => void;
}

const cardDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

const cardTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Europe/London",
});

function formatCardTime(date: Date) {
  return cardTimeFormatter.format(date).replace(/\s?(am|pm)$/i, (match) => match.trim().toLowerCase());
}

function getGameDurationMinutes(game: GameCardProps["game"]) {
  const rawDuration = game.duration_minutes ?? game.durationMinutes ?? game.duration;
  const duration = typeof rawDuration === "number" ? rawDuration : Number(rawDuration);

  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function formatGameDateTime(game: GameCardProps["game"]) {
  if (!game.starts_at) {
    return game.time || "Date and time to be confirmed";
  }

  const startsAt = new Date(game.starts_at);

  if (Number.isNaN(startsAt.getTime())) {
    return game.time || "Date and time to be confirmed";
  }

  const durationMinutes = getGameDurationMinutes(game);
  const dateLabel = cardDateFormatter.format(startsAt);
  const startTime = formatCardTime(startsAt);

  if (!durationMinutes) {
    return `${dateLabel} · ${startTime}`;
  }

  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
  return `${dateLabel} · ${startTime}–${formatCardTime(endsAt)}`;
}

function getPlayingStyleLabel(tags?: string[] | null) {
  return tags?.some((tag) => tag.toLowerCase().includes("competitive")) ? "Competitive" : "Casual";
}

function formatSideLabel(format: string) {
  const match = format.match(/^(\d+)v\d+$/i);
  return match ? `${match[1]}-a-side` : format;
}

function formatPrice(price?: number) {
  const numericPrice = Number(price ?? 0);
  const priceLabel = Number.isInteger(numericPrice) ? `£${numericPrice}` : `£${numericPrice.toFixed(2)}`;

  return `${priceLabel} per player`;
}

function formatAvailability(spotsLeft: number, confirmedPlayers: number) {
  if (spotsLeft <= 0) {
    return { text: "Game full", className: "border-zinc-700/70 bg-zinc-800/70 text-zinc-400" };
  }

  if (spotsLeft <= 2) {
    return {
      text: `Almost full · ${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} remaining`,
      className: "border-rose-200/20 bg-rose-300/10 text-rose-200",
    };
  }

  if (confirmedPlayers >= 6) {
    return {
      text: `Filling up fast · ${spotsLeft} spots remaining`,
      className: "border-amber-200/20 bg-amber-300/10 text-amber-200",
    };
  }

  return {
    text: `${spotsLeft} spots available`,
    className: "border-emerald-200/20 bg-emerald-300/10 text-emerald-200",
  };
}

export default function GameCard({
  game,
  bookings,
  successGameId,
  user,
  profile,
  onPlayerNameChange,
  onLeaveGame,
  onRefreshProfile,
  onPaymentComplete,
  onSignOut,
  pendingCheckoutId,
  pendingCheckoutReference,
  continueToPayment,
  onContinueToPaymentHandled,
  paymentReturnStatus,
  paymentReturnResolved,
  openDetails,
  onOpenDetailsHandled,
  openAuthModal,
  onOpenAuthModalHandled,
}: GameCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(Boolean(openAuthModal || openDetails));

  useEffect(() => {
    if (openAuthModal || openDetails) {
      setIsDetailsOpen(true);
      onOpenDetailsHandled?.();
    }
  }, [openAuthModal, openDetails, onOpenDetailsHandled]);

  const maxPlayers = game.max_players || 12;
  const confirmedPlayers = bookings.filter((booking) => booking.game_id === game.id).length;
  const spotsLeft = maxPlayers - confirmedPlayers;

  const formatBadge = getFormatFromMaxPlayers(maxPlayers);
  const availability = formatAvailability(spotsLeft, confirmedPlayers);
  const durationMinutes = getGameDurationMinutes(game);
  const playingStyleLabel = getPlayingStyleLabel(game.tags);
  const formatAndDuration = [
    formatSideLabel(formatBadge),
    playingStyleLabel,
    durationMinutes ? `${durationMinutes} minutes` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`View details for ${game.title}`}
        className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-[0_14px_44px_rgba(0,0,0,0.22)] transition cursor-pointer hover:border-stone-200/25 hover:shadow-[0_18px_54px_rgba(0,0,0,0.32)] hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-stone-200/40"
        onClick={() => setIsDetailsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsDetailsOpen(true);
          }
        }}
      >
        <div className="grid gap-6 p-5 md:p-8 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-w-0 space-y-3">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
              Kickoff
            </p>
            <p className="break-words text-xl font-bold text-white md:text-2xl">
              {formatGameDateTime(game)}
            </p>
            <h3 className="break-words text-lg font-bold text-white">{game.title}</h3>
            <p className="break-words text-sm text-zinc-300 md:text-base">{game.location}</p>
            <p className="text-sm font-semibold text-zinc-400">{formatAndDuration}</p>
            <GameTagPills tags={game.tags} />
            <p className="text-sm font-semibold text-stone-200">{game.pricing_mode === "free" ? "FREE" : formatPrice(game.price)}</p>
            <p className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tracking-[0.01em] ${availability.className}`}>
              {availability.text}
            </p>
          </div>

          <div className="md:text-right">
            <span className="inline-flex min-h-11 items-center justify-center rounded-full bg-stone-200 px-5 text-sm font-bold text-zinc-950 transition-colors">
              Join this game
            </span>
          </div>
        </div>
      </div>

      <GameDetails
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        game={game}
        bookings={bookings}
        successGameId={successGameId}
        user={user}
        profile={profile}
        onPlayerNameChange={onPlayerNameChange}
        onLeaveGame={onLeaveGame}
        onRefreshProfile={onRefreshProfile}
        onPaymentComplete={onPaymentComplete}
        onSignOut={onSignOut}
        pendingCheckoutId={pendingCheckoutId}
        pendingCheckoutReference={pendingCheckoutReference}
        continueToPayment={continueToPayment}
        onContinueToPaymentHandled={onContinueToPaymentHandled}
        paymentReturnStatus={paymentReturnStatus}
        paymentReturnResolved={paymentReturnResolved}
        openAuthModal={openAuthModal}
        onOpenAuthModalHandled={onOpenAuthModalHandled}
      />
    </>
  );
}
