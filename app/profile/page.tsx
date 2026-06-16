"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  age: string | null;
  gender: string | null;
  favourite_position: string | null;
  avatar_url: string | null;
}

type PendingSignupProfile = {
  username?: string;
  age?: string;
  gender?: string;
  favouritePosition?: string;
  favourite_position?: string;
  email?: string;
};

interface NotificationGame {
  id: number;
  title: string;
  location: string;
  time: string | null;
  max_players: number | null;
  is_full?: boolean;
}

interface WaitingListNotification {
  id: number;
  game_id: number;
  player_name: string | null;
  status: string | null;
  message: string | null;
  created_at: string | null;
  read_at: string | null;
  game?: NotificationGame;
}

const positionOptions = [
  "Goalkeeper",
  "Defender",
  "Midfielder",
  "Forward",
  "Winger",
  "Flexible",
];
const ageOptions = Array.from({ length: 45 }, (_, index) => String(index + 16));
const genderOptions = ["Male", "Female", "Prefer not to say"];
const PENDING_SIGNUP_PROFILE_KEY = "fairPlayPendingSignupProfile";

function getFallbackUsername(user: User) {
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.user_metadata?.display_name ||
    user.email?.split("@")[0] ||
    "Player"
  );
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function formatNotificationDate(dateValue: string | null) {
  if (!dateValue) {
    return "";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [favouritePosition, setFavouritePosition] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [gamesPlayedCount, setGamesPlayedCount] = useState(0);
  const [notifications, setNotifications] = useState<WaitingListNotification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const isProfileDirty =
    username.trim() !== (profile?.username || "") ||
    age !== (profile?.age || "") ||
    gender !== (profile?.gender || "") ||
    favouritePosition !== (profile?.favourite_position || "");
  const isEmailVerified = Boolean(user?.email_confirmed_at || user?.confirmed_at);
  const displayName: string = profile?.username || username || (user ? getFallbackUsername(user) : "Player");
  const displayEmail = profile?.email || user?.email || "No email found";
  const profileCompletenessCount = [
    Boolean(profile?.avatar_url),
    Boolean((profile?.username || username).trim()),
    Boolean(age),
    Boolean(gender),
    Boolean(profile?.favourite_position || favouritePosition),
  ].filter(Boolean).length;
  const profileCompletenessPercent = Math.round((profileCompletenessCount / 5) * 100);
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("") || "FP";

  const resetProfileForm = () => {
    setUsername(profile?.username || "");
    setAge(profile?.age || "");
    setGender(profile?.gender || "");
    setFavouritePosition(profile?.favourite_position || "");
    setIsEditingProfile(false);
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const showTemporaryNotificationMessage = (message: string) => {
    setNotificationMessage(message);
    window.setTimeout(() => setNotificationMessage(null), 5000);
  };

  const getAvatarExtension = (file: File) => {
    const mimeExtension = file.type.split("/")[1]?.toLowerCase();

    if (mimeExtension === "jpeg") {
      return "jpg";
    }

    return mimeExtension || file.name.split(".").pop()?.toLowerCase() || "jpg";
  };

  const fetchGamesPlayedCount = useCallback(async (userId: string) => {
    const { count, error } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) {
      console.error("Unable to load games played:", error.message);
      setGamesPlayedCount(0);
      return;
    }

    setGamesPlayedCount(count ?? 0);
  }, []);

  const loadNotifications = useCallback(async () => {
    setIsLoadingNotifications(true);

    const { data: notificationRows, error: notificationError } = await supabase
      .from("waiting_list_notifications")
      .select("id,game_id,player_name,status,message,created_at,read_at")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(20);

    if (notificationError) {
      setErrorMessage(notificationError.message);
      setNotifications([]);
      setIsLoadingNotifications(false);
      return;
    }

    const rows = (notificationRows ?? []) as WaitingListNotification[];
    const gameIds = Array.from(new Set(rows.map((notification) => notification.game_id)));
    let gamesById = new Map<number, NotificationGame>();

    if (gameIds.length > 0) {
      const { data: games, error: gamesError } = await supabase
        .from("games")
        .select("id,title,location,time,max_players")
        .in("id", gameIds);

      if (gamesError) {
        setErrorMessage(gamesError.message);
      } else {
        const { data: bookings, error: bookingsError } = await supabase
          .from("bookings")
          .select("game_id")
          .in("game_id", gameIds);

        if (bookingsError) {
          setErrorMessage(bookingsError.message);
        }

        const bookingCountsByGameId = new Map<number, number>();

        for (const booking of (bookings ?? []) as Array<{ game_id: number }>) {
          bookingCountsByGameId.set(
            booking.game_id,
            (bookingCountsByGameId.get(booking.game_id) ?? 0) + 1
          );
        }

        gamesById = new Map(
          ((games ?? []) as NotificationGame[]).map((game) => [
            game.id,
            {
              ...game,
              is_full:
                typeof game.max_players === "number"
                  ? (bookingCountsByGameId.get(game.id) ?? 0) >= game.max_players
                  : false,
            },
          ])
        );
      }
    }

    setNotifications(
      rows.map((notification) => ({
        ...notification,
        game: gamesById.get(notification.game_id),
      }))
    );
    setIsLoadingNotifications(false);
  }, []);

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
      setAge("");
      setGender("");
      setFavouritePosition("");
      setNotifications([]);
      setGamesPlayedCount(0);
      setIsLoading(false);
      return;
    }

    await loadNotifications();
    await fetchGamesPlayedCount(authUser.id);

    const completeProfileFromUrl = new URLSearchParams(window.location.search).get("complete_profile") === "1";
    const pendingProfileText = localStorage.getItem(PENDING_SIGNUP_PROFILE_KEY);

    if (pendingProfileText || completeProfileFromUrl) {
      try {
        const pendingProfile = pendingProfileText
          ? (JSON.parse(pendingProfileText) as PendingSignupProfile)
          : {};
        const userMetadata = authUser.user_metadata ?? {};
        const pendingEmail = pendingProfile.email?.trim().toLowerCase();
        const authEmail = authUser.email?.trim().toLowerCase();

        if (pendingEmail && authEmail && pendingEmail !== authEmail) {
          throw new Error("Pending profile belongs to another email.");
        }

        const completedUsername =
          pendingProfile.username?.trim() ||
          getStringValue(userMetadata.username).trim() ||
          getFallbackUsername(authUser);
        const completedAge = pendingProfile.age || getStringValue(userMetadata.age) || null;
        const completedGender = pendingProfile.gender || getStringValue(userMetadata.gender) || null;
        const completedFavouritePosition =
          pendingProfile.favouritePosition ||
          pendingProfile.favourite_position ||
          getStringValue(userMetadata.favouritePosition) ||
          getStringValue(userMetadata.favourite_position) ||
          null;

        const { data: completedProfile, error: completeError } = await supabase
          .from("profiles")
          .upsert({
            id: authUser.id,
            email: authUser.email || pendingProfile.email || null,
            username: completedUsername,
            age: completedAge,
            gender: completedGender,
            favourite_position: completedFavouritePosition,
          })
          .select("id,email,username,age,gender,favourite_position,avatar_url")
          .single();

        if (completeError) {
          setErrorMessage(completeError.message);
          setIsLoading(false);
          return;
        }

        if (pendingProfileText) {
          localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
        }
        if (completeProfileFromUrl) {
          const url = new URL(window.location.href);
          url.searchParams.delete("complete_profile");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        }
        setProfile(completedProfile);
        setUsername(completedProfile.username || "");
        setAge(completedProfile.age || "");
        setGender(completedProfile.gender || "");
        setFavouritePosition(completedProfile.favourite_position || "");
        setStatusMessage("Profile completed. Please check your details.");
        setIsLoading(false);
        return;
      } catch {
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
      }
    }

    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id,email,username,age,gender,favourite_position,avatar_url")
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
      setAge(existingProfile.age || "");
      setGender(existingProfile.gender || "");
      setFavouritePosition(existingProfile.favourite_position || "");
      if (completeProfileFromUrl) {
        setStatusMessage("Profile completed. Please check your details.");
      }
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
      .select("id,email,username,age,gender,favourite_position,avatar_url")
      .single();

    if (createError) {
      setErrorMessage(createError.message);
      setIsLoading(false);
      return;
    }

    setProfile(newProfile);
    setUsername(newProfile.username || "");
    setAge(newProfile.age || "");
    setGender(newProfile.gender || "");
    setFavouritePosition(newProfile.favourite_position || "");
    if (completeProfileFromUrl) {
      setStatusMessage("Profile completed. Please check your details.");
    }
    setIsLoading(false);
  }, [fetchGamesPlayedCount, loadNotifications]);

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
        age: age || null,
        gender: gender || null,
        favourite_position: favouritePosition || null,
        avatar_url: profile?.avatar_url ?? null,
      })
      .select("id,email,username,age,gender,favourite_position,avatar_url")
      .single();

    if (error) {
      setErrorMessage(error.message);
      setIsSaving(false);
      return;
    }

    setProfile(data);
    setUsername(data.username || "");
    setAge(data.age || "");
    setGender(data.gender || "");
    setFavouritePosition(data.favourite_position || "");
    setStatusMessage("Profile saved.");
    setIsEditingProfile(false);
    setIsSaving(false);
  };

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!user) {
      setErrorMessage("Please sign in before uploading a profile picture.");
      setStatusMessage(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please choose an image file.");
      setStatusMessage(null);
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("Profile picture must be 2MB or smaller.");
      setStatusMessage(null);
      return;
    }

    setIsUploadingAvatar(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const extension = getAvatarExtension(file);
    const avatarPath = `avatars/${user.id}/profile.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-pictures")
      .upload(avatarPath, file, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      setErrorMessage(uploadError.message);
      setIsUploadingAvatar(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("profile-pictures").getPublicUrl(avatarPath);

    const { data, error } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", user.id)
      .select("id,email,username,age,gender,favourite_position,avatar_url")
      .single();

    if (error) {
      setErrorMessage(error.message);
      setIsUploadingAvatar(false);
      return;
    }

    setProfile(data);
    setStatusMessage("Profile picture updated.");
    setIsUploadingAvatar(false);
  };

  const updateNotificationStatus = async (
    notification: WaitingListNotification,
    status: "read" | "dismissed"
  ) => {
    setStatusMessage(null);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("waiting_list_notifications")
      .update({
        status,
        read_at: status === "read" ? new Date().toISOString() : notification.read_at ?? new Date().toISOString(),
      })
      .eq("id", notification.id)
      .select("id,game_id,player_name,status,message,created_at,read_at")
      .single();

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (status === "dismissed") {
      setNotifications((currentNotifications) =>
        currentNotifications.filter((currentNotification) => currentNotification.id !== notification.id)
      );
      return;
    }

    setNotifications((currentNotifications) =>
      currentNotifications.map((currentNotification) =>
        currentNotification.id === notification.id
          ? {
              ...currentNotification,
              ...data,
              game: currentNotification.game,
            }
          : currentNotification
      )
    );
  };

  const bookNowFromNotification = async (notification: WaitingListNotification) => {
    setNotificationMessage(null);
    setErrorMessage(null);

    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id,max_players")
      .eq("id", notification.game_id)
      .maybeSingle();

    if (gameError) {
      setErrorMessage(gameError.message);
      return;
    }

    if (!game) {
      showTemporaryNotificationMessage("This spot has already been taken.");
      return;
    }

    const { count: bookingCount, error: bookingCountError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("game_id", notification.game_id);

    if (bookingCountError) {
      setErrorMessage(bookingCountError.message);
      return;
    }

    if ((bookingCount ?? 0) >= game.max_players) {
      showTemporaryNotificationMessage("This spot has already been taken.");
      return;
    }

    localStorage.removeItem("pendingJoinGameId");
    localStorage.removeItem("pendingSumUpGameId");
    localStorage.removeItem("pendingSumUpCheckoutId");
    localStorage.removeItem("pendingSumUpCheckoutReference");
    window.location.href = `/?open_game_id=${encodeURIComponent(String(notification.game_id))}#games`;
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
            className="rounded-3xl border border-stone-300/20 bg-zinc-950 px-6 py-3 text-sm font-bold text-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-stone-200/35 hover:bg-zinc-900 md:text-base"
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
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-5">
                  <label className="group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-stone-300/25 bg-stone-200 text-2xl font-black text-zinc-950 shadow-[0_16px_44px_rgba(214,211,209,0.16)]">
                    {profile?.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/60 px-2 text-center text-[0.6rem] font-bold uppercase tracking-[0.16em] text-white opacity-0 transition group-hover:opacity-100">
                      {isUploadingAvatar ? "Uploading" : "Upload"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={uploadAvatar}
                      disabled={isUploadingAvatar}
                      className="sr-only"
                    />
                  </label>
                  <div>
                    <h2 className="max-w-full break-words text-3xl font-black tracking-tight text-white md:text-4xl">
                      {displayName}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="rounded-full border border-stone-300/20 bg-stone-200/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-stone-200">
                        {profile?.favourite_position || favouritePosition || "—"}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        Member since{" "}
                        {user.created_at
                          ? new Date(user.created_at).toLocaleDateString("en-GB", {
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-zinc-400">
                      {displayEmail}
                    </p>
                  </div>
                </div>
                <div className="w-full rounded-3xl border border-zinc-800 bg-zinc-900 px-5 py-4 sm:w-auto sm:min-w-36">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                    Games Played
                  </p>
                  <p className="mt-2 text-4xl font-black text-stone-200">{gamesPlayedCount}</p>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between rounded-3xl border border-stone-300/15 bg-zinc-900 px-5 py-3">
                <p className="text-xs font-bold tracking-[0.12em] text-stone-300">
                  Profile Complete
                </p>
                <p className="text-sm font-black text-stone-100">
                  {profileCompletenessPercent}%
                </p>
              </div>
            </div>

            {!isEmailVerified ? (
              <div className="rounded-[2rem] border border-stone-300/20 bg-zinc-950 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
                <span className="mb-4 inline-flex rounded-full border border-stone-300/20 bg-stone-200/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-stone-200">
                  Verification Required
                </span>
                <p className="text-sm uppercase tracking-[0.3em] text-stone-400">
                  Verify your email
                </p>
                <p className="mt-3 text-base leading-7 text-stone-100">
                  Please verify your email before joining games, making payments or using the waiting list. Check your inbox and click the verification link we sent you.
                </p>
              </div>
            ) : null}

            <div className="space-y-6 rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Personal details
                  </p>
                </div>
                {!isEditingProfile ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusMessage(null);
                      setErrorMessage(null);
                      setIsEditingProfile(true);
                    }}
                    className="rounded-full border border-stone-300/20 bg-zinc-950 px-5 py-2 text-sm font-bold text-stone-200 transition hover:border-stone-200/35 hover:bg-zinc-800"
                  >
                    Edit Profile
                  </button>
                ) : null}
              </div>

              {isEditingProfile ? (
                <div className="grid gap-4">
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
                      Age
                    </label>
                    <select
                      value={age}
                      onChange={(event) => setAge(event.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition focus:border-white/30"
                    >
                      <option value="">Select age</option>
                      {ageOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                      Gender
                    </label>
                    <select
                      value={gender}
                      onChange={(event) => setGender(event.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition focus:border-white/30"
                    >
                      <option value="">Select gender</option>
                      {genderOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
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
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Display name", value: profile?.username || username || "—" },
                    { label: "Email", value: displayEmail },
                    { label: "Age", value: profile?.age || age || "—" },
                    { label: "Gender", value: profile?.gender || gender || "—" },
                    { label: "Favourite position", value: profile?.favourite_position || favouritePosition || "—" },
                  ].map((field) => (
                    <div
                      key={field.label}
                      className="flex items-center justify-between gap-4 rounded-3xl border border-zinc-800 bg-zinc-950 px-5 py-4"
                    >
                      <p className="shrink-0 text-xs uppercase tracking-[0.25em] text-zinc-500">
                        {field.label}
                      </p>
                      <p className="min-w-0 break-words text-right text-sm font-semibold text-white">
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {statusMessage ? (
                <div className="rounded-3xl border border-stone-300/15 bg-zinc-950 p-4 text-sm font-semibold text-stone-200">
                  {statusMessage}
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-3xl border border-stone-300/20 bg-zinc-950 p-4 text-sm font-semibold text-stone-300">
                  {errorMessage}
                </div>
              ) : null}

              {isEditingProfile ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isProfileDirty) {
                        void saveProfile();
                      }
                    }}
                    disabled={isSaving || !isProfileDirty}
                    className="rounded-3xl border border-stone-200/30 bg-stone-200 px-6 py-4 font-bold text-zinc-950 shadow-[0_12px_34px_rgba(214,211,209,0.16)] transition hover:border-stone-100 hover:bg-stone-100 hover:shadow-[0_14px_40px_rgba(214,211,209,0.22)] disabled:cursor-default disabled:opacity-60"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={resetProfileForm}
                    disabled={isSaving}
                    className="rounded-3xl border border-zinc-700 bg-zinc-950 px-6 py-4 font-bold text-white transition hover:border-white/20 disabled:cursor-default disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    Waiting list
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white">Notifications</h2>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm text-zinc-400">
                  {notifications.filter((notification) => notification.status === "unread").length} unread
                </span>
              </div>

              {isLoadingNotifications ? (
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
                  Loading notifications...
                </div>
              ) : null}

              {notificationMessage ? (
                <div className="mb-3 rounded-3xl border border-stone-300/15 bg-zinc-950 px-5 py-4 text-sm font-semibold text-stone-200">
                  {notificationMessage}
                </div>
              ) : null}

              {!isLoadingNotifications && notifications.length === 0 ? (
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
                  No waiting-list notifications yet.
                </div>
              ) : null}

              {!isLoadingNotifications && notifications.length > 0 ? (
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-4 shadow-[0_14px_44px_rgba(0,0,0,0.24)] transition hover:border-stone-200/20 sm:p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-full border border-stone-300/15 bg-stone-200/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-stone-200">
                          {notification.status === "read" ? "✓ Read" : "● Unread"}
                        </span>
                        {notification.created_at ? (
                          <span className="text-xs font-semibold text-zinc-500">
                            {formatNotificationDate(notification.created_at)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-4 text-base font-bold tracking-tight text-white">
                        {notification.game?.title || "Game update"}
                      </p>
                      {notification.game ? (
                        <p className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-300">
                          {notification.game.time || "TBD"} • {notification.game.location}
                        </p>
                      ) : null}
                      <p className="mt-3 text-sm leading-6 text-zinc-400">
                        A space may be available for this game. Book now to try for the spot. Spots are first paid, first served.
                      </p>

                      <div className="mt-4 flex w-full flex-col gap-2 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center">
                        <button
                          type="button"
                          onClick={() => void bookNowFromNotification(notification)}
                          className="w-full rounded-full border border-stone-200/35 bg-stone-200 px-5 py-2.5 text-sm font-bold text-zinc-950 shadow-[0_10px_28px_rgba(214,211,209,0.18)] transition hover:border-stone-100 hover:bg-stone-100 hover:shadow-[0_12px_34px_rgba(214,211,209,0.24)] sm:w-auto"
                        >
                          Book now
                        </button>
                        {notification.status === "unread" ? (
                          <button
                            type="button"
                            onClick={() => void updateNotificationStatus(notification, "read")}
                            className="w-full rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-stone-200/25 hover:bg-zinc-800 sm:w-auto"
                          >
                            Mark as read
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void updateNotificationStatus(notification, "dismissed")}
                          className="w-full rounded-full px-3 py-2.5 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-900 hover:text-stone-200 sm:w-auto"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
