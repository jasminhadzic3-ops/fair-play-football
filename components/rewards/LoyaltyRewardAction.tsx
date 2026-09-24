"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const actionClass = "mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-400 px-5 text-sm font-bold text-white transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200/60";

export default function LoyaltyRewardAction() {
  const [authState, setAuthState] = useState<"loading" | "signed-in" | "signed-out">("loading");

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) setAuthState(data.user ? "signed-in" : "signed-out");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setAuthState(session?.user ? "signed-in" : "signed-out");
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (authState === "loading") {
    return <span className={`${actionClass} pointer-events-none opacity-0`} aria-hidden="true">Loading</span>;
  }

  return (
    <Link href={authState === "signed-in" ? "/wallet" : "/?sign_in=1"} className={actionClass}>
      {authState === "signed-in" ? "Take me there" : "Create Fair Play account"}
      <span className="ml-3 text-lg" aria-hidden="true">→</span>
    </Link>
  );
}
