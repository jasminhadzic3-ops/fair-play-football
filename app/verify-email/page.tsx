"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import {
  getEmailConfirmationRedirectUrl,
  isEmailVerified,
  PENDING_SIGNUP_PROFILE_KEY,
  type PendingSignupProfile,
  type VerificationIntent,
} from "@/lib/onboarding";
import { REFERRAL_PENDING_VERIFICATION_MESSAGE } from "@/lib/referralSignup";
import { supabase } from "@/lib/supabase";

type ResendState = "idle" | "sending" | "sent" | "error";

function getVerificationIntent(value: string | null): VerificationIntent | null {
  return value === "booking" || value === "wallet" || value === "waiting-list" ? value : null;
}

function getVerificationCopy(intent: VerificationIntent | null) {
  if (intent === "booking") {
    return {
      eyebrow: "One final step",
      title: "Verify your email",
      description: "Open the link in your inbox, then return to book your game.",
    };
  }

  if (intent === "wallet") {
    return {
      eyebrow: "One final step",
      title: "Verify your email",
      description: "Open the link in your inbox to access your Fair Play Wallet.",
    };
  }

  if (intent === "waiting-list") {
    return {
      eyebrow: "One final step",
      title: "Verify your email",
      description: "Open the link in your inbox, then return to join the waiting list.",
    };
  }

  return {
    eyebrow: "Account created",
    title: "Check your inbox",
    description: "We’ve sent you a verification link. Open it to finish setting up your Fair Play account.",
  };
}

function readPendingSignupProfile() {
  try {
    const value = localStorage.getItem(PENDING_SIGNUP_PROFILE_KEY);
    return value ? (JSON.parse(value) as PendingSignupProfile) : null;
  } catch {
    return null;
  }
}

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [intent, setIntent] = useState<VerificationIntent | null>(null);
  const [hasPendingReferral, setHasPendingReferral] = useState(false);
  const [linkIssue, setLinkIssue] = useState(false);
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [resendMessage, setResendMessage] = useState("");
  const copy = getVerificationCopy(intent);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const pendingProfile = readPendingSignupProfile();

      setIntent(getVerificationIntent(url.searchParams.get("intent")));
      setLinkIssue(url.searchParams.get("issue") === "link");
      setEmail(pendingProfile?.email?.trim() ?? "");
      setHasPendingReferral(Boolean(pendingProfile?.referral_signup_intent_id));
    }, 0);

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (isEmailVerified(user)) {
        window.location.replace("/");
      }
    })();

    return () => window.clearTimeout(timeout);
  }, []);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setResendState("error");
      setResendMessage("Enter the email address you used to create your account.");
      return;
    }

    setResendState("sending");
    setResendMessage("");

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: {
        emailRedirectTo: getEmailConfirmationRedirectUrl(window.location.origin),
      },
    });

    if (error) {
      setResendState("error");
      setResendMessage("We couldn’t send a new link. Please try again.");
      return;
    }

    setLinkIssue(false);
    setResendState("sent");
    setResendMessage("A new verification link is on its way.");
  }

  return (
    <main className="min-h-[100dvh] bg-black px-4 py-8 text-white sm:px-6 sm:py-16">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl items-center sm:min-h-[calc(100vh-8rem)]">
        <section className="w-full rounded-[2rem] border border-stone-300/15 bg-zinc-950 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:rounded-[2.25rem] sm:p-10">
          <div className="flex items-start justify-between gap-6">
            <p className="pt-1 text-xs font-bold uppercase tracking-[0.35em] text-stone-400">{copy.eyebrow}</p>
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-stone-300/15 bg-stone-200/5 text-stone-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4.5">
                <path d="M4 6.75h16v10.5H4z" />
                <path d="m4.75 7.5 7.25 5 7.25-5" />
              </svg>
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{copy.title}</h1>
          <p className="mt-3 max-w-md text-[15px] leading-7 text-zinc-300">{copy.description}</p>

          {email ? (
            <p className="mt-4 break-words text-sm font-semibold text-stone-200">{email}</p>
          ) : null}

          {hasPendingReferral ? (
            <p className="mt-5 rounded-2xl border border-stone-300/20 bg-stone-200/10 px-4 py-3 text-sm font-semibold leading-6 text-stone-100">
              {REFERRAL_PENDING_VERIFICATION_MESSAGE}
            </p>
          ) : null}

          {linkIssue ? (
            <div role="alert" className="mt-5 rounded-2xl border border-rose-500/25 bg-rose-500/8 px-4 py-3 text-sm leading-6 text-rose-100">
              That link has expired or has already been used. Request a new one below.
            </div>
          ) : null}

          <form className="mt-7" onSubmit={handleResend}>
            {!email ? (
              <div>
                <label htmlFor="verification-email" className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                  Email address
                </label>
                <input
                  id="verification-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-3xl border border-zinc-700 bg-black px-5 py-4 text-white outline-none transition focus:border-stone-200/40 focus:ring-2 focus:ring-stone-200/10"
                />
              </div>
            ) : null}

            <button
              type="submit"
              disabled={resendState === "sending"}
              className="w-full rounded-3xl border border-stone-300/20 bg-zinc-900 px-6 py-4 text-sm font-bold text-stone-100 transition hover:border-stone-200/35 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-stone-200/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resendState === "sending" ? "Sending…" : "Send a new link"}
            </button>
          </form>

          {resendMessage ? (
            <p
              aria-live="polite"
              className={`mt-4 text-sm leading-6 ${resendState === "error" ? "text-rose-200" : "text-stone-300"}`}
            >
              {resendMessage}
            </p>
          ) : null}

          <Link
            href="/"
            className="mt-6 inline-flex text-sm font-semibold text-zinc-400 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
          >
            Back to Fair Play
          </Link>
        </section>
      </div>
    </main>
  );
}
