"use client";

import { useEffect, useState } from "react";
import GameDetails from "./GameDetails";
import { getFormatFromMaxPlayers } from "@/lib/gameUtils";

interface GameCardProps {
  game: {
    id: number;
    title: string;
    location: string;
    time?: string;
    price?: number;
    format?: string;
    host?: string;
    playerName?: string;
    max_players?: number;
    [key: string]: any;
  };
  bookings: Array<{
    id: number;
    game_id: number;
    player_name: string;
    user_id?: string | null;
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
  openDetails?: boolean;
  onOpenDetailsHandled?: () => void;
  openAuthModal?: boolean;
  onOpenAuthModalHandled?: () => void;
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
  openDetails,
  onOpenDetailsHandled,
  openAuthModal,
  onOpenAuthModalHandled,
}: GameCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  useEffect(() => {
    if (openAuthModal || openDetails) {
      setIsDetailsOpen(true);
      onOpenDetailsHandled?.();
    }
  }, [openAuthModal, openDetails, onOpenDetailsHandled]);

  const maxPlayers = game.max_players || 12;
  const spotsLeft =
    maxPlayers -
    bookings.filter((booking) => booking.game_id === game.id).length;

  const formatBadge = getFormatFromMaxPlayers(maxPlayers);

  return (
    <>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-sm transition cursor-pointer hover:border-white/20 hover:shadow-lg hover:-translate-y-0.5"
        onClick={() => setIsDetailsOpen(true)}
      >
        <div className="grid gap-6 p-6 md:p-8 md:grid-cols-[auto_1fr_auto] items-center">
          {/* Time */}
          <div className="flex flex-col items-center justify-center text-center min-w-[8rem]">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
              Kickoff
            </p>
            <p className="mt-2 text-lg font-bold text-white">
              {game.time || "TBD"}
            </p>
          </div>

          {/* Title, Venue, Badges */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold text-white">{game.title}</h3>
              <span className="rounded-full border border-zinc-700 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.28em] text-zinc-300 font-semibold">
                {formatBadge}
              </span>
            </div>

            <p className="text-zinc-400">{game.location}</p>

            <div className="flex flex-wrap gap-2">
              {game.host && (
                <span className="rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1 text-xs text-zinc-300 font-medium">
                  Host: {game.host}
                </span>
              )}
              <span className="rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1 text-xs text-zinc-300 font-medium">
                {game.location}
              </span>
            </div>

            <div className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-300 border border-emerald-500/20">
              {spotsLeft > 0 ? `${spotsLeft} spots open` : "Full"}
            </div>
          </div>

          {/* Price */}
          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
              Price
            </p>
            <p className="mt-2 text-3xl font-bold text-white">
              £{game.price ?? "0"}
            </p>
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
        openAuthModal={openAuthModal}
        onOpenAuthModalHandled={onOpenAuthModalHandled}
      />
    </>
  );
}
