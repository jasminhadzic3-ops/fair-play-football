"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import GameCard from "@/components/games/GameCard";
import Navbar from "@/components/shared/layout/Navbar";
import Hero from "@/components/shared/layout/Hero";

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
  const [navbarAuthOpen, setNavbarAuthOpen] = useState(false);
  const returnPollingReference = useRef<string | null>(null);

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

  function continuePendingJoin() {
    const pendingJoinGameId = localStorage.getItem("pendingJoinGameId");

    if (!pendingJoinGameId) {
      return;
    }

    localStorage.removeItem("pendingJoinGameId");
    setCheckoutGameId(Number(pendingJoinGameId));
  }

  function continuePendingPayment() {
    const pendingSumUpGameId = localStorage.getItem("pendingSumUpGameId");
    const pendingSumUpCheckoutId = localStorage.getItem("pendingSumUpCheckoutId");
    const pendingSumUpCheckoutReference = localStorage.getItem("pendingSumUpCheckoutReference");

    if (!pendingSumUpGameId || (!pendingSumUpCheckoutId && !pendingSumUpCheckoutReference)) {
      return;
    }

    setPendingCheckoutId(pendingSumUpCheckoutId);
    setPendingCheckoutReference(pendingSumUpCheckoutReference);
    setCheckoutGameId(Number(pendingSumUpGameId));
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
        localStorage.removeItem("pendingSumUpGameId");
        localStorage.removeItem("pendingSumUpCheckoutId");
        localStorage.removeItem("pendingSumUpCheckoutReference");
        localStorage.setItem("fairPlayBookingsUpdatedAt", String(Date.now()));
        setPendingCheckoutId(null);
        setPendingCheckoutReference(null);
        setCheckoutGameId(null);
        setSuccessGameId(result?.gameId ?? null);
        await fetchGames();
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

  useEffect(() => {
    fetchGames();

    let listenerSubscription: { unsubscribe: () => void } | undefined;

    const initializeAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setUser(session?.user ?? null);
      if (session?.user) {
        await loadOrCreateProfile(session.user);
        continuePendingJoin();
        continuePendingPayment();
        await checkReturnedPayment(session.access_token);
      }

      const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await loadOrCreateProfile(session.user);
          continuePendingJoin();
          continuePendingPayment();
          await checkReturnedPayment(session.access_token);
        } else {
          setProfile(null);
        }
      });

      listenerSubscription = listener.subscription;
    };

    initializeAuth();

    return () => {
      listenerSubscription?.unsubscribe();
    };
  }, []);

  const leaveGame = async (bookingId: number) => {

    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", bookingId);

    if (error) {
      console.error("Unable to leave game:", error.message);
      return;
    }

    await fetchGames();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <>
      <Navbar
        user={user}
        profile={profile}
        onLogout={handleSignOut}
        onSignIn={() => setNavbarAuthOpen(true)}
      />
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
              Discover upcoming games, compare formats, venues, spots and pricing with a bold dark layout.
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
                continueToPayment={checkoutGameId === game.id}
                onContinueToPaymentHandled={() => {
                  setCheckoutGameId(null);
                  setPendingCheckoutId(null);
                  setPendingCheckoutReference(null);
                }}
                openAuthModal={navbarAuthOpen && game.id === games[0]?.id}
                onOpenAuthModalHandled={() => setNavbarAuthOpen(false)}
              />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
