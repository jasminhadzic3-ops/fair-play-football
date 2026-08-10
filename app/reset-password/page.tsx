"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const invalidResetLinkMessage =
  "This reset link is invalid or has expired. Request a new password reset.";

type ResetStatus = "checking" | "ready" | "invalid" | "updating" | "updated";

function cleanResetUrl() {
  if (typeof window === "undefined") {
    return;
  }

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<ResetStatus>("checking");
  const [message, setMessage] = useState("Checking your reset link...");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function validateResetSession() {
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      const searchParams = url.searchParams;
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const recoveryType = hashParams.get("type") || searchParams.get("type");
      const code = searchParams.get("code");

      try {
        if (accessToken && refreshToken) {
          if (recoveryType && recoveryType !== "recovery") {
            throw new Error(invalidResetLinkMessage);
          }

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
        } else {
          throw new Error(invalidResetLinkMessage);
        }

        if (!isMounted) {
          return;
        }

        cleanResetUrl();
        setStatus("ready");
        setMessage("Create a new password for your Fair Play account.");
      } catch {
        if (!isMounted) {
          return;
        }

        cleanResetUrl();
        setStatus("invalid");
        setMessage(invalidResetLinkMessage);
      }
    }

    void validateResetSession();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (status !== "ready") {
      return;
    }

    if (newPassword.length < 8) {
      setMessage("Use at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("The passwords don’t match.");
      return;
    }

    setStatus("updating");
    setMessage("Updating your password…");

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setStatus("invalid");
      setMessage(invalidResetLinkMessage);
      return;
    }

    await supabase.auth.signOut();
    setNewPassword("");
    setConfirmPassword("");
    setStatus("updated");
    setMessage("Your password has been updated. Sign in with your new password.");
  }

  const canSubmit = status === "ready";
  const passwordIsLongEnough = newPassword.length >= 8;
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;

  return (
    <main className="min-h-[100dvh] bg-black px-4 py-8 text-white sm:px-6 sm:py-16">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg items-center sm:min-h-[calc(100vh-8rem)]">
        <section className="w-full rounded-[2rem] border border-zinc-800 bg-zinc-950 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] sm:p-8">
          {status === "updated" ? (
            <div aria-live="polite">
              <div className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-emerald-200">
                Password updated
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight text-white">
                Your Password Has Been Updated
              </h1>
              <p className="mt-3 text-sm leading-6 text-zinc-300">Your new password is ready to use.</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                You can now sign in to your Fair Play Football account.
              </p>
              <Link
                href="/?sign_in=1"
                className="mt-7 inline-flex w-full items-center justify-center rounded-3xl border border-stone-200/30 bg-stone-200 px-6 py-4 font-bold text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
              >
                Sign In
              </Link>
            </div>
          ) : status === "invalid" ? (
            <div>
              <div className="inline-flex rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-rose-200">
                Reset link expired
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight text-white">This Link Is No Longer Valid</h1>
              <p role="alert" className="mt-3 text-sm leading-6 text-zinc-300">
                For your security, password reset links expire after a limited time.
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Request a new link to continue.</p>
              <Link
                href="/?forgot_password=1"
                className="mt-7 inline-flex w-full items-center justify-center rounded-3xl border border-stone-200/30 bg-stone-200 px-6 py-4 font-bold text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50"
              >
                Request New Reset Link
              </Link>
              <Link
                href="/?sign_in=1"
                className="mt-3 inline-flex w-full items-center justify-center rounded-3xl border border-zinc-700 bg-zinc-900 px-6 py-3 font-semibold text-stone-200 transition hover:border-white/20 hover:text-white"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.35em] text-zinc-500">Password Reset</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white">Create a New Password</h1>
              <p aria-live="polite" className="mt-3 text-sm leading-6 text-zinc-400">{message}</p>

              {status === "ready" || status === "updating" ? (
                <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
                  <div>
                    <label htmlFor="new-password" className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                      New password
                    </label>
                    <div className="relative mt-2">
                      <input
                        id="new-password"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        className="w-full rounded-3xl border border-zinc-700 bg-black px-5 py-4 pr-20 text-white outline-none transition focus:border-stone-200/40 focus:ring-2 focus:ring-stone-200/10"
                        placeholder="Create your new password"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((current) => !current)}
                        aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400 hover:text-white"
                      >
                        {showNewPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="confirm-new-password" className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                      Confirm new password
                    </label>
                    <div className="relative mt-2">
                      <input
                        id="confirm-new-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="w-full rounded-3xl border border-zinc-700 bg-black px-5 py-4 pr-20 text-white outline-none transition focus:border-stone-200/40 focus:ring-2 focus:ring-stone-200/10"
                        placeholder="Enter your new password again"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((current) => !current)}
                        aria-label={showConfirmPassword ? "Hide confirmed password" : "Show confirmed password"}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400 hover:text-white"
                      >
                        {showConfirmPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Password requirements</p>
                    <div className="mt-3 grid gap-2">
                      <p className={passwordIsLongEnough ? "text-emerald-200" : "text-zinc-400"}>
                        {passwordIsLongEnough ? "✓" : "○"} At least 8 characters
                      </p>
                      <p className={passwordsMatch ? "text-emerald-200" : "text-zinc-400"}>
                        {passwordsMatch ? "✓" : "○"} Passwords match
                      </p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="mt-2 w-full rounded-3xl border border-stone-200/30 bg-stone-200 px-6 py-4 font-bold text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-200/50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "updating" ? "Updating…" : "Update Password"}
                  </button>
                </form>
              ) : null}

              {status === "checking" ? (
                <div className="mt-6 rounded-3xl border border-zinc-800 bg-black/50 px-4 py-4 text-sm text-zinc-400">
                  Verifying your secure reset link…
                </div>
              ) : null}

              <Link
                href="/?sign_in=1"
                className="mt-6 inline-flex rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-stone-200 transition hover:border-white/20 hover:text-white"
              >
                Back to Sign In
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
