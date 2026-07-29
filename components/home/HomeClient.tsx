"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { duplicatePaidPaymentMessage } from "@/lib/sumupPaymentMessages";
import GameCard from "@/components/games/GameCard";
import Navbar from "@/components/shared/layout/Navbar";
import Hero from "@/components/shared/layout/Hero";
import Footer from "@/components/shared/layout/Footer";
import Modal from "@/components/shared/ui/Modal";
import { AGREEMENT_VERSION, SIGNUP_AGREEMENT_LABEL } from "@/lib/signupAgreement";
import { REFUND_POLICY_ITEMS } from "@/lib/refundPolicy";
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
const PENDING_SUMUP_CHECKOUT_REFERENCE_KEY = "pendingSumUpCheckoutReference";

type HomeClientProps = {
  initialPaymentReturnReference?: string | null;
};

export default function HomeClient({ initialPaymentReturnReference = null }: HomeClientProps) {
  const hasInitialPaymentReturnReference = Boolean(initialPaymentReturnReference);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [games, setGames] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [successGameId, setSuccessGameId] = useState<number | null>(null);
  const [checkoutGameId, setCheckoutGameId] = useState<number | null>(null);
  const [pendingCheckoutId, setPendingCheckoutId] = useState<string | null>(null);
  const [pendingCheckoutReference, setPendingCheckoutReference] = useState<string | null>(null);
  const [returnPaymentMessage, setReturnPaymentMessage] = useState<string | null>(
    hasInitialPaymentReturnReference
      ? "We're checking your payment. This may take a few moments."
      : null
  );
  const [returnPaymentState, setReturnPaymentState] = useState<"checking" | "paid" | "paid_no_space" | "duplicate_paid" | "pending" | "failed" | null>(
    hasInitialPaymentReturnReference ? "checking" : null
  );
  const [paymentReturnGateActive, setPaymentReturnGateActive] = useState(hasInitialPaymentReturnReference);
  const [paymentReturnTargetGameId, setPaymentReturnTargetGameId] = useState<number | null>(null);
  const [recoveredPaymentReturnReference, setRecoveredPaymentReturnReference] = useState<string | null>(null);
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
  const [showAllGames, setShowAllGames] = useState(false);
  const [visibleWeekStartKey, setVisibleWeekStartKey] = useState<string | null>(null);
  const [weekNavigationDirection, setWeekNavigationDirection] = useState<"previous" | "next" | null>(null);
  const returnPollingReference = useRef<string | null>(null);
  const ageOptions = Array.from({ length: 45 }, (_, index) => String(index + 16));
  const positionOptions = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible"];
  const todayDateKey = getTodayLondonDateKey();
  const fallbackSelectedDateKey = showAllGames ? null : selectedGameDateKey ?? getDefaultSelectedDateKey(games);
  const fallbackWeekStartKey = visibleWeekStartKey ?? selectedGameDateKey ?? getDefaultSelectedDateKey(games);
  const weekDateKeys = getWeekDateKeys(fallbackWeekStartKey);
  const calendarGames = games.filter((game) => {
    const dateKey = getGameLondonDateKey(game);

    return Boolean(dateKey && dateKey >= todayDateKey);
  });
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
  const selectedDatedGames = showAllGames
    ? sortGamesByStartsAt(calendarGames)
    : sortGamesByStartsAt(fallbackSelectedDateKey ? gamesByDateKey.get(fallbackSelectedDateKey) ?? [] : []);
  const nextAvailableDateKey: string | null =
    Array.from(gamesByDateKey.keys()).sort().find((dateKey) => dateKey >= todayDateKey) ??
    Array.from(gamesByDateKey.keys()).sort()[0] ??
    null;
  const weekSlideClass =
    weekNavigationDirection === "next"
      ? "calendar-week-slide-next"
      : weekNavigationDirection === "previous"
        ? "calendar-week-slide-previous"
        : "";
  const isPaymentReturnGateActive = paymentReturnGateActive;
  const hideHeroForPaymentReturn = isPaymentReturnGateActive || (hasInitialPaymentReturnReference && returnPaymentState !== null);

  function getStoredPaymentReturnReference() {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return localStorage.getItem(PENDING_SUMUP_CHECKOUT_REFERENCE_KEY);
    } catch {
      return null;
    }
  }

  function getCurrentPaymentReturnReference() {
    if (typeof window === "undefined") {
      return initialPaymentReturnReference ?? recoveredPaymentReturnReference;
    }

    const checkoutReferenceFromUrl = new URLSearchParams(window.location.search).get("sumup_checkout_reference");
    return checkoutReferenceFromUrl || initialPaymentReturnReference || recoveredPaymentReturnReference || getStoredPaymentReturnReference();
  }

  useLayoutEffect(() => {
    const recoveredReference = getCurrentPaymentReturnReference();

    if (!recoveredReference) {
      document.documentElement.removeAttribute("data-payment-return-pending");
      return;
    }

    setRecoveredPaymentReturnReference(recoveredReference);
    setPaymentReturnGateActive(true);
    setReturnPaymentState("checking");
    setReturnPaymentMessage("We're checking your payment. This may take a few moments.");
  }, []);

  useLayoutEffect(() => {
    if (!paymentReturnGateActive) {
      return;
    }

    document.documentElement.removeAttribute("data-payment-return-pending");
  }, [paymentReturnGateActive]);

  useEffect(() => {
    if (games.length === 0 || selectedGameDateKey || showAllGames) {
      return;
    }

    const defaultDateKey = getDefaultSelectedDateKey(games);
    setSelectedGameDateKey(defaultDateKey);
    setVisibleWeekStartKey(defaultDateKey);
  }, [games, selectedGameDateKey, showAllGames]);

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
      const nextBookings = bookingsResult?.bookings ?? [];
      setBookings(nextBookings);
      setBookingsLoaded(true);
      return {
        games: gamesData ?? [],
        bookings: nextBookings,
      };
    } else {
      console.error("Unable to load bookings:", bookingsResult?.error || "Unknown error");
      setBookingsLoaded(false);
    }

    return {
      games: gamesData ?? [],
      bookings,
    };
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
    localStorage.removeItem(PENDING_SUMUP_CHECKOUT_REFERENCE_KEY);
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

  async function continuePendingPayment() {
    const currentPaymentReturnReference = getCurrentPaymentReturnReference();

    if (currentPaymentReturnReference) {
      return;
    }

    clearPendingCheckoutState();
    setPendingCheckoutId(null);
    setPendingCheckoutReference(null);
    setCheckoutGameId(null);
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
    const checkoutReference = getCurrentPaymentReturnReference();

    if (!checkoutReference || returnPollingReference.current === checkoutReference) {
      return;
    }

    returnPollingReference.current = checkoutReference;
    setRecoveredPaymentReturnReference(checkoutReference);
    setPaymentReturnGateActive(true);
    setReturnPaymentState("checking");
    setReturnPaymentMessage("Checking your payment...");

    const deadline = Date.now() + 30000;

    while (Date.now() <= deadline) {
      let response: Response;

      try {
        response = await fetch(
          `/api/sumup/status?checkout_reference=${encodeURIComponent(checkoutReference)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
      } catch (error) {
        if (document.visibilityState === "hidden") {
          return;
        }

        setReturnPaymentState("failed");
        setReturnPaymentMessage("Unable to check payment status.");
        return;
      }

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
        setPaymentReturnTargetGameId(paidGameId);
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem(PENDING_SUMUP_CHECKOUT_REFERENCE_KEY);
        localStorage.setItem("fairPlayBookingsUpdatedAt", String(Date.now()));
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
        setCheckoutGameId(null);
        setSuccessGameId(paidGameId);
        const refreshed = await fetchGames();
        if (paidGameId) {
          const refreshedGameExists = refreshed.games.some((game) => game.id === paidGameId);
          if (refreshedGameExists) {
            setOpenDetailsGameId(paidGameId);
          } else {
            setPaymentReturnGateActive(false);
          }
        } else {
          setPaymentReturnGateActive(false);
        }
        clearSumUpCheckoutReferenceFromUrl();
        setReturnPaymentState("paid");
        setReturnPaymentMessage("Payment confirmed. Your booking has been added.");
        setTimeout(() => setSuccessGameId(null), 5000);
        return;
      }

      if (paymentStatus === "paid_no_space") {
        const paidNoSpaceGameId = result?.gameId ?? (Number(localStorage.getItem("pendingSumUpGameId")) || null);
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem(PENDING_SUMUP_CHECKOUT_REFERENCE_KEY);
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
        setPaymentReturnGateActive(false);
        return;
      }

      if (paymentStatus === "duplicate_paid") {
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem(PENDING_SUMUP_CHECKOUT_REFERENCE_KEY);
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
        setCheckoutGameId(null);
        clearSumUpCheckoutReferenceFromUrl();
        setReturnPaymentState("duplicate_paid");
        setReturnPaymentMessage(result?.message || duplicatePaidPaymentMessage);
        setPaymentReturnGateActive(false);
        return;
      }

      if (paymentStatus === "failed" || paymentStatus === "expired") {
        setPaymentReturnGateActive(false);
        setReturnPaymentState("failed");
        setReturnPaymentMessage("SumUp could not complete the payment. Please try again.");
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    setReturnPaymentState("pending");
    setPaymentReturnGateActive(false);
    setReturnPaymentMessage("Payment is still processing.");
  }

  async function runPostAuthWork(session: { user: User; access_token: string }) {
    try {
      await loadOrCreateProfile(session.user);
      await fetchUnreadNotificationCount();
      openGameFromNotification();
      continuePendingJoin();
      await continuePendingPayment();
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
    if (
      !paymentReturnGateActive ||
      returnPaymentState !== "paid" ||
      !paymentReturnTargetGameId
    ) {
      return;
    }

    const targetGame = games.find((game) => game.id === paymentReturnTargetGameId);
    const hasTargetBooking = bookings.some((booking) => booking.game_id === paymentReturnTargetGameId);

    if (
      targetGame &&
      bookingsLoaded &&
      hasTargetBooking &&
      openDetailsGameId === paymentReturnTargetGameId
    ) {
      setPaymentReturnGateActive(false);
    }
  }, [
    bookings,
    bookingsLoaded,
    games,
    openDetailsGameId,
    paymentReturnGateActive,
    paymentReturnTargetGameId,
    returnPaymentState,
  ]);

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
      window.alert(result?.error || "Unable to cancel this booking.");
      return;
    }

    await fetchGames();
    window.alert(result?.message || "Booking cancelled.");
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
      {hideHeroForPaymentReturn ? null : <Hero />}
      <main
        className={`bg-black text-white ${isPaymentReturnGateActive ? "min-h-[calc(100vh-4.5rem)]" : ""}`}
        id="games"
      >
        <div className="max-w-5xl mx-auto px-6 py-12">
          {!isPaymentReturnGateActive ? (
            <div className="mb-5 text-center">
              <p className="text-xs uppercase tracking-[0.35em] text-zinc-500 mb-3">
                Find Games
              </p>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                Browse premium football matches in one clean list.
              </h2>
              <p className="mt-2 text-base md:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
                Discover upcoming games, pick your match, and play when it suits you.
              </p>
            </div>
          ) : null}

          {isPaymentReturnGateActive ? (
            <section
              className="mx-auto max-w-2xl rounded-3xl border border-stone-200/15 bg-zinc-950 px-6 py-8 text-center shadow-[0_18px_54px_rgba(214,211,209,0.08)]"
              aria-live="polite"
              aria-busy="true"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500">
                Payment return
              </p>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                Confirming your booking
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-400 md:text-base">
                We&apos;re checking your payment. This may take a few moments.
              </p>
              <div
                className="mx-auto mt-6 h-2 w-32 overflow-hidden rounded-full bg-zinc-800"
                aria-hidden="true"
              >
                <div className="h-full w-1/2 animate-pulse rounded-full bg-stone-200" />
              </div>
            </section>
          ) : (
            <>
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

          <div className="mb-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-[0_12px_34px_rgba(0,0,0,0.16)]">
            <div className="flex flex-col gap-2.5 border-b border-zinc-800/80 px-3 py-2.5 sm:px-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.72rem] font-semibold text-zinc-500">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-400/45 bg-emerald-500/20 text-[0.58rem] font-black text-emerald-200"
                  >
                    ✓
                  </span>
                  <span>= Your Booking</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-zinc-700 bg-white/[0.03] px-1 text-[0.58rem] font-semibold leading-none text-zinc-400"
                  >
                    1
                  </span>
                  <span>= Games on This Date</span>
                </span>
              </div>
              <div className="flex w-full items-center gap-1.5 rounded-full border border-zinc-800 bg-black p-1 md:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setWeekNavigationDirection("previous");
                    setVisibleWeekStartKey(addDaysToDateKey(fallbackWeekStartKey, -7));
                  }}
                  className="min-h-9 rounded-full px-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                  aria-label="Show previous week"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWeekNavigationDirection(null);
                    setShowAllGames(false);
                    setSelectedGameDateKey(todayDateKey);
                    setVisibleWeekStartKey(todayDateKey);
                  }}
                  className="min-h-9 rounded-full bg-stone-200 px-3.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWeekNavigationDirection("next");
                    setVisibleWeekStartKey(addDaysToDateKey(fallbackWeekStartKey, 7));
                  }}
                  className="min-h-9 rounded-full px-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                  aria-label="Show next week"
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWeekNavigationDirection(null);
                    setShowAllGames(true);
                    setSelectedGameDateKey(null);
                  }}
                  className={`min-h-9 rounded-full px-3.5 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-stone-200/50 ${
                    showAllGames
                      ? "bg-stone-200 text-zinc-950 hover:bg-stone-100"
                      : "text-zinc-300 hover:bg-zinc-900 hover:text-white"
                  }`}
                  aria-pressed={showAllGames}
                >
                  All Games
                </button>
              </div>
            </div>

            <div className="overflow-x-auto scroll-smooth px-3 py-2.5 [scroll-snap-type:x_mandatory] sm:px-4">
              <div
                key={fallbackWeekStartKey}
                className={`grid min-w-max grid-cols-7 gap-2.5 md:w-full md:min-w-0 ${weekSlideClass}`}
              >
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
                      onClick={() => {
                        setShowAllGames(false);
                        setSelectedGameDateKey(dateKey);
                      }}
                      className={`min-h-[4.25rem] w-[6.6rem] snap-start rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-stone-200/50 md:w-full ${
                        isSelected
                          ? "border-stone-200/60 bg-stone-200 text-zinc-950"
                          : "border-zinc-800 bg-zinc-900/45 text-zinc-300 hover:border-stone-200/25 hover:bg-zinc-900 hover:text-white"
                      }`}
                    >
                      <span className={`block text-[0.68rem] font-bold uppercase tracking-[0.2em] ${isSelected ? "text-zinc-700" : "text-zinc-500"}`}>
                        {weekdayLabel}
                      </span>
                      <span className="mt-1 flex items-end justify-between gap-3">
                        <span className="block text-[1.55rem] font-black leading-none">
                          {formatCalendarDayNumber(dateKey)}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold leading-none ${isSelected ? "border-zinc-950/10 bg-zinc-950/5 text-zinc-700" : "border-zinc-700 bg-white/[0.03] text-zinc-400"}`}
                            data-testid={`calendar-game-count-${dateKey}`}
                          >
                            {gameCount}
                          </span>
                          {hasUserBooking ? (
                            <span
                              aria-hidden="true"
                              data-testid={`calendar-booked-tick-${dateKey}`}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[0.68rem] font-black shadow-[0_0_18px_rgba(16,185,129,0.18)] ${
                                isSelected
                                  ? "border-emerald-700/35 bg-emerald-500 text-zinc-950"
                                  : "border-emerald-400/45 bg-emerald-500/20 text-emerald-200"
                              }`}
                            >
                              ✓
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {isToday ? (
                        <span className={`mt-2 block h-1 w-8 rounded-full ${isSelected ? "bg-zinc-950/35" : "bg-stone-200/45"}`} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {!showAllGames && selectedDatedGames.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">No games on this date.</p>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    Pick another day or jump to the next available match.
                  </p>
                </div>
                {nextAvailableDateKey ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGameDateKey(nextAvailableDateKey);
                      setVisibleWeekStartKey(nextAvailableDateKey);
                    }}
                    className="min-h-9 rounded-full border border-stone-200/30 bg-stone-200 px-4 text-sm font-bold text-zinc-950 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
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
            </>
          )}
        </div>
      </main>

      {!isPaymentReturnGateActive ? (
        <>
      <section id="about" className="bg-black px-6 py-14 text-white sm:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500">
                About
              </p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
                Friendly games, good vibes and all skill levels welcome.
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-300 md:text-lg">
                Fair Play Football is a co-ed 18+ football platform that organises friendly games across North
                London. Whether you play every week or haven't kicked a ball in years, you're welcome to join.
              </p>
            </div>

            <div className="rounded-2xl border border-stone-200/15 bg-stone-200 px-5 py-5 text-zinc-950 shadow-[0_18px_54px_rgba(214,211,209,0.12)]">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-zinc-700">
                Choose your game
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-800">
                Some games are casual, while others are more competitive. When a game is competitive, it will be
                clearly labelled on the game card so you can choose the type of match that suits you.
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Find a game",
                text: "Use the calendar and game cards to pick a North London match that suits your level and schedule.",
              },
              {
                title: "Book and pay",
                text: "Reserve your spot online. Places are confirmed on a first paid, first served basis.",
              },
              {
                title: "Turn up and play",
                text: "Arrive 10 minutes early, meet the group, grab a bib and enjoy the game.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-[0_14px_42px_rgba(0,0,0,0.18)]"
              >
                <h3 className="text-lg font-bold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="text-xl font-bold text-white">Our Venues</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              We currently organise games at three high-quality 3G artificial grass venues across North London:
            </p>
            <div className="mt-3 grid gap-2 text-sm leading-6 text-zinc-300">
              <p>📍 Whittington Park – Yerbury Road, Archway, London N19 4RS</p>
              <p>📍 Cantelowes Gardens (Talacre Community Sports Centre) – Dalby Street, Kentish Town, London NW5 3AF</p>
              <p>📍 Barnard Park – Copenhagen Street, Islington, London N1 0ER</p>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {[
                {
                  name: "Whittington Park",
                  features: [
                    "High-quality 3G artificial grass pitch",
                    "Outdoor pitch",
                    "Easy access from Archway Underground",
                    "Modern facilities",
                  ],
                },
                {
                  name: "Cantelowes Gardens",
                  features: [
                    "High-quality 3G artificial grass pitch",
                    "Outdoor pitch",
                    "Modern football facilities",
                  ],
                },
                {
                  name: "Barnard Park",
                  features: [
                    "High-quality 3G artificial grass pitch",
                    "Outdoor pitch",
                    "Central Islington location",
                  ],
                },
              ].map((venue) => (
                <div key={venue.name} className="rounded-xl border border-zinc-800 bg-black/40 p-4">
                  <h4 className="text-base font-bold text-white">{venue.name}</h4>
                  <div className="mt-4 grid gap-2 text-sm text-zinc-300">
                    {venue.features.map((feature) => (
                      <div key={feature} className="flex gap-2">
                        <span className="text-stone-300" aria-hidden="true">✓</span>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="text-xl font-bold text-white">Refund Policy</h3>
            <div className="mt-4 grid gap-3 text-sm leading-6 text-zinc-300">
              {REFUND_POLICY_ITEMS.map((item) => (
                <div key={item} className="flex gap-3 rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5">
                  <span className="mt-0.5 text-stone-300" aria-hidden="true">•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="text-xl font-bold text-white">What to expect</h3>
              <div className="mt-4 grid gap-2 text-sm text-zinc-300">
                {[
                  "Fresh bibs and footballs are provided.",
                  "Goalkeeper rotates every 8 minutes.",
                  "No slide tackles.",
                  "Arrive 10 minutes early.",
                  "Respectful behaviour is expected from everyone.",
                  "Games require enough confirmed players to go ahead.",
                ].map((item) => (
                  <div key={item} className="flex gap-3 rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5">
                    <span className="mt-0.5 text-stone-300" aria-hidden="true">✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="text-xl font-bold text-white">FAQ</h3>
              <div className="mt-4 grid gap-3">
                {[
                  {
                    question: "Are beginners welcome?",
                    answer: "Yes. Beginners, returning players and regular players are all welcome.",
                  },
                  {
                    question: "Is it co-ed?",
                    answer: "Yes. Fair Play Football is co-ed and open to everyone aged 18+.",
                  },
                  {
                    question: "What is the age requirement?",
                    answer: "Players must be 18 or over.",
                  },
                  {
                    question: "What is the difference between casual and competitive games?",
                    answer: "Casual games are relaxed and social. Competitive games have a sharper tempo while staying respectful.",
                  },
                  {
                    question: "How do I know if a game is competitive?",
                    answer: "Competitive games are clearly labelled on the game card.",
                  },
                  {
                    question: "Can I join alone?",
                    answer: "Yes. Most players book individually and teams are balanced on the day.",
                  },
                  {
                    question: "What footwear should I wear?",
                    answer: "Astros, moulds and football boots are allowed. No metal studs.",
                  },
                  {
                    question: "What happens if it rains?",
                    answer: "Games usually go ahead in normal rain. If the organiser cancels, players receive the full amount back.",
                  },
                  {
                    question: "What happens if a game is full?",
                    answer: "You can join the waiting list. If a space opens, you will be notified.",
                  },
                  {
                    question: "What do I need to bring?",
                    answer: "Bring suitable boots, water and enough time to arrive 10 minutes early.",
                  },
                  {
                    question: "How do cancellations and refunds work?",
                    answer: "Cancel at least 24 hours before kick-off for a full refund. Within 24 hours, no refund is available. If Fair Play Football cancels, including when the minimum player number is not reached, booked players receive a full refund.",
                  },
                ].map((item) => (
                  <details key={item.question} className="group rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                    <summary className="cursor-pointer list-none text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50">
                      <span className="inline-flex w-full items-center justify-between gap-3">
                        {item.question}
                        <span className="text-zinc-500 transition group-open:rotate-45" aria-hidden="true">+</span>
                      </span>
                    </summary>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">{item.answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="text-lg font-bold text-white">North London locations</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Games take place at North London venues. Exact pitch and venue details are shown on each game card.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="text-lg font-bold text-white">Ready to play?</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Find a match that suits you and book your place when you are ready.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#games"
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-stone-200 px-5 text-sm font-bold text-zinc-950 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
                >
                  Find Games
                </a>
                {!user ? (
                  <button
                    type="button"
                    onClick={() => {
                      setNavbarAuthMode("signup");
                      setNavbarAuthError(null);
                      setNavbarAuthStatus(null);
                      setShowNavbarAuthModal(true);
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300/20 bg-zinc-900 px-5 text-sm font-bold text-stone-200 transition-colors hover:border-stone-200/35 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                  >
                    Sign Up
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Need more help?</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Contact Fair Play Football for booking, payment, refund or general support.
                </p>
              </div>
              <Link
                href="/contact"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300/20 bg-zinc-900 px-5 text-sm font-bold text-stone-200 transition-colors hover:border-stone-200/35 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-stone-200/40"
              >
                Contact Support
              </Link>
            </div>
          </div>
        </div>
      </section>
      <Footer />
        </>
      ) : null}
    </>
  );
}
