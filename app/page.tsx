"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { duplicatePaidPaymentMessage } from "@/lib/sumupPaymentMessages";
import GameCard from "@/components/games/GameCard";
import Navbar from "@/components/shared/layout/Navbar";
import Hero from "@/components/shared/layout/Hero";
import Modal from "@/components/shared/ui/Modal";
import { AGREEMENT_VERSION, SIGNUP_AGREEMENT_LABEL } from "@/lib/signupAgreement";
import {
  addDaysToDateKey,
  formatCalendarDateLabel,
  formatCalendarDayNumber,
  getDefaultSelectedDateKey,
  getGameLondonDateKey,
  getTodayLondonDateKey,
  getWeekDateKeys,
  sortGamesByStartsAt,
} from "@/lib/gameCalendar";

const PENDING_SIGNUP_PROFILE_KEY = "fairPlayPendingSignupProfile";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [games, setGames] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [successGameId, setSuccessGameId] = useState<number | null>(null);
  const [checkoutGameId, setCheckoutGameId] = useState<number | null>(null);
  const [pendingCheckoutId, setPendingCheckoutId] = useState<string | null>(null);
  const [pendingCheckoutReference, setPendingCheckoutReference] = useState<string | null>(null);
  const [returnPaymentMessage, setReturnPaymentMessage] = useState<string | null>(null);
  const [returnPaymentState, setReturnPaymentState] = useState<"checking" | "paid" | "paid_no_space" | "duplicate_paid" | "pending" | "failed" | null>(null);
  const [showNavbarAuthModal, setShowNavbarAuthModal] = useState(false);
  const [navbarAuthEmail, setNavbarAuthEmail] = useState("");
  const [navbarAuthPassword, setNavbarAuthPassword] = useState("");
  const [navbarAuthConfirmPassword, setNavbarAuthConfirmPassword] = useState("");
  const [navbarAuthUsername, setNavbarAuthUsername] = useState("");
  const [navbarAuthAge, setNavbarAuthAge] = useState("");
  const [navbarAuthGender, setNavbarAuthGender] = useState("");
  const [navbarAuthFavouritePosition, setNavbarAuthFavouritePosition] = useState("");
  const [navbarAgreementAccepted, setNavbarAgreementAccepted] = useState(false);
  const [navbarAuthMode, setNavbarAuthMode] = useState<"signin" | "signup">("signin");
  const [navbarAuthLoading, setNavbarAuthLoading] = useState(false);
  const [navbarAuthError, setNavbarAuthError] = useState<string | null>(null);
  const [navbarAuthStatus, setNavbarAuthStatus] = useState<string | null>(null);
  const [showNavbarAuthPassword, setShowNavbarAuthPassword] = useState(false);
  const [openDetailsGameId, setOpenDetailsGameId] = useState<number | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedGameDateKey, setSelectedGameDateKey] = useState<string | null>(null);
  const [visibleWeekStartKey, setVisibleWeekStartKey] = useState<string | null>(null);
  const returnPollingReference = useRef<string | null>(null);
  const ageOptions = Array.from({ length: 45 }, (_, index) => String(index + 16));
  const positionOptions = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible"];
  const todayDateKey = getTodayLondonDateKey();
  const fallbackSelectedDateKey = selectedGameDateKey ?? getDefaultSelectedDateKey(games);
  const fallbackWeekStartKey = visibleWeekStartKey ?? fallbackSelectedDateKey;
  const weekDateKeys = getWeekDateKeys(fallbackWeekStartKey);
  const calendarGames = games.filter((game) => getGameLondonDateKey(game));
  const legacyGames = games.filter((game) => !getGameLondonDateKey(game));
  const gamesByDateKey = calendarGames.reduce<Map<string, any[]>>((map, game) => {
    const dateKey = getGameLondonDateKey(game);

    if (!dateKey) {
      return map;
    }

    map.set(dateKey, [...(map.get(dateKey) ?? []), game]);
    return map;
  }, new Map<string, any[]>());
  const userBookedDateKeys = new Set(
    bookings
      .filter((booking) => user?.id && booking.user_id === user.id)
      .map((booking) => games.find((game) => game.id === booking.game_id))
      .map((game) => game ? getGameLondonDateKey(game) : null)
      .filter((dateKey): dateKey is string => Boolean(dateKey))
  );
  const selectedDatedGames = sortGamesByStartsAt(gamesByDateKey.get(fallbackSelectedDateKey) ?? []);
  const nextAvailableDateKey: string | null =
    Array.from(gamesByDateKey.keys()).sort().find((dateKey) => dateKey >= todayDateKey) ??
    Array.from(gamesByDateKey.keys()).sort()[0] ??
    null;

  useEffect(() => {
    if (games.length === 0 || selectedGameDateKey) {
      return;
    }

    const defaultDateKey = getDefaultSelectedDateKey(games);
    setSelectedGameDateKey(defaultDateKey);
    setVisibleWeekStartKey(defaultDateKey);
  }, [games, selectedGameDateKey]);

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Unable to load profile:", error.message);
    }

    setProfile(data ?? null);
    return data ?? null;
  }

  async function loadOrCreateProfile(authUser: User) {
    const existingProfile = await fetchProfile(authUser.id);
    const pendingSignupProfileText = localStorage.getItem(PENDING_SIGNUP_PROFILE_KEY);
    let pendingSignupProfile: {
      terms_accepted_at?: string;
      terms_version?: string;
    } | null = null;

    if (pendingSignupProfileText) {
      try {
        pendingSignupProfile = JSON.parse(pendingSignupProfileText);
      } catch {
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
      }
    }

    if (existingProfile) {
      if (pendingSignupProfileText) {
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
      }
      return existingProfile;
    }

    const fallbackName =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.user_metadata?.display_name ||
      authUser.email?.split("@")[0] ||
      "Player";

    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: authUser.id,
        email: authUser.email,
        username: fallbackName,
        ...(pendingSignupProfile?.terms_accepted_at
          ? {
              terms_accepted_at: pendingSignupProfile.terms_accepted_at,
              terms_version: pendingSignupProfile.terms_version ?? AGREEMENT_VERSION,
            }
          : {}),
      })
      .select("*")
      .single();

    if (error) {
      console.error("Unable to create profile:", error.message);
      return null;
    }

    setProfile(data);
    if (pendingSignupProfileText) {
      localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
    }
    return data;
  }

  async function fetchGames() {
    const { data: gamesData } = await supabase
      .from("games")
      .select("*")
      .eq("status", "active")
      .is("archived_at", null);
    const bookingsResponse = await fetch("/api/bookings");
    const bookingsResult = await bookingsResponse.json().catch(() => null);

    if (gamesData) {
      setGames(gamesData);
    }

    if (bookingsResponse.ok) {
      setBookings(bookingsResult?.bookings ?? []);
    } else {
      console.error("Unable to load bookings:", bookingsResult?.error || "Unknown error");
    }
  }

  async function fetchUnreadNotificationCount() {
    const { count, error } = await supabase
      .from("waiting_list_notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "unread");

    if (error) {
      console.error("Unable to load unread notifications:", error.message);
      setUnreadNotificationCount(0);
      return;
    }

    setUnreadNotificationCount(count ?? 0);
  }

  const renderGameCard = (game: any) => (
    <GameCard
      key={game.id}
      game={game}
      bookings={bookings}
      successGameId={successGameId}
      user={user}
      profile={profile}
      onPlayerNameChange={(gameId, playerName) => {
        setGames((prevGames) =>
          prevGames.map((g) =>
            g.id === gameId
              ? {
                  ...g,
                  playerName: playerName,
                }
              : g
          )
        );
      }}
      onLeaveGame={leaveGame}
      onRefreshProfile={async () => {
        const currentUser = user ?? (await supabase.auth.getUser()).data.user;
        if (currentUser) {
          await loadOrCreateProfile(currentUser);
        }
      }}
      onPaymentComplete={async () => {
        setSuccessGameId(game.id);
        await fetchGames();
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
        clearSumUpCheckoutReferenceFromUrl();
        localStorage.setItem("fairPlayBookingsUpdatedAt", String(Date.now()));
        scrollToGames();
        setTimeout(() => {
          setSuccessGameId(null);
        }, 5000);
      }}
      onSignOut={handleSignOut}
      pendingCheckoutId={checkoutGameId === game.id ? pendingCheckoutId : null}
      pendingCheckoutReference={checkoutGameId === game.id ? pendingCheckoutReference : null}
      onContinueToPaymentHandled={() => {
        setCheckoutGameId(null);
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
      }}
      openDetails={openDetailsGameId === game.id}
      onOpenDetailsHandled={() => setOpenDetailsGameId(null)}
    />
  );

  async function refreshAdminStatus(accessToken?: string | null) {
    if (!accessToken) {
      setIsAdmin(false);
      return;
    }

    try {
      const response = await fetch("/api/admin/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const result = await response.json().catch(() => null);

      setIsAdmin(response.ok && result?.isAdmin === true);
    } catch {
      setIsAdmin(false);
    }
  }

  function clearPendingCheckoutState() {
    localStorage.removeItem("pendingJoinGameId");
    localStorage.removeItem("pendingSumUpGameId");
    localStorage.removeItem("pendingSumUpCheckoutId");
    localStorage.removeItem("pendingSumUpCheckoutReference");
  }

  function openGameFromNotification() {
    const searchParams = new URLSearchParams(window.location.search);
    const gameId = searchParams.get("open_game_id") ?? searchParams.get("game");

    if (!gameId) {
      return;
    }

    const parsedGameId = Number(gameId);

    if (!Number.isInteger(parsedGameId) || parsedGameId <= 0) {
      return;
    }

    setOpenDetailsGameId(parsedGameId);
    window.setTimeout(scrollToGames, 0);
  }

  function continuePendingJoin() {
    const pendingJoinGameId = localStorage.getItem("pendingJoinGameId");

    if (!pendingJoinGameId) {
      return;
    }

    localStorage.removeItem("pendingJoinGameId");
    setOpenDetailsGameId(Number(pendingJoinGameId));
  }

  async function continuePendingPayment(authUserId: string) {
    const checkoutReferenceFromUrl = new URLSearchParams(window.location.search).get("sumup_checkout_reference");
    const pendingSumUpGameId = localStorage.getItem("pendingSumUpGameId");
    const pendingSumUpCheckoutId = localStorage.getItem("pendingSumUpCheckoutId");
    const pendingSumUpCheckoutReference = localStorage.getItem("pendingSumUpCheckoutReference");

    if (!checkoutReferenceFromUrl) {
      clearPendingCheckoutState();
      setPendingCheckoutId(null);
      setPendingCheckoutReference(null);
      setCheckoutGameId(null);
      return;
    }

    if (!pendingSumUpGameId || (!pendingSumUpCheckoutId && !pendingSumUpCheckoutReference)) {
      return;
    }

    let paymentQuery = supabase
      .from("booking_payments")
      .select("user_id,checkout_id,checkout_reference");

    paymentQuery = pendingSumUpCheckoutId
      ? paymentQuery.eq("checkout_id", pendingSumUpCheckoutId)
      : paymentQuery.eq("checkout_reference", pendingSumUpCheckoutReference);

    const { data: payment, error } = await paymentQuery.maybeSingle();

    if (error || !payment || payment.user_id !== authUserId) {
      clearPendingCheckoutState();
      setPendingCheckoutId(null);
      setPendingCheckoutReference(null);
      setCheckoutGameId(null);
      return;
    }
  }

  function clearSumUpCheckoutReferenceFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("sumup_checkout_reference");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function scrollToGames() {
    document.getElementById("games")?.scrollIntoView({ behavior: "smooth" });
  }

  async function checkReturnedPayment(accessToken: string) {
    const checkoutReference = new URLSearchParams(window.location.search).get("sumup_checkout_reference");

    if (!checkoutReference || returnPollingReference.current === checkoutReference) {
      return;
    }

    returnPollingReference.current = checkoutReference;
    setReturnPaymentState("checking");
    setReturnPaymentMessage("Checking your payment...");

    const deadline = Date.now() + 30000;

    while (Date.now() <= deadline) {
      const response = await fetch(
        `/api/sumup/status?checkout_reference=${encodeURIComponent(checkoutReference)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const responseText = await response.text();
      let result: any = null;

      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          setReturnPaymentState("failed");
          setReturnPaymentMessage("Unable to check payment status.");
          return;
        }
      }

      if (!response.ok) {
        setReturnPaymentState("failed");
        setReturnPaymentMessage(result?.error || "Unable to check payment status.");
        return;
      }

      const paymentStatus = String(result?.paymentStatus || result?.payment_status || result?.status || "").toLowerCase();

      if (paymentStatus === "paid" || paymentStatus === "successful") {
        const paidGameId = result?.gameId ?? (Number(localStorage.getItem("pendingSumUpGameId")) || null);
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem("pendingSumUpCheckoutReference");
        localStorage.setItem("fairPlayBookingsUpdatedAt", String(Date.now()));
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
        setCheckoutGameId(null);
        setSuccessGameId(paidGameId);
        await fetchGames();
        if (paidGameId) {
          setOpenDetailsGameId(paidGameId);
        }
        clearSumUpCheckoutReferenceFromUrl();
        setReturnPaymentState("paid");
        setReturnPaymentMessage("Payment confirmed. Your booking has been added.");
        scrollToGames();
        setTimeout(() => setSuccessGameId(null), 5000);
        return;
      }

      if (paymentStatus === "paid_no_space") {
        const paidNoSpaceGameId = result?.gameId ?? (Number(localStorage.getItem("pendingSumUpGameId")) || null);
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem("pendingSumUpCheckoutReference");
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
        setCheckoutGameId(null);
        await fetchGames();
        if (paidNoSpaceGameId) {
          setOpenDetailsGameId(paidNoSpaceGameId);
        }
        clearSumUpCheckoutReferenceFromUrl();
        setReturnPaymentState("paid_no_space");
        setReturnPaymentMessage("Payment received, but this game is now full. You are still on the waiting list and we’ll notify you if a spot opens.");
        scrollToGames();
        return;
      }

      if (paymentStatus === "duplicate_paid") {
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem("pendingSumUpCheckoutReference");
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
        setCheckoutGameId(null);
        clearSumUpCheckoutReferenceFromUrl();
        setReturnPaymentState("duplicate_paid");
        setReturnPaymentMessage(result?.message || duplicatePaidPaymentMessage);
        scrollToGames();
        return;
      }

      if (paymentStatus === "failed" || paymentStatus === "expired") {
        setReturnPaymentState("failed");
        setReturnPaymentMessage("SumUp could not complete the payment. Please try again.");
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    setReturnPaymentState("pending");
    setReturnPaymentMessage("Payment is still processing.");
  }

  async function runPostAuthWork(session: { user: User; access_token: string }) {
    try {
      await loadOrCreateProfile(session.user);
      await fetchUnreadNotificationCount();
      openGameFromNotification();
      continuePendingJoin();
      await continuePendingPayment(session.user.id);
      await checkReturnedPayment(session.access_token);
    } catch (error) {
      console.error("Unable to complete post-auth work:", error);
    }
  }

  useEffect(() => {
    fetchGames();
    openGameFromNotification();

    let listenerSubscription: { unsubscribe: () => void } | undefined;

    const initializeAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setUser(session?.user ?? null);
      if (session?.user) {
        void refreshAdminStatus(session.access_token);
        void runPostAuthWork(session);
      } else {
        setIsAdmin(false);
      }

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          void refreshAdminStatus(session.access_token);
          void runPostAuthWork(session);
        } else {
          setIsAdmin(false);
          setProfile(null);
          setUnreadNotificationCount(0);
          clearPendingCheckoutState();
          setPendingCheckoutId(null);
          setPendingCheckoutReference(null);
          setCheckoutGameId(null);
        }
      });

      listenerSubscription = listener.subscription;
    };

    initializeAuth();

    return () => {
      listenerSubscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    const refreshUnreadNotifications = () => {
      void fetchUnreadNotificationCount();
    };
    const refreshUnreadNotificationsWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshUnreadNotifications();
      }
    };

    window.addEventListener("focus", refreshUnreadNotifications);
    document.addEventListener("visibilitychange", refreshUnreadNotificationsWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshUnreadNotifications);
      document.removeEventListener("visibilitychange", refreshUnreadNotificationsWhenVisible);
    };
  }, [user]);

  const leaveGame = async (bookingId: number) => {
    const session = (await supabase.auth.getSession()).data.session;

    if (!session?.access_token) {
      console.error("Unable to leave game: missing session.");
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
      return;
    }

    await fetchGames();
  };

  const handleSignOut = async () => {
    clearPendingCheckoutState();
    setPendingCheckoutId(null);
    setPendingCheckoutReference(null);
    setCheckoutGameId(null);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setIsAdmin(false);
  };

  const handleNavbarSignIn = () => {
    clearPendingCheckoutState();
    setPendingCheckoutId(null);
    setPendingCheckoutReference(null);
    setCheckoutGameId(null);
    setOpenDetailsGameId(null);
    setNavbarAuthError(null);
    setNavbarAuthStatus(null);
    setNavbarAuthMode("signin");
    setShowNavbarAuthModal(true);
  };

  const closeNavbarAuthModal = () => {
    setShowNavbarAuthModal(false);
    setNavbarAuthLoading(false);
    setNavbarAuthError(null);
    setNavbarAuthStatus(null);
    setNavbarAuthPassword("");
    setNavbarAuthConfirmPassword("");
    setNavbarAuthMode("signin");
    setNavbarAgreementAccepted(false);
  };

  const switchNavbarAuthMode = (mode: "signin" | "signup") => {
    setNavbarAuthMode(mode);
    setNavbarAuthError(null);
    setNavbarAuthStatus(null);
    setNavbarAuthPassword("");
    setNavbarAuthConfirmPassword("");
    setNavbarAgreementAccepted(false);
  };

  const handleNavbarEmailSignIn = async () => {
    setNavbarAuthLoading(true);
    setNavbarAuthError(null);
    setNavbarAuthStatus(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: navbarAuthEmail,
        password: navbarAuthPassword,
      });

      if (error) {
        throw error;
      }

      const signedInUser = data.user ?? data.session?.user;

      if (!signedInUser) {
        throw new Error("Sign in succeeded, but the user session could not be loaded.");
      }

      setShowNavbarAuthModal(false);
      setNavbarAuthPassword("");
      setNavbarAuthLoading(false);
      setUser(signedInUser);
      if (data.session) {
        void runPostAuthWork(data.session);
      } else {
        void loadOrCreateProfile(signedInUser).catch((profileError) => {
          console.error("Unable to load profile after sign in:", profileError);
        });
      }
    } catch (error: any) {
      setNavbarAuthError(`Sign in failed. ${error?.message || "Please verify your email and password."}`);
    } finally {
      setNavbarAuthLoading(false);
    }
  };

  const handleNavbarGoogleSignIn = async () => {
    setNavbarAuthLoading(true);
    setNavbarAuthError(null);
    setNavbarAuthStatus(null);

    if (navbarAuthMode === "signup" && !navbarAgreementAccepted) {
      setNavbarAuthError("Please accept the Terms of Service and Privacy Policy to create an account.");
      setNavbarAuthLoading(false);
      return;
    }

    if (navbarAuthMode === "signup") {
      localStorage.setItem(
        PENDING_SIGNUP_PROFILE_KEY,
        JSON.stringify({
          email: navbarAuthEmail,
          terms_accepted_at: new Date().toISOString(),
          terms_version: AGREEMENT_VERSION,
        })
      );
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
      setNavbarAuthLoading(false);
      setNavbarAuthError(`Google sign in failed. ${error.message}`);
      return;
    }

    window.setTimeout(() => setNavbarAuthLoading(false), 2500);
  };

  const handleNavbarCreateAccount = async () => {
    setNavbarAuthLoading(true);
    setNavbarAuthError(null);
    setNavbarAuthStatus(null);

    if (!navbarAgreementAccepted) {
      setNavbarAuthError("Please accept the Terms of Service and Privacy Policy to create an account.");
      setNavbarAuthLoading(false);
      return;
    }

    if (!navbarAuthAge) {
      setNavbarAuthError("Please select your age.");
      setNavbarAuthLoading(false);
      return;
    }

    if (!navbarAuthFavouritePosition) {
      setNavbarAuthError("Please select your favourite position.");
      setNavbarAuthLoading(false);
      return;
    }

    if (navbarAuthPassword !== navbarAuthConfirmPassword) {
      setNavbarAuthError("Passwords do not match.");
      setNavbarAuthLoading(false);
      return;
    }

    try {
      const termsAcceptedAt = new Date().toISOString();
      const pendingSignupProfile = {
        username: navbarAuthUsername.trim(),
        age: navbarAuthAge,
        gender: navbarAuthGender,
        favouritePosition: navbarAuthFavouritePosition,
        favourite_position: navbarAuthFavouritePosition,
        email: navbarAuthEmail,
        terms_accepted_at: termsAcceptedAt,
        terms_version: AGREEMENT_VERSION,
      };

      localStorage.setItem(PENDING_SIGNUP_PROFILE_KEY, JSON.stringify(pendingSignupProfile));

      const { data, error } = await supabase.auth.signUp({
        email: navbarAuthEmail,
        password: navbarAuthPassword,
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
          email: navbarAuthEmail,
          password: navbarAuthPassword,
        });
        if (signInResult.error) {
          throw signInResult.error;
        }
      }

      const sessionUser = (await supabase.auth.getUser()).data.user;
      if (sessionUser) {
        await supabase.from("profiles").upsert({
          id: sessionUser.id,
          email: navbarAuthEmail,
          username: navbarAuthUsername.trim(),
          age: navbarAuthAge,
          gender: navbarAuthGender,
          favourite_position: navbarAuthFavouritePosition,
          terms_accepted_at: termsAcceptedAt,
          terms_version: AGREEMENT_VERSION,
        });
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
        await loadOrCreateProfile(sessionUser);
        await fetchUnreadNotificationCount();
        closeNavbarAuthModal();
        window.location.href = "/profile";
        return;
      }

      setNavbarAuthStatus("Almost there. Check your email to activate your account.");
    } catch (error: any) {
      localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
      setNavbarAuthError(error?.message || "Unable to create account. Please try again.");
    } finally {
      setNavbarAuthLoading(false);
    }
  };

  return (
    <>
      <Navbar
        user={user}
        profile={profile}
        isAdmin={isAdmin}
        unreadNotificationCount={unreadNotificationCount}
        onLogout={handleSignOut}
        onSignIn={handleNavbarSignIn}
      />
      <Modal
        isOpen={showNavbarAuthModal}
        onClose={closeNavbarAuthModal}
        title="Sign in or create account"
      >
        <div className="space-y-5">
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
              {navbarAuthMode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white">
              Play more football, with less admin.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              {navbarAuthMode === "signup"
                ? "Create your player profile so you can book games and join waiting lists."
                : "Sign in to manage bookings and join games faster."}
            </p>
            {navbarAuthMode === "signup" ? (
              <p className="mt-2 text-xs font-semibold text-stone-300">
                After creating your account, check your email to activate it.
              </p>
            ) : null}

            <div className="mt-6 grid grid-cols-2 rounded-full border border-zinc-800 bg-black p-1">
              <button
                type="button"
                onClick={() => switchNavbarAuthMode("signin")}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                  navbarAuthMode === "signin"
                    ? "bg-stone-200 text-zinc-950 shadow-[0_10px_28px_rgba(214,211,209,0.16)]"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchNavbarAuthMode("signup")}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                  navbarAuthMode === "signup"
                    ? "bg-stone-200 text-zinc-950 shadow-[0_10px_28px_rgba(214,211,209,0.16)]"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Create account
              </button>
            </div>
          </div>

          {navbarAuthError ? (
            <div className="rounded-3xl border border-rose-500/70 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {navbarAuthError}
            </div>
          ) : null}

          {navbarAuthStatus ? (
            <div className="rounded-3xl border border-stone-300/15 bg-zinc-950 px-4 py-3 text-sm font-semibold text-stone-200">
              {navbarAuthStatus}
            </div>
          ) : null}

          <div className="grid gap-5 rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
            <button
              type="button"
              onClick={handleNavbarGoogleSignIn}
              disabled={navbarAuthLoading}
              className="flex w-full items-center justify-center rounded-3xl border border-stone-300/20 bg-zinc-950 px-5 py-4 text-sm font-bold text-stone-200 transition hover:border-stone-200/35 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {navbarAuthLoading ? "Connecting..." : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-800" />
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
                or
              </span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>

            {navbarAuthMode === "signup" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">Username</label>
                  <input
                    value={navbarAuthUsername}
                    onChange={(event) => setNavbarAuthUsername(event.target.value)}
                    className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition-colors duration-150 ease-out placeholder:text-zinc-600 focus:border-white/30"
                    placeholder="Your username"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">Age *</label>
                  <select
                    value={navbarAuthAge}
                    onChange={(event) => setNavbarAuthAge(event.target.value)}
                    className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition-colors duration-150 ease-out focus:border-white/30"
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
                  <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">Gender (Optional)</label>
                  <select
                    value={navbarAuthGender}
                    onChange={(event) => setNavbarAuthGender(event.target.value)}
                    className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition-colors duration-150 ease-out focus:border-white/30"
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
                  <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">Favourite Position *</label>
                  <select
                    value={navbarAuthFavouritePosition}
                    onChange={(event) => setNavbarAuthFavouritePosition(event.target.value)}
                    className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition-colors duration-150 ease-out focus:border-white/30"
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
            ) : null}

            <div>
              <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">Email</label>
              <input
                value={navbarAuthEmail}
                onChange={(event) => setNavbarAuthEmail(event.target.value)}
                className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition-colors duration-150 ease-out placeholder:text-zinc-600 focus:border-white/30"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">Password *</label>
              <div className="relative mt-2">
                <input
                  type={showNavbarAuthPassword ? "text" : "password"}
                  value={navbarAuthPassword}
                  onChange={(event) => setNavbarAuthPassword(event.target.value)}
                  className="w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 pr-20 text-white outline-none transition-colors duration-150 ease-out placeholder:text-zinc-600 focus:border-white/30"
                  placeholder={navbarAuthMode === "signup" ? "Create password" : "Enter your password"}
                />
                <button
                  type="button"
                  onClick={() => setShowNavbarAuthPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-white"
                >
                  {showNavbarAuthPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            {navbarAuthMode === "signup" ? (
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">Confirm Password *</label>
                <input
                  type={showNavbarAuthPassword ? "text" : "password"}
                  value={navbarAuthConfirmPassword}
                  onChange={(event) => setNavbarAuthConfirmPassword(event.target.value)}
                  className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition-colors duration-150 ease-out placeholder:text-zinc-600 focus:border-white/30"
                  placeholder="Confirm password"
                />
              </div>
            ) : null}

            {navbarAuthMode === "signup" ? (
              <label className="flex items-start gap-3 rounded-3xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-300">
                <input
                  type="checkbox"
                  checked={navbarAgreementAccepted}
                  onChange={(event) => setNavbarAgreementAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-950 text-stone-200 focus:ring-2 focus:ring-stone-200/40"
                  aria-label={SIGNUP_AGREEMENT_LABEL}
                  required
                />
                <span>
                  I agree to the{" "}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-stone-200 underline underline-offset-4 hover:text-white"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-stone-200 underline underline-offset-4 hover:text-white"
                  >
                    Privacy Policy
                  </a>{" "}
                  and understand that Fair Play Football will email me important updates about my account, bookings, payments, match reminders, cancellations, waiting-list updates and future football games.
                </span>
              </label>
            ) : null}

            <button
              type="button"
              onClick={navbarAuthMode === "signup" ? handleNavbarCreateAccount : handleNavbarEmailSignIn}
              disabled={navbarAuthLoading}
              className="w-full rounded-3xl border border-stone-200/30 bg-stone-200 px-6 py-4 font-bold text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:border-stone-100 hover:bg-stone-100 hover:shadow-[0_14px_40px_rgba(214,211,209,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {navbarAuthLoading
                ? navbarAuthMode === "signup"
                  ? "Creating..."
                  : "Signing in..."
                : navbarAuthMode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-center text-sm text-zinc-400">
              {navbarAuthMode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                type="button"
                onClick={() => switchNavbarAuthMode(navbarAuthMode === "signup" ? "signin" : "signup")}
                className="font-semibold text-stone-200 hover:text-white"
              >
                {navbarAuthMode === "signup" ? "Sign in" : "Create account"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
      <Hero />
      <main className="bg-black text-white" id="games">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="mb-10 text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500 mb-4">
              Find Games
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              Browse premium football matches in one clean list.
            </h2>
            <p className="mt-4 text-base md:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Discover upcoming games, pick your match, and play when it suits you.
            </p>
          </div>

          {returnPaymentMessage ? (
            <div
              className={`mb-6 rounded-3xl border px-5 py-4 text-sm font-semibold ${
                returnPaymentState === "paid"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  : returnPaymentState === "failed" || returnPaymentState === "paid_no_space" || returnPaymentState === "duplicate_paid"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-100"
              }`}
            >
              {returnPaymentMessage}
            </div>
          ) : null}

          <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 shadow-[0_12px_34px_rgba(0,0,0,0.18)] sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
                  Weekly calendar
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  Pick a date to filter the games below.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleWeekStartKey(addDaysToDateKey(fallbackWeekStartKey, -7))}
                  className="min-h-10 rounded-full border border-zinc-700 bg-zinc-950 px-4 text-sm font-semibold text-zinc-200 transition-colors hover:border-stone-200/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                  aria-label="Show previous week"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGameDateKey(todayDateKey);
                    setVisibleWeekStartKey(todayDateKey);
                  }}
                  className="min-h-10 rounded-full border border-stone-200/25 bg-stone-200 px-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleWeekStartKey(addDaysToDateKey(fallbackWeekStartKey, 7))}
                  className="min-h-10 rounded-full border border-zinc-700 bg-zinc-950 px-4 text-sm font-semibold text-zinc-200 transition-colors hover:border-stone-200/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                  aria-label="Show next week"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="-mx-3 overflow-x-auto scroll-smooth px-3 pb-1 [scroll-snap-type:x_mandatory] sm:mx-0 sm:px-0">
              <div className="flex min-w-max gap-2">
                {weekDateKeys.map((dateKey) => {
                  const gameCount = gamesByDateKey.get(dateKey)?.length ?? 0;
                  const isSelected = dateKey === fallbackSelectedDateKey;
                  const isToday = dateKey === todayDateKey;
                  const hasUserBooking = userBookedDateKeys.has(dateKey);
                  const weekdayLabel = formatCalendarDateLabel(dateKey).split(",")[0];

                  return (
                    <button
                      key={dateKey}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`${formatCalendarDateLabel(dateKey)}, ${gameCount} ${gameCount === 1 ? "game" : "games"}${hasUserBooking ? ", you have a booking" : ""}${isToday ? ", today" : ""}`}
                      onClick={() => setSelectedGameDateKey(dateKey)}
                      className={`min-h-[4.75rem] w-[5.15rem] snap-start rounded-2xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-stone-200/50 ${
                        isSelected
                          ? "border-stone-200/50 bg-stone-200 text-zinc-950 shadow-[0_10px_28px_rgba(214,211,209,0.14)]"
                          : "border-zinc-800 bg-zinc-950/90 text-zinc-300 hover:border-stone-200/25 hover:bg-zinc-900 hover:text-white"
                      }`}
                    >
                      <span className={`block text-[0.68rem] font-bold uppercase tracking-[0.22em] ${isSelected ? "text-zinc-700" : "text-zinc-500"}`}>
                        {weekdayLabel}
                      </span>
                      <span className="mt-0.5 block text-[1.55rem] font-black leading-none">
                        {formatCalendarDayNumber(dateKey)}
                      </span>
                      <span className={`mt-1.5 flex items-center justify-between gap-2 text-[0.68rem] font-semibold ${isSelected ? "text-zinc-700" : "text-zinc-400"}`}>
                        <span className={`rounded-full border px-2 py-0.5 ${isSelected ? "border-zinc-950/10 bg-zinc-950/5" : "border-zinc-700 bg-white/[0.03]"}`}>
                          {gameCount}
                        </span>
                        {hasUserBooking ? (
                          <span
                            aria-hidden="true"
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem] font-black ${isSelected ? "border-zinc-950/20 bg-zinc-950/10 text-zinc-900" : "border-stone-200/25 bg-stone-200/10 text-stone-200"}`}
                          >
                            ✓
                          </span>
                        ) : null}
                      </span>
                      {isToday ? (
                        <span className={`mt-2 block h-1 w-7 rounded-full ${isSelected ? "bg-zinc-950/35" : "bg-stone-200/45"}`} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {selectedDatedGames.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 px-5 py-7 text-center shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
                <p className="text-base font-semibold text-white">No games on this date.</p>
                <p className="mt-2 text-sm text-zinc-400">
                  Pick another day or jump to the next available match.
                </p>
                {nextAvailableDateKey ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGameDateKey(nextAvailableDateKey);
                      setVisibleWeekStartKey(nextAvailableDateKey);
                    }}
                    className="mt-4 min-h-10 rounded-full border border-stone-200/30 bg-stone-200 px-5 text-sm font-bold text-zinc-950 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
                  >
                    Next available game
                  </button>
                ) : null}
              </div>
            ) : null}

            {selectedDatedGames.map(renderGameCard)}

            {legacyGames.length > 0 ? (
              <div className="space-y-4 pt-2">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-500">
                    Date not available
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    These games do not have a structured kickoff date yet, so they are not counted in the calendar.
                  </p>
                </div>
                {legacyGames.map(renderGameCard)}
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
