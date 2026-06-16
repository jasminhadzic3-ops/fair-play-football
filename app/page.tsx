"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import GameCard from "@/components/games/GameCard";
import Navbar from "@/components/shared/layout/Navbar";
import Hero from "@/components/shared/layout/Hero";
import Modal from "@/components/shared/ui/Modal";

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
  const [returnPaymentState, setReturnPaymentState] = useState<"checking" | "paid" | "pending" | "failed" | null>(null);
  const [showNavbarAuthModal, setShowNavbarAuthModal] = useState(false);
  const [navbarAuthEmail, setNavbarAuthEmail] = useState("");
  const [navbarAuthPassword, setNavbarAuthPassword] = useState("");
  const [navbarAuthConfirmPassword, setNavbarAuthConfirmPassword] = useState("");
  const [navbarAuthUsername, setNavbarAuthUsername] = useState("");
  const [navbarAuthAge, setNavbarAuthAge] = useState("");
  const [navbarAuthGender, setNavbarAuthGender] = useState("");
  const [navbarAuthFavouritePosition, setNavbarAuthFavouritePosition] = useState("");
  const [navbarAuthMode, setNavbarAuthMode] = useState<"signin" | "signup">("signin");
  const [navbarAuthLoading, setNavbarAuthLoading] = useState(false);
  const [navbarAuthError, setNavbarAuthError] = useState<string | null>(null);
  const [navbarAuthStatus, setNavbarAuthStatus] = useState<string | null>(null);
  const [showNavbarAuthPassword, setShowNavbarAuthPassword] = useState(false);
  const [openDetailsGameId, setOpenDetailsGameId] = useState<number | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const returnPollingReference = useRef<string | null>(null);
  const ageOptions = Array.from({ length: 45 }, (_, index) => String(index + 16));
  const positionOptions = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Flexible"];

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

    if (existingProfile) {
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
      })
      .select("*")
      .single();

    if (error) {
      console.error("Unable to create profile:", error.message);
      return null;
    }

    setProfile(data);
    return data;
  }

  async function fetchGames() {
    const { data: gamesData } = await supabase.from("games").select("*");
    const { data: bookingsData } = await supabase.from("bookings").select("*");

    if (gamesData) {
      setGames(gamesData);
    }

    if (bookingsData) {
      setBookings(bookingsData);
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

  function clearPendingCheckoutState() {
    localStorage.removeItem("pendingJoinGameId");
    localStorage.removeItem("pendingSumUpGameId");
    localStorage.removeItem("pendingSumUpCheckoutId");
    localStorage.removeItem("pendingSumUpCheckoutReference");
  }

  function openGameFromNotification() {
    const gameId = new URLSearchParams(window.location.search).get("open_game_id");

    if (!gameId) {
      return;
    }

    setOpenDetailsGameId(Number(gameId));
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

      const paymentStatus = String(result?.paymentStatus || "").toLowerCase();

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
        setTimeout(() => setSuccessGameId(null), 2000);
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

    let listenerSubscription: { unsubscribe: () => void } | undefined;

    const initializeAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setUser(session?.user ?? null);
      if (session?.user) {
        void runPostAuthWork(session);
      }

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          void runPostAuthWork(session);
        } else {
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
  };

  const switchNavbarAuthMode = (mode: "signin" | "signup") => {
    setNavbarAuthMode(mode);
    setNavbarAuthError(null);
    setNavbarAuthStatus(null);
    setNavbarAuthPassword("");
    setNavbarAuthConfirmPassword("");
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
      const pendingSignupProfile = {
        username: navbarAuthUsername.trim(),
        age: navbarAuthAge,
        gender: navbarAuthGender,
        favouritePosition: navbarAuthFavouritePosition,
        favourite_position: navbarAuthFavouritePosition,
        email: navbarAuthEmail,
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
        });
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
        await loadOrCreateProfile(sessionUser);
        await fetchUnreadNotificationCount();
        closeNavbarAuthModal();
        window.location.href = "/profile";
        return;
      }

      setNavbarAuthStatus("Check your email to verify your account. Your profile will be completed after verification.");
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
              {null}
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              {navbarAuthMode === "signup"
                ? "Enter your details to continue."
                : "Enter your credentials to continue."}
            </p>
            {navbarAuthMode === "signup" ? (
              <p className="mt-2 text-xs font-semibold text-stone-300">
                Please check your email and verify your account after signing up.
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
                {navbarAuthMode === "signup" ? "Sign In" : "Create Account"}
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
                  : returnPaymentState === "failed"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-100"
              }`}
            >
              {returnPaymentMessage}
            </div>
          ) : null}

          <div className="space-y-6">
            {games.map((game) => (
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
                  }, 2000);
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
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
