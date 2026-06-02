"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Modal from "@/components/shared/ui/Modal";
import TeamList from "./TeamList";
import { getFormatFromMaxPlayers } from "@/lib/gameUtils";

interface GameDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  game: {
    id: number;
    title: string;
    location: string;
    time?: string;
    price?: number;
    format?: string;
    max_players?: number;
    [key: string]: any;
  };
  bookings: Array<{
    id: number;
    game_id: number;
    player_name: string;
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
  openAuthModal?: boolean;
  onOpenAuthModalHandled?: () => void;
}

export default function GameDetails({
  isOpen,
  onClose,
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
  openAuthModal,
  onOpenAuthModalHandled,
}: GameDetailsProps) {
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("Apple Pay");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signin");
  const [authLoading, setAuthLoading] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showStatusBadge, setShowStatusBadge] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [authOpenedFromNavbar, setAuthOpenedFromNavbar] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "creating" | "pending" | "paid" | "failed" | "expired">("idle");
  const [paymentCheckoutId, setPaymentCheckoutId] = useState<string | null>(null);
  const [paymentCheckoutReference, setPaymentCheckoutReference] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (statusMessage) {
      setShowStatusBadge(true);
      t = setTimeout(() => setShowStatusBadge(false), 2500);
    }
    return () => { if (t) clearTimeout(t); };
  }, [statusMessage]);
  const [signupMethod, setSignupMethod] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [favouritePosition, setFavouritePosition] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isAuthenticated = Boolean(user);
  const gameBookings = bookings.filter((b) => b.game_id === game.id);
  
  const maxPlayers = game.max_players || 12;
  const gameFormat = getFormatFromMaxPlayers(maxPlayers);
  const spotsLeft = maxPlayers - gameBookings.length;

  useEffect(() => {
    if (profile) {
      setUsername(profile.username || "");
      setAge(profile.age ?? "");
      setGender(profile.gender || "");
      setFavouritePosition(profile.favourite_position || "");
      setEmail(profile.email || "");
    }
  }, [profile]);

  const googleName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.display_name ||
    "";
  const emailName = (profile?.email || user?.email || email || "").split("@")[0].trim();
  const profileName =
    profile?.username?.trim() ||
    username.trim() ||
    googleName.trim() ||
    emailName ||
    "Player";
  const hasPlayerIdentity = Boolean(
    profile?.username?.trim() || username.trim() || googleName.trim() || emailName
  );
  const normalizedProfileName = profileName.trim().toLowerCase();
  const isGameFull = spotsLeft <= 0;
  const alreadyJoined =
    hasPlayerIdentity &&
    gameBookings.some(
      (booking) => booking.player_name.trim().toLowerCase() === normalizedProfileName
    );
  const canBookGame = !isGameFull && !alreadyJoined;

  const clearAuthState = () => {
    setAuthError(null);
    setStatusMessage(null);
  };

  const openPaymentModal = (checkoutId?: string | null, checkoutReference?: string | null) => {
    if (!canBookGame) {
      return;
    }
    setShowProfileModal(false);
    setPaymentCheckoutId(checkoutId ?? null);
    setPaymentCheckoutReference(checkoutReference ?? null);
    setPaymentStatus(checkoutId || checkoutReference ? "pending" : "idle");
    setPaymentMessage(
      checkoutId || checkoutReference
        ? "Checking your payment..."
        : null
    );
    setShowPaymentModal(true);
  };

  useEffect(() => {
    if (continueToPayment && isOpen && isAuthenticated) {
      if (canBookGame) {
        openPaymentModal(pendingCheckoutId, pendingCheckoutReference);
      }
      onContinueToPaymentHandled?.();
    }
  }, [continueToPayment, isOpen, isAuthenticated, canBookGame, pendingCheckoutId, pendingCheckoutReference, onContinueToPaymentHandled]);

  useEffect(() => {
    if (openAuthModal && isOpen) {
      setShowPaymentModal(false);
      setAuthMode("signin");
      setAuthOpenedFromNavbar(true);
      setShowProfileModal(true);
      onOpenAuthModalHandled?.();
    }
  }, [openAuthModal, isOpen, onOpenAuthModalHandled]);

  const openProfileModal = () => {
    if (!canBookGame) {
      return;
    }
    setShowPaymentModal(false);
    setAuthMode("signin");
    setAuthOpenedFromNavbar(false);
    setShowProfileModal(true);
  };

  const handleOpenPaymentLink = async () => {
    if (!canBookGame || bookingLoading) {
      return;
    }

    setBookingLoading(true);
    setPaymentStatus("creating");
    setPaymentMessage("Creating secure SumUp checkout...");

    try {
      const session = (await supabase.auth.getSession()).data.session;

      if (!session?.access_token) {
        throw new Error("Please sign in again before paying.");
      }

      const response = await fetch("/api/sumup/create-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameId: game.id,
          playerName: profileName,
        }),
      });

      const responseText = await response.text();
      let checkout: any = null;

      if (!responseText) {
        throw new Error("Empty response from checkout API");
      }

      try {
        checkout = JSON.parse(responseText);
      } catch {
        throw new Error("Checkout API returned a non-JSON response.");
      }

      if (!response.ok) {
        throw new Error(checkout?.error || checkout?.message || "Unable to create SumUp checkout.");
      }

      if (!checkout?.hosted_checkout_url || !checkout?.checkout_id) {
        throw new Error("Checkout API did not return a valid SumUp hosted checkout URL.");
      }

      localStorage.setItem("pendingSumUpGameId", String(game.id));
      localStorage.setItem("pendingSumUpCheckoutId", checkout.checkout_id);
      localStorage.setItem("pendingSumUpCheckoutReference", checkout.checkout_reference);
      setPaymentCheckoutId(checkout.checkout_id);
      setPaymentCheckoutReference(checkout.checkout_reference);
      setPaymentStatus("pending");
      setPaymentMessage("Payment is open in SumUp. Your booking will confirm automatically after payment succeeds.");
      window.open(checkout.hosted_checkout_url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      setPaymentStatus("failed");
      setPaymentMessage(error?.message || "Unable to start SumUp checkout.");
    } finally {
      setBookingLoading(false);
    }
  };

  useEffect(() => {
    if ((!paymentCheckoutId && !paymentCheckoutReference) || paymentStatus !== "pending") {
      return;
    }

    let isCancelled = false;

    const checkPaymentStatus = async () => {
      const session = (await supabase.auth.getSession()).data.session;

      if (!session?.access_token) {
        return;
      }

      const paymentQuery = paymentCheckoutId
        ? `checkout_id=${encodeURIComponent(paymentCheckoutId)}`
        : `checkout_reference=${encodeURIComponent(paymentCheckoutReference ?? "")}`;
      const response = await fetch(`/api/sumup/status?${paymentQuery}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok || isCancelled) {
        return;
      }

      const responseText = await response.text();
      let result: any = null;

      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          return;
        }
      }

      if (!result) {
        return;
      }

      if (result.checkoutId && !paymentCheckoutId) {
        setPaymentCheckoutId(result.checkoutId);
      }

      if (result.paymentStatus === "paid") {
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem("pendingSumUpCheckoutReference");
        localStorage.setItem("fairPlayBookingsUpdatedAt", String(Date.now()));
        setPaymentStatus("paid");
        setPaymentMessage("Payment confirmed. Your booking has been added.");
        await onPaymentComplete?.();
        return;
      }

      if (result.paymentStatus === "failed" || result.paymentStatus === "expired") {
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem("pendingSumUpCheckoutReference");
        setPaymentStatus(result.paymentStatus);
        setPaymentMessage(
          result.paymentStatus === "expired"
            ? "This SumUp checkout expired. Please start a new payment."
            : "SumUp could not complete the payment. Please try again."
        );
      }
    };

    checkPaymentStatus();
    const interval = window.setInterval(checkPaymentStatus, 2000);
    const timeout = window.setTimeout(() => {
      if (!isCancelled) {
        window.clearInterval(interval);
        setPaymentMessage("Payment is still processing. Please wait a moment and refresh if needed.");
      }
    }, 30000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [paymentCheckoutId, paymentCheckoutReference, paymentStatus, onPaymentComplete]);

  const handleSignUp = async () => {
    setAuthLoading(true);
    clearAuthState();

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      const currentUser = data.user ?? (await supabase.auth.getUser()).data.user;
      if (!currentUser) {
        const signInResult = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInResult.error) {
          throw signInResult.error;
        }
      }

      const sessionUser = (await supabase.auth.getUser()).data.user;
      if (sessionUser) {
        await supabase.from("profiles").upsert({
          id: sessionUser.id,
          email,
          username: username.trim(),
          age,
          gender,
          favourite_position: favouritePosition,
        });

        // Refresh profile data after successful signup
        if (onRefreshProfile) {
          await onRefreshProfile();
        }
      }

      setStatusMessage("Profile verified and saved. Continuing to payment...");
      setTimeout(() => {
        openPaymentModal();
      }, 900);
    } catch (error: any) {
      setAuthError(error?.message || "Unable to create account. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignIn = async () => {
    setAuthLoading(true);
    clearAuthState();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      const signedInUser = data.user ?? data.session?.user;

      if (!signedInUser) {
        throw new Error("Sign in succeeded, but the user session could not be loaded.");
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", signedInUser.id)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (profileData) {
        setUsername(profileData.username || "");
        setAge(profileData.age ?? "");
        setGender(profileData.gender || "");
        setFavouritePosition(profileData.favourite_position || "");
        setEmail(profileData.email || signedInUser.email || email);
      }

      if (onRefreshProfile) {
        await onRefreshProfile();
      }

      setStatusMessage("Profile verified. Continuing to payment...");
      setTimeout(() => {
        openPaymentModal();
      }, 900);
    } catch (error: any) {
      const message = error?.message || "Please verify your email and password.";
      setAuthError(`Sign in failed. ${message}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    clearAuthState();
    if (!authOpenedFromNavbar) {
      localStorage.setItem("pendingJoinGameId", String(game.id));
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      if (!authOpenedFromNavbar) {
        localStorage.removeItem("pendingJoinGameId");
      }
      setAuthLoading(false);
      setAuthError(`Google sign in failed. ${error.message}`);
    }
  };

  const handleAppleSignIn = () => {
    setStatusMessage("Apple sign in is coming soon.");
  };

  const handleSignOut = async () => {
    if (onSignOut) {
      await onSignOut();
    } else {
      await supabase.auth.signOut();
    }
    setShowPaymentModal(false);
    setShowProfileModal(false);
    setUsername("");
    setAge("");
    setGender("");
    setFavouritePosition("");
    setEmail("");
    setPassword("");
    clearAuthState();
  };

  return (
    <> 
      <Modal
        isOpen={isOpen && !showProfileModal && !showPaymentModal}
        onClose={onClose}
        title={game.title}
      >
        <div className="space-y-8">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.85fr]">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="bg-zinc-800 rounded-3xl p-5 border border-zinc-700">
                <p className="text-gray-400 text-sm mb-2 uppercase tracking-[0.3em]">
                  Location
                </p>
                <p className="text-white font-semibold text-lg">📍 {game.location}</p>
              </div>
              <div className="bg-zinc-800 rounded-3xl p-5 border border-zinc-700">
                <p className="text-gray-400 text-sm mb-2 uppercase tracking-[0.3em]">
                  Date & Time
                </p>
                <p className="text-white font-semibold text-lg">🕐 {game.time}</p>
              </div>
              <div className="bg-zinc-800 rounded-3xl p-5 border border-zinc-700">
                <p className="text-gray-400 text-sm mb-2 uppercase tracking-[0.3em]">
                  Price per Player
                </p>
                <p className="text-green-400 font-bold text-lg">£{game.price}</p>
              </div>
              <div className="bg-zinc-800 rounded-3xl p-5 border border-zinc-700">
                <p className="text-gray-400 text-sm mb-2 uppercase tracking-[0.3em]">
                  Availability
                </p>
                <p
                  className={`font-bold text-lg ${
                    spotsLeft > 3 ? "text-green-400" : spotsLeft > 0 ? "text-yellow-400" : "text-red-400"
                  }`}
                >
                  {spotsLeft > 0 ? `${spotsLeft} Spots Left` : "Full"}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-6">
  <h3 className="text-2xl font-bold text-white mb-4">{game.title}</h3>

  <p className="text-zinc-400 leading-relaxed">
    Friendly football games across North London.
    All levels welcome.
  </p>

  <div className="mt-6 flex flex-wrap gap-3">
    <span className="rounded-full bg-white/5 border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300">
      {gameFormat}
    </span>

    <span className="rounded-full bg-white/5 border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300">
      {game.location}
    </span>

    <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">
      {spotsLeft > 0 ? `${spotsLeft} open` : "Full"}
    </span>
  </div>
</div>
              </div>
            </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-white">Teams</h3>
            <span className="rounded-full bg-white/5 border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300">
              {gameBookings.length} players
            </span>
          </div>
          <TeamList
            bookings={gameBookings}
            onLeaveGame={onLeaveGame}
            currentPlayerName={profileName}
          />
          {gameBookings.length === 0 && (
            <p className="text-gray-400 text-center py-8">No confirmed players yet</p>
          )}
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <h3 className="text-lg font-bold text-white mb-4">Rules</h3>
          <ul className="space-y-3 text-gray-300 text-sm">
            <li className="flex gap-3">
              <span className="text-green-400">✓</span>
              <span>All players must arrive 15 minutes before kickoff</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400">✓</span>
              <span>Appropriate football boots or trainers required</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400">✓</span>
              <span>Fair play and respect for all players at all times</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400">✓</span>
              <span>No jewelry or watches during play</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400">✓</span>
              <span>Water bottles and snacks welcome</span>
            </li>
          </ul>
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-white">Payment Preview</h3>
            <p className="text-sm text-zinc-500">Future-ready UI only</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3 mt-4">
            <button className="flex items-center gap-3 rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-left transition hover:border-white/20">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"></span>
              <div>
                <p className="font-semibold text-white">Apple Pay</p>
                <p className="text-xs text-zinc-500">Fast checkout</p>
              </div>
            </button>
            <button className="flex items-center gap-3 rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-left transition hover:border-white/20">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">G</span>
              <div>
                <p className="font-semibold text-white">Google Pay</p>
                <p className="text-xs text-zinc-500">One-tap pay</p>
              </div>
            </button>
            <button className="flex items-center gap-3 rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-left transition hover:border-white/20">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">💳</span>
              <div>
                <p className="font-semibold text-white">Card</p>
                <p className="text-xs text-zinc-500">Visa, Mastercard</p>
              </div>
            </button>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">Book your spot</p>
                <h3 className="text-xl font-bold text-white">Proceed to checkout</h3>
              </div>
              {alreadyJoined ? (
                <span className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 px-6 py-3 font-bold text-emerald-300">
                  Already Joined
                </span>
              ) : (
                <button
                  onClick={() => {
                    if (isAuthenticated) {
                      openPaymentModal();
                      return;
                    }
                    openProfileModal();
                  }}
                  disabled={isGameFull}
                  className="rounded-3xl bg-emerald-500 px-6 py-3 font-bold text-black transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGameFull ? "Game Full" : "Join Game"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-6 bg-zinc-800 bg-opacity-50 rounded-lg p-4 border border-zinc-700">
          <h3 className="text-lg font-bold text-white mb-3">Cancellation Policy</h3>
          <div className="space-y-2 text-sm text-gray-300">
            <p>
              <span className="text-amber-400 font-semibold">Free Cancellation:</span> Until
              24 hours before the match
            </p>
            <p>
              <span className="text-orange-400 font-semibold">50% Refund:</span> 12-24 hours
              before the match
            </p>
            <p>
              <span className="text-red-400 font-semibold">No Refund:</span> Less than 12
              hours before the match
            </p>
            <p className="text-gray-400 pt-2 border-t border-zinc-600 mt-3">
              Contact us at support@fairplay.com for any questions
            </p>
          </div>
        </div>

        {successGameId === game.id && (
          <div className="rounded-3xl bg-emerald-500/10 px-5 py-3 text-center text-sm font-semibold text-emerald-200 border border-emerald-500/20">
            You're In. See You On The Pitch 👍
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-3 rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>

      <Modal
        isOpen={showProfileModal}
        onClose={() => {
          setShowPaymentModal(false);
          setShowProfileModal(false);
        }}
        title="Sign in to continue"
      >
        <div className="space-y-6">
          <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                  {isAuthenticated
                    ? "Signed in"
                    : authMode === "signup"
                    ? "Create profile"
                    : "Sign in"}
                </p>
                <p className="mt-2 text-zinc-400 max-w-2xl leading-relaxed text-sm">
                  {isAuthenticated
                    ? "Proceed to checkout"
                    : "Sign in or create account."
                  }
                </p>
              </div>
              {!isAuthenticated ? (
                <button
                  onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}
                  className="rounded-3xl bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white transition hover:border-white/20"
                >
                  {authMode === "signup" ? "Sign in" : "Create profile"}
                </button>
              ) : null}
            </div>

            {statusMessage ? (
              <div className={`mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 shadow-sm transition-opacity duration-300 ${showStatusBadge ? "opacity-100" : "opacity-0"}`}>
                <span className="text-emerald-200">✓</span>
                <span>{statusMessage.includes("Profile") ? statusMessage : "Profile verified"}</span>
              </div>
            ) : null}
          </div>

          {!isAuthenticated && authError ? (
            <div className="rounded-3xl border border-rose-500/70 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {authError}
            </div>
          ) : null}

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4 rounded-3xl border border-zinc-700 bg-zinc-900 p-5">
              {isAuthenticated ? (
                <div className="space-y-4">
                  <div className="rounded-3xl bg-zinc-950 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Signed in as</p>
                        <p className="mt-2 text-lg font-semibold text-white">{user?.email}</p>
                      </div>
                      <button
                        onClick={handleSignOut}
                        className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-white transition hover:border-white/20"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-3xl bg-zinc-950 p-4">
                      <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Username</p>
                      <p className="mt-2 text-lg font-semibold text-white">{profile?.username || username || "—"}</p>
                    </div>
                    <div className="rounded-3xl bg-zinc-950 p-4">
                      <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Position</p>
                      <p className="mt-2 text-lg font-semibold text-white">{profile?.favourite_position || "Midfielder"}</p>
                    </div>
                    <div className="rounded-3xl bg-zinc-950 p-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Age</p>
                          <p className="mt-2 text-lg font-semibold text-white">{profile?.age || age || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Gender</p>
                          <p className="mt-2 text-lg font-semibold text-white">{profile?.gender || gender || "—"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : authMode === "signup" ? (
                <>
                  <div>
                    <label className="text-sm uppercase tracking-[0.3em] text-zinc-500">Username</label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                      placeholder="Your username"
                    />
                  </div>
                  <div>
                    <label className="text-sm uppercase tracking-[0.3em] text-zinc-500">Age</label>
                    <input
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                      placeholder="Your age"
                    />
                  </div>
                  <div>
                    <label className="text-sm uppercase tracking-[0.3em] text-zinc-500">Gender</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                    >
                      <option value="" disabled>
                        Select gender
                      </option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm uppercase tracking-[0.3em] text-zinc-500">Favourite position</label>
                    <input
                      value={favouritePosition}
                      onChange={(e) => setFavouritePosition(e.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                      placeholder="Your favourite position"
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border border-zinc-700 bg-zinc-950 p-4 text-zinc-400 text-sm">
                  Enter your account credentials to continue.
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-3xl border border-zinc-700 bg-zinc-900 p-5">
              {(!isAuthenticated && authMode === "signup") || !isAuthenticated ? (
                <>
                  <div>
                    <label className="text-sm uppercase tracking-[0.3em] text-zinc-500">Email</label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div>
                    <label className="text-sm uppercase tracking-[0.3em] text-zinc-500">Password</label>
                    <div className="relative mt-2">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 pr-20 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                        placeholder="Create password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-white"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                </>
              ) : null}

              {!isAuthenticated ? (
                <div className="rounded-3xl border border-zinc-700 bg-zinc-800 p-5">
                  <p className="text-sm uppercase tracking-[0.3em] text-zinc-500 mb-4">Continue with</p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={authLoading}
                      className="rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left text-white transition-colors duration-150 ease-out hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {authLoading ? "Connecting..." : "Continue with Google"}
                    </button>
                    <button
                      onClick={handleAppleSignIn}
                      disabled
                      className="rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left text-zinc-500 transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Apple coming soon
                    </button>
                    <button
                      onClick={handleSignIn}
                      className="rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left text-white transition-colors duration-150 ease-out hover:border-white/20"
                    >
                      Sign in
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-700 bg-zinc-950/80 p-5">
            <p className="text-sm uppercase tracking-[0.3em] text-zinc-500 mb-3">Preview</p>
            <div className="grid gap-3">
              {[
                { label: "Username", value: profile?.username || username || "—" },
                { label: "Age", value: profile?.age || age || "—" },
                { label: "Gender", value: profile?.gender || gender || "—" },
                { label: "Favourite position", value: profile?.favourite_position || favouritePosition || "—" },
                { label: "Email", value: profile?.email || email || "—" },
              ].map((field) => (
                <div key={field.label} className="rounded-2xl bg-zinc-900 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">{field.label}</p>
                  <p className="mt-1 text-sm text-white">{field.value}</p>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={
              isAuthenticated
                ? () => openPaymentModal()
                : authMode === "signup"
                ? handleSignUp
                : handleSignIn
            }
            disabled={authLoading}
            className="w-full rounded-3xl bg-emerald-500 px-5 py-4 text-black font-bold transition-colors duration-150 ease-out hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAuthenticated ? "Proceed to checkout" : authMode === "signup" ? "Create profile" : "Sign in"}
          </button>

          <div className="flex justify-between gap-3 flex-wrap">
            <button
              onClick={() => {
                setShowPaymentModal(false);
                setShowProfileModal(false);
              }}
              className="rounded-3xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-white transition hover:border-white/20"
            >
              Back to match
            </button>
            {isAuthenticated ? (
              <button
                onClick={onRefreshProfile}
                className="rounded-3xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-white transition hover:border-white/20"
              >
                Refresh profile
              </button>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showPaymentModal && !showProfileModal}
        onClose={() => {
          setShowProfileModal(false);
          setShowPaymentModal(false);
        }}
        title="Secure checkout"
      >
        <div className="space-y-6">
          <div className="rounded-[2rem] border border-zinc-700 bg-zinc-950/95 p-6 shadow-[0_20px_70px_rgba(15,23,42,0.55)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Booking summary</p>
                <p className="mt-2 text-xl font-bold text-white">{game.title}</p>
                <p className="text-zinc-400 text-sm">{game.location} • {game.time}</p>
              </div>
              <div className="rounded-3xl bg-zinc-900 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Total</p>
                <p className="text-3xl font-bold text-emerald-400">£{game.price}</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">Select payment method</p>
                <p className="text-zinc-400 text-sm">Choose how you'd like to pay</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950/90 px-3 py-1 text-xs uppercase tracking-[0.3em] text-zinc-400">
                🔒 Secure
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { name: "Apple Pay", label: "Apple Pay", icon: "" },
                { name: "Google Pay", label: "Google Pay", icon: "G" },
                { name: "Card", label: "Card", icon: "💳" },
              ].map((option) => {
                const active = selectedPaymentMethod === option.name;
                return (
                  <button
                    key={option.name}
                    type="button"
                    onClick={() => setSelectedPaymentMethod(option.name)}
                    className={`rounded-3xl border px-4 py-4 text-left transition duration-150 ease-out ${
                      active
                        ? "border-emerald-400 bg-emerald-500/10 text-white shadow-[0_10px_30px_rgba(16,185,129,0.12)]"
                        : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/5 text-xl text-white">
                        {option.icon}
                      </span>
                      <div>
                        <p className="font-semibold">{option.label}</p>
                        <p className="text-xs text-zinc-500">{option.name === "Card" ? "Visa, Mastercard" : "Fast checkout"}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-700 bg-zinc-950/80 p-5">
            <p className="text-sm uppercase tracking-[0.3em] text-zinc-500 mb-4">Order details</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Username", value: profileName },
                { label: "Position", value: favouritePosition || "Midfielder" },
                { label: "Email", value: profile?.email || user?.email || email || "you@example.com" },
                { label: "Payment", value: selectedPaymentMethod },
              ].map((field) => (
                <div key={field.label} className="rounded-3xl bg-zinc-900 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">{field.label}</p>
                  <p className="mt-2 text-sm text-white">{field.value}</p>
                </div>
              ))}
            </div>
          </div>

          {paymentMessage ? (
            <div
              className={`rounded-3xl border px-5 py-4 text-sm font-semibold ${
                paymentStatus === "paid"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  : paymentStatus === "failed" || paymentStatus === "expired"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-100"
              }`}
            >
              {paymentMessage}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[1.25fr_0.75fr]">
            <button
              onClick={handleOpenPaymentLink}
              disabled={!canBookGame || bookingLoading || paymentStatus === "pending" || paymentStatus === "paid"}
              className="rounded-3xl bg-emerald-500 px-6 py-4 text-black font-bold transition duration-150 ease-out enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGameFull ? "Game Full" : alreadyJoined ? "Already Joined" : `Pay £${game.price} with SumUp`}
            </button>
            <button
              onClick={() => {
                setShowPaymentModal(false);
                setShowProfileModal(true);
              }}
              className="rounded-3xl border border-zinc-700 bg-zinc-900 px-6 py-4 text-white transition duration-150 ease-out hover:border-white/20"
            >
              Back to profile
            </button>
          </div>

        </div>
      </Modal>
    </>
  );
}

