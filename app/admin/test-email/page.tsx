"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type TestEmailResponse = {
  success?: boolean;
  error?: string;
};

export default function AdminTestEmailPage() {
  const [recipientEmail, setRecipientEmail] = useState("jasminhadzic3@gmail.com");
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAdminAccess() {
      setIsCheckingAdmin(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        if (!cancelled) {
          setIsAdmin(false);
          setIsCheckingAdmin(false);
        }
        return;
      }

      try {
        const response = await fetch("/api/admin/me", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const result = await response.json().catch(() => null);

        if (!cancelled) {
          setIsAdmin(response.ok && result?.isAdmin === true);
          setIsCheckingAdmin(false);
        }
      } catch {
        if (!cancelled) {
          setIsAdmin(false);
          setIsCheckingAdmin(false);
        }
      }
    }

    void checkAdminAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please sign in as an admin before sending a test email.");
      }

      const response = await fetch("/api/admin/test-email", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recipient_email: recipientEmail }),
      });
      const result = (await response.json().catch(() => null)) as TestEmailResponse | null;

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Unable to send test email.");
      }

      setMessage("Test email sent successfully.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send test email.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-10 text-white">
      <section className="mx-auto max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="mb-6">
          <Link href="/admin" className="text-sm font-semibold text-neutral-300 hover:text-white">
            Back to Admin
          </Link>
          <h1 className="mt-4 text-3xl font-bold">Send Test Email</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            Send one admin-only email to confirm Resend delivery is working.
          </p>
        </div>

        {isCheckingAdmin ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            Checking admin access...
          </p>
        ) : !isAdmin ? (
          <p className="rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-100">
            You must be signed in as an admin to send a test email.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="recipient-email" className="mb-2 block text-sm font-semibold text-neutral-200">
                Recipient email
              </label>
              <input
                id="recipient-email"
                type="email"
                required
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none transition focus:border-white"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-neutral-950 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Sending..." : "Send Test Email"}
            </button>

            {message ? (
              <p className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 p-4 text-sm text-emerald-100">
                {message}
              </p>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-100">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </section>
    </main>
  );
}
