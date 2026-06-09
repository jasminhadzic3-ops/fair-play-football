"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  favourite_position: string | null;
}

const positionOptions = [
  "Goalkeeper",
  "Defender",
  "Midfielder",
  "Forward",
  "Winger",
  "Flexible",
];

function getFallbackUsername(user: User) {
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.user_metadata?.display_name ||
    user.email?.split("@")[0] ||
    "Player"
  );
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [favouritePosition, setFavouritePosition] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadOrCreateProfile = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const {
      data: { user: authUser },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(userError.message);
      setIsLoading(false);
      return;
    }

    setUser(authUser ?? null);

    if (!authUser) {
      setProfile(null);
      setUsername("");
      setFavouritePosition("");
      setIsLoading(false);
      return;
    }

    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id,email,username,favourite_position")
      .eq("id", authUser.id)
      .maybeSingle();

    if (profileError) {
      setErrorMessage(profileError.message);
      setIsLoading(false);
      return;
    }

    if (existingProfile) {
      setProfile(existingProfile);
      setUsername(existingProfile.username || "");
      setFavouritePosition(existingProfile.favourite_position || "");
      setIsLoading(false);
      return;
    }

    const fallbackUsername = getFallbackUsername(authUser);
    const { data: newProfile, error: createError } = await supabase
      .from("profiles")
      .insert({
        id: authUser.id,
        email: authUser.email,
        username: fallbackUsername,
      })
      .select("id,email,username,favourite_position")
      .single();

    if (createError) {
      setErrorMessage(createError.message);
      setIsLoading(false);
      return;
    }

    setProfile(newProfile);
    setUsername(newProfile.username || "");
    setFavouritePosition(newProfile.favourite_position || "");
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadOrCreateProfile();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadOrCreateProfile]);

  const saveProfile = async () => {
    if (!user || isSaving) return;

    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setErrorMessage("Please enter a display name.");
      setStatusMessage(null);
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        username: trimmedUsername,
        favourite_position: favouritePosition || null,
      })
      .select("id,email,username,favourite_position")
      .single();

    if (error) {
      setErrorMessage(error.message);
      setIsSaving(false);
      return;
    }

    setProfile(data);
    setUsername(data.username || "");
    setFavouritePosition(data.favourite_position || "");
    setStatusMessage("Profile saved.");
    setIsSaving(false);
  };

  return (
    <main className="min-h-screen bg-black p-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.35em] text-zinc-500">
              Account
            </p>
            <h1 className="text-4xl font-bold md:text-5xl">Player Profile</h1>
          </div>
          <Link
            href="/"
            className="rounded-3xl bg-emerald-500 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 md:text-base"
          >
            Back to Home
          </Link>
        </div>

        {isLoading ? (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            Loading profile...
          </div>
        ) : null}

        {!isLoading && !user ? (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
            Sign in to view and edit your player profile.
          </div>
        ) : null}

        {!isLoading && user ? (
          <div className="space-y-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Email
              </p>
              <p className="mt-2 text-sm font-semibold text-zinc-300">
                {profile?.email || user.email || "No email found"}
              </p>
            </div>

            <div>
              <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Display name
              </label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition focus:border-white/30"
                placeholder="Your display name"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Favourite position
              </label>
              <select
                value={favouritePosition}
                onChange={(event) => setFavouritePosition(event.target.value)}
                className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition focus:border-white/30"
              >
                <option value="">Select a position</option>
                {positionOptions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </div>

            {statusMessage ? (
              <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-200">
                {statusMessage}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-semibold text-red-200">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="button"
              onClick={saveProfile}
              disabled={isSaving}
              className="w-full rounded-3xl bg-emerald-500 px-6 py-4 font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Profile"}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
