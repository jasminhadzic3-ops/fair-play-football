"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getProfileOnboardingPath, isEmailVerified } from "@/lib/onboarding";
import { supabase } from "@/lib/supabase";

type ConfirmationState = "checking" | "failed";

function clearConfirmationUrl() {
  const url = new URL(window.location.href);
  window.history.replaceState({}, document.title, `${url.pathname}`);
}

export default function ConfirmEmailPage() {
  const [state, setState] = useState<ConfirmationState>("checking");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    let isMounted = true;

    async function confirmEmail() {
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = url.searchParams.get("code");
      const linkType = hashParams.get("type") || url.searchParams.get("type");
      const linkError = hashParams.get("error") || url.searchParams.get("error");

      try {
        if (linkError) {
          throw new Error("verification link error");
        }

        if (linkType && linkType !== "signup") {
          throw new Error("unexpected confirmation link type");
        }

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            throw error;
          }
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            throw error;
          }
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !isEmailVerified(user)) {
          throw new Error("email was not verified");
        }

        clearConfirmationUrl();
        window.location.replace(getProfileOnboardingPath("verified"));
      } catch {
        clearConfirmationUrl();

        if (isMounted) {
          setState("failed");
        }
      }
    }

    void confirmEmail();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-black px-4 py-8 text-white sm:px-6 sm:py-16">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg items-center sm:min-h-[calc(100vh-8rem)]">
        <section className="w-full rounded-[2rem] border border-stone-300/15 bg-zinc-950 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:rounded-[2.25rem] sm:p-9">
          {state === "checking" ? (
            <div aria-live="polite">
              <p className="text-xs font-bold uppercase tracking-[0.35em] text-stone-400">Fair Play Football</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Verifying your email</h1>
              <p className="mt-3 text-[15px] leading-7 text-zinc-300">Just a moment while we finish setting up your account.</p>
              <div aria-hidden="true" className="mt-7 flex gap-2">
                <span className="size-1.5 rounded-full bg-stone-200" />
                <span className="size-1.5 rounded-full bg-stone-500" />
                <span className="size-1.5 rounded-full bg-stone-700" />
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.35em] text-stone-400">Verification link</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">This link is no longer valid</h1>
              <p role="alert" className="mt-3 text-[15px] leading-7 text-zinc-300">
                It may have expired or already been used. Request a new link to continue.
              </p>
              <Link
                href="/verify-email?issue=link"
                className="mt-7 inline-flex w-full items-center justify-center rounded-3xl border border-stone-200/30 bg-stone-200 px-6 py-4 font-bold text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
              >
                Request a new link
              </Link>
              <Link
                href="/"
                className="mt-3 inline-flex w-full items-center justify-center rounded-3xl border border-zinc-700 bg-zinc-900 px-6 py-3 font-semibold text-stone-200 transition hover:border-white/20 hover:text-white"
              >
                Back to Fair Play
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
