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
  openAuthModal?: boolean;
  onOpenAuthModalHandled?: () => void;
}

type WaitingListEntry = {
  id: number;
  game_id?: number;
  user_id?: string;
  player_name?: string | null;
  status?: string | null;
};

const PENDING_SIGNUP_PROFILE_KEY = "fairPlayPendingSignupProfile";

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
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signin");
  const [authLoading, setAuthLoading] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showStatusBadge, setShowStatusBadge] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [authOpenedFromNavbar, setAuthOpenedFromNavbar] = useState(false);
  const [isClosingAfterSignIn, setIsClosingAfterSignIn] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "creating" | "pending" | "paid" | "paid_no_space" | "failed" | "expired">("idle");
  const [paymentCheckoutId, setPaymentCheckoutId] = useState<string | null>(null);
  const [paymentCheckoutReference, setPaymentCheckoutReference] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [waitingListLoading, setWaitingListLoading] = useState(false);
  const [waitingListMessage, setWaitingListMessage] = useState<string | null>(null);
  const [waitingListError, setWaitingListError] = useState<string | null>(null);
  const [waitingListEntry, setWaitingListEntry] = useState<WaitingListEntry | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (statusMessage) {
      setShowStatusBadge(true);
      t = setTimeout(() => setShowStatusBadge(false), 2500);
    }
    return () => { if (t) clearTimeout(t); };
  }, [statusMessage]);
  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [favouritePosition, setFavouritePosition] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const ageOptions = Array.from({ length: 45 }, (_, index) => String(index + 16));
  const positionOptions = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible"];

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
  const alreadyJoined = user?.id
    ? gameBookings.some((booking) => booking.user_id === user.id)
    : hasPlayerIdentity &&
      gameBookings.some(
        (booking) => booking.player_name.trim().toLowerCase() === normalizedProfileName
      );
  const canBookGame = !isGameFull && !alreadyJoined;

  useEffect(() => {
    let isCancelled = false;

    const loadWaitingListEntry = async () => {
      setWaitingListEntry(null);

      if (!isOpen || !isAuthenticated || !user?.id) {
        return;
      }

      const { data, error } = await supabase
        .from("waiting_list")
        .select("id,game_id,user_id,player_name,status")
        .eq("game_id", game.id)
        .eq("user_id", user.id)
        .eq("status", "waiting")
        .maybeSingle();

      if (isCancelled) {
        return;
      }

      if (error) {
        setWaitingListError(error.message);
        return;
      }

      setWaitingListEntry((data as WaitingListEntry | null) ?? null);
    };

    void loadWaitingListEntry();

    return () => {
      isCancelled = true;
    };
  }, [game.id, isAuthenticated, isOpen, user?.id]);

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
    if (continueToPayment) {
      onContinueToPaymentHandled?.();
    }
  }, [continueToPayment, onContinueToPaymentHandled]);

  useEffect(() => {
    if (openAuthModal && isOpen) {
      setAuthLoading(false);
      clearAuthState();
      setShowPaymentModal(false);
      setAuthMode("signin");
      setAuthOpenedFromNavbar(true);
      setShowProfileModal(true);
      onOpenAuthModalHandled?.();
    }
  }, [openAuthModal, isOpen, onOpenAuthModalHandled]);

  useEffect(() => {
    if (showProfileModal) {
      setAuthLoading(false);
    }
  }, [showProfileModal]);

  const closeProfileModal = () => {
    setAuthLoading(false);
    setIsClosingAfterSignIn(false);
    setShowPaymentModal(false);
    setShowProfileModal(false);
    setConfirmPassword("");
    setIsEditingProfile(false);
    if (authOpenedFromNavbar) {
      setAuthOpenedFromNavbar(false);
      onClose();
    }
  };

  const openProfileModal = () => {
    if (!canBookGame) {
      return;
    }
    setAuthLoading(false);
    clearAuthState();
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

  const joinWaitingList = async () => {
    if (waitingListLoading) {
      return;
    }

    setWaitingListMessage(null);
    setWaitingListError(null);

    if (!isAuthenticated) {
      localStorage.removeItem("pendingJoinGameId");
      localStorage.removeItem("pendingSumUpGameId");
      localStorage.removeItem("pendingSumUpCheckoutId");
      localStorage.removeItem("pendingSumUpCheckoutReference");
      setAuthLoading(false);
      clearAuthState();
      setWaitingListError("Please sign in before joining the waiting list.");
      setShowPaymentModal(false);
      setAuthMode("signin");
      setAuthOpenedFromNavbar(false);
      setShowProfileModal(true);
      return;
    }

    setWaitingListLoading(true);

    try {
      const session = (await supabase.auth.getSession()).data.session;

      if (!session?.access_token) {
        throw new Error("Please sign in again before joining the waiting list.");
      }

      const response = await fetch("/api/waiting-list", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          game_id: game.id,
          player_name: profileName,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error || "Unable to join waiting list.");
      }

      setWaitingListMessage(
        result?.message ||
          "You've been added to the waiting list.\n\nIf a space becomes available, we'll notify you. Spots are first paid, first served."
      );
      setWaitingListEntry((result?.waiting_list_entry as WaitingListEntry | undefined) ?? null);
    } catch (error) {
      setWaitingListError(error instanceof Error ? error.message : "Unable to join waiting list.");
    } finally {
      setWaitingListLoading(false);
    }
  };

  const leaveWaitingList = async () => {
    if (!waitingListEntry || waitingListLoading || !user?.id) {
      return;
    }

    setWaitingListMessage(null);
    setWaitingListError(null);
    setWaitingListLoading(true);

    try {
      const { error } = await supabase
        .from("waiting_list")
        .delete()
        .eq("id", waitingListEntry.id)
        .eq("user_id", user.id);

      if (error) {
        throw error;
      }

      setWaitingListEntry(null);
      setWaitingListMessage("You've left the waiting list for this game.");
    } catch (error) {
      setWaitingListError(error instanceof Error ? error.message : "Unable to leave waiting list.");
    } finally {
      setWaitingListLoading(false);
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

      if (result.paymentStatus === "paid_no_space") {
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem("pendingSumUpCheckoutReference");
        setPaymentStatus("paid_no_space");
        setPaymentMessage(result.message || "This spot has already been taken. You are still on the waiting list.");
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

    if (!age) {
      setAuthError("Please select your age.");
      setAuthLoading(false);
      return;
    }

    if (!favouritePosition) {
      setAuthError("Please select your favourite position.");
      setAuthLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setAuthError("Passwords do not match.");
      setAuthLoading(false);
      return;
    }

    try {
      const pendingSignupProfile = {
        username: username.trim(),
        age,
        gender,
        favouritePosition,
        favourite_position: favouritePosition,
        email,
      };

      localStorage.setItem(
        PENDING_SIGNUP_PROFILE_KEY,
        JSON.stringify(pendingSignupProfile)
      );

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/profile?complete_profile=1`,
          data: pendingSignupProfile,
        },
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
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);

        // Refresh profile data after successful signup
        if (onRefreshProfile) {
          await onRefreshProfile();
        }

        window.location.href = "/profile";
        return;
      }

      setStatusMessage(
        sessionUser
          ? "Profile verified and saved."
          : "Check your email to verify your account. Your profile will be completed after verification."
      );
      setTimeout(() => {
        setShowPaymentModal(false);
        setShowProfileModal(false);
        if (authOpenedFromNavbar || !isGameFull) {
          onClose();
        }
      }, 900);
    } catch (error: any) {
      localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
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

      setIsClosingAfterSignIn(true);
      const shouldCloseParent = authOpenedFromNavbar || !isGameFull;
      setShowPaymentModal(false);
      setShowProfileModal(false);
      if (authOpenedFromNavbar) {
        setAuthOpenedFromNavbar(false);
      }
      if (shouldCloseParent) {
        onClose();
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

      setIsClosingAfterSignIn(false);
    } catch (error: any) {
      setIsClosingAfterSignIn(false);
      const message = error?.message || "Please verify your email and password.";
      setAuthError(`Sign in failed. ${message}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    clearAuthState();
    if (!authOpenedFromNavbar && isGameFull && !alreadyJoined) {
      localStorage.setItem("pendingJoinGameId", String(game.id));
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (error) {
      if (!authOpenedFromNavbar && isGameFull && !alreadyJoined) {
        localStorage.removeItem("pendingJoinGameId");
      }
      setAuthLoading(false);
      setAuthError(`Google sign in failed. ${error.message}`);
      return;
    }

    window.setTimeout(() => setAuthLoading(false), 2500);
  };

  const handleSaveProfile = async () => {
    clearAuthState();

    if (!username.trim()) {
      setAuthError("Please enter your username.");
      return;
    }

    if (!age) {
      setAuthError("Please select your age.");
      return;
    }

    if (!favouritePosition) {
      setAuthError("Please select your favourite position.");
      return;
    }

    if (!user?.id) {
      setAuthError("Please sign in again before saving your profile.");
      return;
    }

    setAuthLoading(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: username.trim(),
          age,
          gender,
          favourite_position: favouritePosition,
        })
        .eq("id", user.id);

      if (error) {
        throw error;
      }

      await onRefreshProfile?.();
      setIsEditingProfile(false);
      setStatusMessage("Profile saved.");
    } catch (error: any) {
      setAuthError(error?.message || "Unable to save profile. Please try again.");
    } finally {
      setAuthLoading(false);
    }
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
    setConfirmPassword("");
    setIsEditingProfile(false);
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
                  Venue
                </p>
                <p className="text-white font-semibold text-lg">{game.location}</p>
              </div>
              <div className="bg-zinc-800 rounded-3xl p-5 border border-zinc-700">
                <p className="text-gray-400 text-sm mb-2 uppercase tracking-[0.3em]">
                  KICKOFF
                </p>
                <p className="text-white font-semibold text-lg">{game.time}</p>
              </div>
              <div className="bg-zinc-800 rounded-3xl p-5 border border-zinc-700">
                <p className="text-gray-400 text-sm mb-2 uppercase tracking-[0.3em]">
                  Match Fee
                </p>
                <p className="text-stone-200 font-bold text-lg">£{game.price}</p>
              </div>
              <div className="bg-zinc-800 rounded-3xl p-5 border border-zinc-700">
                <p className="text-gray-400 text-sm mb-2 uppercase tracking-[0.3em]">
                  Availability
                </p>
                <p className="font-bold text-lg text-stone-200">
                  {spotsLeft > 0 ? `${spotsLeft} Spaces Left` : "Full"}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-6">
  <h3 className="text-2xl font-bold text-white mb-4">{game.title}</h3>

  <p className="text-zinc-400 leading-relaxed">
    Friendly casual football in North London.
    All levels welcome.
  </p>

  <div className="mt-6 flex flex-wrap gap-3">
    <span className="rounded-full bg-white/5 border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300">
      {gameFormat}
    </span>

    <span className="rounded-full bg-white/5 border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300">
      {game.location}
    </span>

    <span className="rounded-full bg-white/5 border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300">
      {spotsLeft > 0 ? `${spotsLeft} spaces` : "Full"}
    </span>
  </div>
</div>
              </div>
            </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-white">Teams</h3>
            <span className="rounded-full bg-white/5 border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-300">
              {gameBookings.length} Confirmed
            </span>
          </div>
          <TeamList
            bookings={gameBookings}
            onLeaveGame={onLeaveGame}
            currentUserId={user?.id ?? null}
            currentUserAvatarUrl={profile?.avatar_url ?? null}
          />
          {gameBookings.length === 0 && (
            <p className="text-gray-400 text-center py-8">No confirmed players yet</p>
          )}
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <h3 className="text-lg font-bold text-white mb-4">Rules</h3>
          <ul className="space-y-3 text-gray-300 text-sm">
            <li className="flex gap-3">
              <span className="text-stone-300">✓</span>
              <span>All players must arrive 15 minutes before kickoff</span>
            </li>
            <li className="flex gap-3">
              <span className="text-stone-300">✓</span>
              <span>Appropriate football boots or trainers required</span>
            </li>
            <li className="flex gap-3">
              <span className="text-stone-300">✓</span>
              <span>Fair play and respect for all players at all times</span>
            </li>
            <li className="flex gap-3">
              <span className="text-stone-300">✓</span>
              <span>No jewelry or watches during play</span>
            </li>
            <li className="flex gap-3">
              <span className="text-stone-300">✓</span>
              <span>Water bottles and snacks welcome</span>
            </li>
          </ul>
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-white">Available payment methods</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-3 mt-4">
            <div className="flex cursor-default items-center gap-3 rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-left">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"></span>
              <div>
                <p className="font-semibold text-white">Apple Pay</p>
                <p className="text-xs text-zinc-500">Fast checkout</p>
              </div>
            </div>
            <div className="flex cursor-default items-center gap-3 rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-left">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">G</span>
              <div>
                <p className="font-semibold text-white">Google Pay</p>
                <p className="text-xs text-zinc-500">One-tap pay</p>
              </div>
            </div>
            <div className="flex cursor-default items-center gap-3 rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-left">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">💳</span>
              <div>
                <p className="font-semibold text-white">Card</p>
                <p className="text-xs text-zinc-500">Visa, Mastercard</p>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                  {isGameFull ? "Match status" : "Book Your Spot"}
                </p>
                {isGameFull ? (
                  <h3 className="text-xl font-bold text-white">
                    This match is currently full
                  </h3>
                ) : null}
              </div>
              {alreadyJoined ? (
                <span className="rounded-full border border-stone-300/20 bg-zinc-900 px-4 py-2 text-sm font-bold text-stone-200">
                  Already Joined
                </span>
              ) : isGameFull ? (
                <span className="inline-flex w-fit items-center rounded-full border border-stone-300/20 bg-zinc-950/90 px-4 py-2 text-sm font-bold text-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  Game Full
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
                  className="rounded-3xl bg-stone-200 px-6 py-3 font-bold text-zinc-950 transition hover:bg-stone-100"
                >
                  Join Game
                </button>
              )}
            </div>

            {isGameFull && !alreadyJoined ? (
              <div className="mt-5 border-t border-zinc-800 pt-5">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Waiting list</p>
                      <p className="mt-1 text-sm leading-6 text-zinc-400">
                        {waitingListEntry
                          ? "You're on the waiting list for this game."
                          : "Join the list for this game. This does not create a booking or take payment."}
                      </p>
                    </div>
                    {waitingListEntry ? (
                      <button
                        type="button"
                        onClick={leaveWaitingList}
                        disabled={waitingListLoading}
                        className="rounded-full border border-stone-300/20 bg-zinc-900 px-4 py-2 text-sm font-bold text-stone-200 transition hover:border-stone-200/35 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {waitingListLoading ? "Leaving..." : "Leave Waiting List"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={joinWaitingList}
                        disabled={waitingListLoading}
                        className="rounded-full border border-stone-300/20 bg-zinc-900 px-4 py-2 text-sm font-bold text-stone-200 transition hover:border-stone-200/35 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {waitingListLoading ? "Joining..." : "Join waiting list"}
                      </button>
                    )}
                  </div>

                  {waitingListMessage ? (
                    <div className="mt-4 rounded-2xl border border-stone-300/15 bg-zinc-900 px-4 py-3 text-sm font-semibold text-stone-200">
                      {waitingListMessage}
                    </div>
                  ) : null}

                  {waitingListError ? (
                    <div className="mt-4 rounded-2xl border border-stone-300/15 bg-zinc-900 px-4 py-3 text-sm font-semibold text-stone-200">
                      {waitingListError}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-6 bg-zinc-800 bg-opacity-50 rounded-lg p-4 border border-zinc-700">
          <h3 className="text-lg font-bold text-white mb-3">Refund Policy</h3>
          <div className="space-y-3 text-sm text-gray-300">
            <p>
              If fewer than 12 players are confirmed, the game will be cancelled and all players will receive a full refund. Please allow 2-5 working days for refunds to appear.
            </p>
            <p>
              You are eligible for a full refund if you cancel your booking at least 24 hours before kick-off.
            </p>
            <p>
              If a game is cancelled by the organiser, all players will receive a full refund.
            </p>
          </div>
        </div>

        {successGameId === game.id && (
          <div className="rounded-3xl border border-stone-300/15 bg-zinc-950 px-5 py-3 text-center text-sm font-semibold text-stone-200">
            Booking confirmed. See you on the pitch.
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
        isOpen={showProfileModal && !isClosingAfterSignIn}
        onClose={closeProfileModal}
        title={
          isAuthenticated
            ? "Your profile"
            : authMode === "signup"
            ? "Create your profile"
            : "Sign in to continue"
        }
      >
        <div className="space-y-6">
          <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                  {isAuthenticated
                    ? "Signed in"
                    : authMode === "signup"
                    ? "Create account"
                    : "Sign in"}
                </p>
                <p className="mt-2 text-zinc-400 max-w-2xl leading-relaxed text-sm">
                  {isAuthenticated
                    ? "You're signed in. Return to the match to choose your next step."
                    : authMode === "signup"
                    ? "Create your player profile to join games."
                    : "Enter your account credentials to continue."
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
              <div className={`mt-4 inline-flex items-center gap-2 rounded-full border border-stone-300/15 bg-zinc-950 px-4 py-2 text-sm text-stone-200 shadow-sm transition-opacity duration-300 ${showStatusBadge ? "opacity-100" : "opacity-0"}`}>
                <span className="text-stone-200">✓</span>
                <span>{statusMessage.includes("Profile") ? statusMessage : "Profile verified"}</span>
              </div>
            ) : null}
          </div>

          {authError ? (
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

                  {isEditingProfile ? (
                    <div className="grid gap-3">
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
                        <select
                          value={age}
                          onChange={(e) => setAge(e.target.value)}
                          className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                        >
                          <option value="" disabled>
                            Select age
                          </option>
                          {ageOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
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
                        <select
                          value={favouritePosition}
                          onChange={(e) => setFavouritePosition(e.target.value)}
                          className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                        >
                          <option value="" disabled>
                            Select position
                          </option>
                          {positionOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      <div className="rounded-3xl bg-zinc-950 p-4">
                        <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Username</p>
                        <p className="mt-2 text-lg font-semibold text-white">{profile?.username || username || "—"}</p>
                      </div>
                      <div className="rounded-3xl bg-zinc-950 p-4">
                        <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Position</p>
                        <p className="mt-2 text-lg font-semibold text-white">{profile?.favourite_position || favouritePosition || "—"}</p>
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
                  )}
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
                    <select
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                    >
                      <option value="" disabled>
                        Select age
                      </option>
                      {ageOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
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
                    <select
                      value={favouritePosition}
                      onChange={(e) => setFavouritePosition(e.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                    >
                      <option value="" disabled>
                        Select position
                      </option>
                      {positionOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
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
                        placeholder={authMode === "signup" ? "Create password" : "Enter your password"}
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
                  {authMode === "signup" ? (
                    <div>
                      <label className="text-sm uppercase tracking-[0.3em] text-zinc-500">Confirm password</label>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white/30 transition-colors duration-150 ease-out"
                        placeholder="Confirm password"
                      />
                    </div>
                  ) : null}
                </>
              ) : null}

              {!isAuthenticated ? (
                <div className="rounded-3xl border border-zinc-700 bg-zinc-800 p-5">
                  <p className="text-sm uppercase tracking-[0.3em] text-zinc-500 mb-4">
                    {authMode === "signup" ? "Create account" : "Sign in options"}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={authLoading}
                      className="rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left text-white transition-colors duration-150 ease-out hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {authLoading ? "Connecting..." : "Continue with Google"}
                    </button>
                    <button
                      onClick={authMode === "signup" ? handleSignUp : handleSignIn}
                      disabled={authLoading}
                      className="rounded-3xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left text-white transition-colors duration-150 ease-out hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {authMode === "signup" ? "Create account" : "Sign in"}
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

          <div className="flex justify-between gap-3 flex-wrap">
            <button
              onClick={closeProfileModal}
              className="rounded-3xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-white transition hover:border-white/20"
            >
              Back to match
            </button>
            {isAuthenticated ? (
              <button
                onClick={
                  isEditingProfile
                    ? handleSaveProfile
                    : () => {
                        clearAuthState();
                        setIsEditingProfile(true);
                      }
                }
                disabled={authLoading}
                className="rounded-3xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-white transition hover:border-white/20"
              >
                {isEditingProfile ? "Save profile" : "Edit profile"}
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
                <p className="text-3xl font-bold text-stone-100">£{game.price}</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-700 bg-zinc-900 p-5">
            <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">Secure payment</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              All payments are processed securely through SumUp. You’ll be able to choose your preferred payment method, including card, Apple Pay or Google Pay, during checkout.
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-700 bg-zinc-950/80 p-5">
            <p className="text-sm uppercase tracking-[0.3em] text-zinc-500 mb-4">Order details</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Username", value: profileName },
                { label: "Position", value: favouritePosition || "Midfielder" },
                { label: "Email", value: profile?.email || user?.email || email || "you@example.com" },
                { label: "Payment", value: "SumUp Secure Checkout" },
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
                  : paymentStatus === "failed" || paymentStatus === "expired" || paymentStatus === "paid_no_space"
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
              disabled={!canBookGame || bookingLoading || paymentStatus === "pending" || paymentStatus === "paid" || paymentStatus === "paid_no_space"}
              className="rounded-3xl bg-stone-200 px-6 py-4 text-zinc-950 font-bold transition duration-150 ease-out enabled:hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
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
