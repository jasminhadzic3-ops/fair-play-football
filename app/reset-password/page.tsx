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
        setMessage("Create a new password for your account.");
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
      setMessage("Use at least 8 characters for your new password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("updating");
    setMessage("Updating your password...");

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
    setMessage("Password updated. Sign in with your new password.");
  }

  const canSubmit = status === "ready";

  return (
    <main className="min-h-screen bg-black px-6 py-16 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-lg items-center">
        <section className="w-full rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-zinc-500">
            Password Reset
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
            Secure your account.
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{message}</p>

          {status === "ready" || status === "updating" ? (
            <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="mt-2 w-full rounded-3xl border border-zinc-700 bg-black px-5 py-4 text-white outline-none transition-colors duration-150 ease-out placeholder:text-zinc-600 focus:border-white/30"
                  placeholder="Create password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="mt-2 w-full rounded-3xl border border-zinc-700 bg-black px-5 py-4 text-white outline-none transition-colors duration-150 ease-out placeholder:text-zinc-600 focus:border-white/30"
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={!canSubmit}
                className="mt-2 w-full rounded-3xl border border-stone-200/30 bg-stone-200 px-6 py-4 font-bold text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:border-stone-100 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "updating" ? "Updating..." : "Update password"}
              </button>
            </form>
          ) : null}

          {status === "invalid" ? (
            <div className="mt-6 rounded-3xl border border-rose-500/70 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {invalidResetLinkMessage}
            </div>
          ) : null}

          <Link
            href="/"
            className="mt-6 inline-flex rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-stone-200 transition hover:border-white/20 hover:text-white"
          >
            Back to sign in
          </Link>
        </section>
      </div>
    </main>
  );
}
