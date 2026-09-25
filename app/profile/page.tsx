"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { AUTH_MESSAGES } from "@/lib/authMessages";
import { isBookable } from "@/lib/gameLifecycle";
import {
  hasRequiredPlayerDetails,
  isEmailVerified,
  PENDING_SIGNUP_PROFILE_KEY,
  type PendingSignupProfile,
} from "@/lib/onboarding";
import { supabase } from "@/lib/supabase";
import {
  ACCELERATE_DESCRIPTIONS,
  ACCELERATE_OPTIONS,
  FOOT_RATING_VALUES,
  PLAYER_POSITION_OPTIONS,
  formatFootRating,
  getInitials,
} from "@/lib/playerProfile";

interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  age: string | null;
  gender: string | null;
  favourite_position: string | null;
  secondary_position: string | null;
  left_foot_rating: number | null;
  right_foot_rating: number | null;
  accelerate_type: string | null;
  avatar_url: string | null;
  terms_accepted_at?: string | null;
  terms_version?: string | null;
}

interface NotificationGame {
  id: number;
  title: string;
  location: string;
  time: string | null;
  max_players: number | null;
  status?: string | null;
  starts_at?: string | null;
  archived_at?: string | null;
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

const ageOptions = Array.from({ length: 45 }, (_, index) => String(index + 16));
const genderOptions = ["Male", "Female", "Prefer not to say"];

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

function FootRatingPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{label}</p>
      <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label={`${label} rating`}>
        {FOOT_RATING_VALUES.map((rating) => (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={value === rating}
            aria-label={`${label} ${rating} of 5`}
            onClick={() => onChange(rating)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                event.preventDefault();
                onChange(value === null ? 1 : Math.min(5, value + 1));
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                event.preventDefault();
                onChange(value === null || value <= 1 ? null : value - 1);
              }
            }}
            className="rounded-lg px-1 text-2xl leading-none text-stone-300 transition hover:scale-110 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
          >
            {value !== null && rating <= value ? "★" : "☆"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-2 rounded-full px-3 py-1 text-[11px] font-semibold text-zinc-500 transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
          aria-label={`Clear ${label} rating`}
        >
          Clear
        </button>
      </div>
    </div>
  );
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
  const [secondaryPosition, setSecondaryPosition] = useState("");
  const [leftFootRating, setLeftFootRating] = useState<number | null>(null);
  const [rightFootRating, setRightFootRating] = useState<number | null>(null);
  const [accelerateType, setAccelerateType] = useState("");
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
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [needsPlayerDetails, setNeedsPlayerDetails] = useState(false);
  const isProfileDirty =
    username.trim() !== (profile?.username || "") ||
    age !== (profile?.age || "") ||
    gender !== (profile?.gender || "") ||
    favouritePosition !== (profile?.favourite_position || "") ||
    secondaryPosition !== (profile?.secondary_position || "") ||
    leftFootRating !== (profile?.left_foot_rating ?? null) ||
    rightFootRating !== (profile?.right_foot_rating ?? null) ||
    accelerateType !== (profile?.accelerate_type || "");
  const emailVerified = isEmailVerified(user);
  const displayName: string = profile?.username || username || (user ? getFallbackUsername(user) : "Player");
  const displayEmail = profile?.email || user?.email || "No email found";
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      })
    : "—";
  const profileCompletenessCount = [
    Boolean(profile?.avatar_url),
    Boolean((profile?.username || username).trim()),
    Boolean(age),
    Boolean(gender),
    Boolean(profile?.favourite_position || favouritePosition),
  ].filter(Boolean).length;
  const profileCompletenessPercent = Math.round((profileCompletenessCount / 5) * 100);
  const initials = getInitials(displayName);

  const resetProfileForm = () => {
    setUsername(profile?.username || "");
    setAge(profile?.age || "");
    setGender(profile?.gender || "");
    setFavouritePosition(profile?.favourite_position || "");
    setSecondaryPosition(profile?.secondary_position || "");
    setLeftFootRating(profile?.left_foot_rating ?? null);
    setRightFootRating(profile?.right_foot_rating ?? null);
    setAccelerateType(profile?.accelerate_type || "");
    setIsEditingProfile(false);
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const showTemporaryNotificationMessage = (message: string) => {
    setNotificationMessage(message);
    window.setTimeout(() => setNotificationMessage(null), 5000);
  };

  const requestReferralVerificationReconciliation = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return;
      }

      const response = await fetch("/api/referrals/verification-reconcile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        console.warn("Referral verification reconciliation was not completed.");
      }
    } catch (error) {
      console.warn("Unable to request referral verification reconciliation:", error);
    }
  }, []);

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
        .select("id,title,location,time,max_players,status,starts_at,archived_at")
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
      setSecondaryPosition("");
      setLeftFootRating(null);
      setRightFootRating(null);
      setAccelerateType("");
      setNotifications([]);
      setGamesPlayedCount(0);
      setIsLoading(false);
      return;
    }

    await loadNotifications();
    await fetchGamesPlayedCount(authUser.id);

    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id,email,username,age,gender,favourite_position,secondary_position,left_foot_rating,right_foot_rating,accelerate_type,avatar_url,terms_accepted_at,terms_version")
      .eq("id", authUser.id)
      .maybeSingle();

    if (profileError) {
      console.error("Unable to load player profile:", profileError.message);
      setErrorMessage("We couldn’t load your player profile right now. Please try again.");
      setIsLoading(false);
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const completeProfileFromUrl = searchParams.get("complete_profile") === "1";
    const onboardingSource = searchParams.get("onboarding");
    const isOnboardingVisit =
      completeProfileFromUrl || onboardingSource === "verified" || onboardingSource === "profile";
    const pendingProfileText = localStorage.getItem(PENDING_SIGNUP_PROFILE_KEY);
    let pendingProfile: PendingSignupProfile | null = null;

    if (pendingProfileText) {
      try {
        pendingProfile = JSON.parse(pendingProfileText) as PendingSignupProfile;
      } catch {
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
      }
    }

    const pendingEmail = pendingProfile?.email?.trim().toLowerCase();
    const authEmail = authUser.email?.trim().toLowerCase();

    if (pendingEmail && authEmail && pendingEmail !== authEmail) {
      pendingProfile = null;
      localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
    }

    if (pendingProfile || isOnboardingVisit) {
      const userMetadata = authUser.user_metadata ?? {};
      const preferOnboardingData = onboardingSource === "verified" || onboardingSource === "profile";
      const pendingUsername =
        pendingProfile?.username?.trim() || getStringValue(userMetadata.username).trim();
      const pendingAge = pendingProfile?.age || getStringValue(userMetadata.age);
      const pendingGender = pendingProfile?.gender || getStringValue(userMetadata.gender);
      const pendingFavouritePosition =
        pendingProfile?.favouritePosition ||
        pendingProfile?.favourite_position ||
        getStringValue(userMetadata.favouritePosition) ||
        getStringValue(userMetadata.favourite_position);
      const completedUsername =
        (preferOnboardingData ? pendingUsername : existingProfile?.username) ||
        existingProfile?.username ||
        pendingUsername ||
        getFallbackUsername(authUser);
      const completedAge =
        (preferOnboardingData ? pendingAge : existingProfile?.age) ||
        existingProfile?.age ||
        pendingAge ||
        null;
      const completedGender =
        (preferOnboardingData ? pendingGender : existingProfile?.gender) ||
        existingProfile?.gender ||
        pendingGender ||
        null;
      const completedFavouritePosition =
        (preferOnboardingData ? pendingFavouritePosition : existingProfile?.favourite_position) ||
        existingProfile?.favourite_position ||
        pendingFavouritePosition ||
        null;
      const completedSecondaryPosition =
        existingProfile?.secondary_position ||
        pendingProfile?.secondaryPosition ||
        pendingProfile?.secondary_position ||
        getStringValue(userMetadata.secondaryPosition) ||
        getStringValue(userMetadata.secondary_position) ||
        null;
      const completedAccelerateType =
        existingProfile?.accelerate_type ||
        pendingProfile?.accelerateType ||
        pendingProfile?.accelerate_type ||
        getStringValue(userMetadata.accelerateType) ||
        getStringValue(userMetadata.accelerate_type) ||
        null;
      const completedTermsAcceptedAt =
        existingProfile?.terms_accepted_at ||
        pendingProfile?.terms_accepted_at ||
        getStringValue(userMetadata.terms_accepted_at) ||
        null;
      const completedTermsVersion =
        existingProfile?.terms_version ||
        pendingProfile?.terms_version ||
        getStringValue(userMetadata.terms_version) ||
        null;

      const { data: completedProfile, error: completeError } = await supabase
        .from("profiles")
        .upsert({
          id: authUser.id,
          email: existingProfile?.email || authUser.email || pendingProfile?.email || null,
          username: completedUsername,
          age: completedAge,
          gender: completedGender,
          favourite_position: completedFavouritePosition,
          secondary_position: completedSecondaryPosition,
          left_foot_rating: existingProfile?.left_foot_rating ?? null,
          right_foot_rating: existingProfile?.right_foot_rating ?? null,
          accelerate_type: completedAccelerateType,
          avatar_url: existingProfile?.avatar_url ?? null,
          ...(completedTermsAcceptedAt
            ? { terms_accepted_at: completedTermsAcceptedAt, terms_version: completedTermsVersion }
            : {}),
        })
        .select("id,email,username,age,gender,favourite_position,secondary_position,left_foot_rating,right_foot_rating,accelerate_type,avatar_url,terms_accepted_at,terms_version")
        .single();

      if (completeError) {
        console.error("Unable to complete player profile:", completeError.message);
        setErrorMessage("We couldn’t finish setting up your player profile right now. Please try again.");
        setIsLoading(false);
        return;
      }

      const playerDetailsMissing = !hasRequiredPlayerDetails(completedProfile);

      if (pendingProfile) {
        localStorage.removeItem(PENDING_SIGNUP_PROFILE_KEY);
      }
      if (isOnboardingVisit) {
        const url = new URL(window.location.href);
        url.searchParams.delete("complete_profile");
        url.searchParams.delete("onboarding");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
      if ((completeProfileFromUrl || onboardingSource === "verified") && isEmailVerified(authUser)) {
        void requestReferralVerificationReconciliation();
      }

      setProfile(completedProfile);
      setUsername(completedProfile.username || "");
      setAge(completedProfile.age || "");
      setGender(completedProfile.gender || "");
      setFavouritePosition(completedProfile.favourite_position || "");
      setSecondaryPosition(completedProfile.secondary_position || "");
      setLeftFootRating(completedProfile.left_foot_rating ?? null);
      setRightFootRating(completedProfile.right_foot_rating ?? null);
      setAccelerateType(completedProfile.accelerate_type || "");
      setIsOnboarding(isOnboardingVisit);
      setNeedsPlayerDetails(isOnboardingVisit && playerDetailsMissing);
      if (isOnboardingVisit) {
        setIsEditingProfile(playerDetailsMissing);
        setStatusMessage(
          onboardingSource === "verified"
            ? playerDetailsMissing
              ? "Your email is verified. Complete your player details to continue."
              : "Your email is verified. You’re ready to play."
            : playerDetailsMissing
              ? "Complete your player details to continue."
              : "You’re ready to play."
        );
      }
      setIsLoading(false);
      return;
    }

    if (existingProfile) {
      setProfile(existingProfile);
      setUsername(existingProfile.username || "");
      setAge(existingProfile.age || "");
      setGender(existingProfile.gender || "");
      setFavouritePosition(existingProfile.favourite_position || "");
      setSecondaryPosition(existingProfile.secondary_position || "");
      setLeftFootRating(existingProfile.left_foot_rating ?? null);
      setRightFootRating(existingProfile.right_foot_rating ?? null);
      setAccelerateType(existingProfile.accelerate_type || "");
      setIsOnboarding(false);
      setNeedsPlayerDetails(false);
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
      .select("id,email,username,age,gender,favourite_position,secondary_position,left_foot_rating,right_foot_rating,accelerate_type,avatar_url,terms_accepted_at,terms_version")
      .single();

    if (createError) {
      console.error("Unable to create player profile:", createError.message);
      setErrorMessage("We couldn’t create your player profile right now. Please try again.");
      setIsLoading(false);
      return;
    }

    setProfile(newProfile);
    setUsername(newProfile.username || "");
    setAge(newProfile.age || "");
    setGender(newProfile.gender || "");
    setFavouritePosition(newProfile.favourite_position || "");
    setSecondaryPosition(newProfile.secondary_position || "");
    setLeftFootRating(newProfile.left_foot_rating ?? null);
    setRightFootRating(newProfile.right_foot_rating ?? null);
    setAccelerateType(newProfile.accelerate_type || "");
    setIsOnboarding(false);
    setNeedsPlayerDetails(false);
    setIsLoading(false);
  }, [fetchGamesPlayedCount, loadNotifications, requestReferralVerificationReconciliation]);

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

    if (needsPlayerDetails && !age) {
      setErrorMessage("Choose your age to continue.");
      setStatusMessage(null);
      return;
    }

    if (needsPlayerDetails && !favouritePosition) {
      setErrorMessage("Choose your favourite position to continue.");
      setStatusMessage(null);
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const normalizedSecondaryPosition = secondaryPosition && secondaryPosition !== favouritePosition
      ? secondaryPosition
      : null;

    const { data, error } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        username: trimmedUsername,
        age: age || null,
        gender: gender || null,
        favourite_position: favouritePosition || null,
        secondary_position: normalizedSecondaryPosition,
        left_foot_rating: leftFootRating,
        right_foot_rating: rightFootRating,
        accelerate_type: accelerateType || null,
        avatar_url: profile?.avatar_url ?? null,
      })
      .select("id,email,username,age,gender,favourite_position,secondary_position,left_foot_rating,right_foot_rating,accelerate_type,avatar_url")
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
    setSecondaryPosition(data.secondary_position || "");
    setLeftFootRating(data.left_foot_rating ?? null);
    setRightFootRating(data.right_foot_rating ?? null);
    setAccelerateType(data.accelerate_type || "");
    const completedOnboarding = needsPlayerDetails && hasRequiredPlayerDetails(data);
    setNeedsPlayerDetails(false);
    setStatusMessage(completedOnboarding ? "Your profile is ready. Find a game when you're ready." : "Profile saved.");
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
    const avatarPath = `avatars/${user.id}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-pictures")
      .upload(avatarPath, file, {
        cacheControl: "3600",
        upsert: false,
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
      .select("id,email,username,age,gender,favourite_position,secondary_position,left_foot_rating,right_foot_rating,accelerate_type,avatar_url")
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
      .select("id,max_players,status,starts_at,archived_at")
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

    if (!isBookable(game, { bookingCount: bookingCount ?? 0 })) {
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
    <main className="min-h-screen bg-black p-4 sm:p-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.35em] text-zinc-500">
              Account
            </p>
            <h1 className="text-4xl font-bold md:text-5xl">Player Profile</h1>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-3xl border border-stone-300/20 bg-zinc-950 px-6 text-sm font-bold text-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-stone-200/35 hover:bg-zinc-900 sm:w-auto md:text-base"
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
            {isOnboarding ? (
              <section aria-live="polite" className="rounded-3xl border border-stone-300/20 bg-stone-200/10 px-5 py-5 sm:px-6">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-stone-300">Welcome to Fair Play</p>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
                  {needsPlayerDetails ? "Complete your profile" : "You’re all set"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-100">
                  {needsPlayerDetails
                    ? "Add your age and favourite position to finish setting up your player profile."
                    : emailVerified
                      ? "Your email is verified and your Fair Play account is ready."
                      : "Your Fair Play account is ready."}
                </p>
                {!needsPlayerDetails ? (
                  <Link
                    href="/#games"
                    className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300/20 bg-zinc-950 px-5 text-sm font-bold text-stone-100 transition hover:border-stone-200/35 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                  >
                    Find a game
                  </Link>
                ) : null}
              </section>
            ) : null}

            <div className="rounded-[2rem] border border-stone-200/45 bg-zinc-950 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-5">
                  <label className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center sm:h-28 sm:w-28">
                    <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-stone-300/25 bg-stone-200 text-3xl font-black text-zinc-950 shadow-[0_16px_44px_rgba(214,211,209,0.16)] sm:h-28 sm:w-28">
                      {profile?.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        initials
                      )}
                    </span>
                    <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-950 bg-stone-200 text-sm text-zinc-950 shadow-lg" aria-hidden="true">
                      {isUploadingAvatar ? "…" : "＋"}
                    </span>
                    <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-center text-[0.6rem] font-bold uppercase tracking-[0.16em] text-zinc-400">
                      {isUploadingAvatar ? "Uploading" : profile?.avatar_url ? "Change photo" : "Add photo"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={uploadAvatar}
                      disabled={isUploadingAvatar}
                      className="sr-only"
                    />
                  </label>
                  <div className="min-w-0">
                    <h2 className="max-w-full break-words text-3xl font-black tracking-tight text-white md:text-4xl">
                      {displayName}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="rounded-full border border-stone-300/20 bg-stone-200/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-stone-200">
                        {profile?.favourite_position || favouritePosition || "—"}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        Member since {memberSince}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-zinc-400">
                      {displayEmail}
                    </p>
                  </div>
                </div>
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-36">
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                      Games Played
                    </p>
                    <p className="mt-2 text-4xl font-black text-stone-200">{gamesPlayedCount}</p>
                  </div>
                  {!isEditingProfile ? (
                    <button
                      type="button"
                      onClick={() => {
                        setStatusMessage(null);
                        setErrorMessage(null);
                        setIsEditingProfile(true);
                      }}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300/25 bg-stone-200 px-5 text-sm font-bold text-zinc-950 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-stone-200/50"
                    >
                      Edit profile
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between rounded-3xl border border-stone-200/45 bg-zinc-900 px-5 py-3">
                <p className="text-xs font-bold tracking-[0.12em] text-stone-300">
                  Profile Complete
                </p>
                <p className="text-sm font-black text-stone-100">
                  {profileCompletenessPercent}%
                </p>
              </div>
            </div>

            {!emailVerified ? (
              <div className="rounded-[2rem] border border-stone-300/20 bg-zinc-950 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
                <span className="mb-4 inline-flex rounded-full border border-stone-300/20 bg-stone-200/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-stone-200">
                  Verification Required
                </span>
                <p className="text-sm uppercase tracking-[0.3em] text-stone-400">
                  Verify your email
                </p>
                <p className="mt-3 text-base leading-7 text-stone-100">
                  {AUTH_MESSAGES.verifyEmailProfileBody}
                </p>
                <Link
                  href="/verify-email"
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300/20 bg-stone-200/10 px-5 text-sm font-bold text-stone-100 transition hover:border-stone-200/35 hover:bg-stone-200/15 focus:outline-none focus:ring-2 focus:ring-stone-200/40"
                >
                  Verify email
                </Link>
              </div>
            ) : null}

            <div className="space-y-6 rounded-[2rem] border border-stone-200/45 bg-zinc-900 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    {needsPlayerDetails ? "Player details" : "Personal details"}
                  </p>
                </div>
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
                      {needsPlayerDetails ? "Age *" : "Age"}
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
                      {needsPlayerDetails ? "Favourite position *" : "Favourite position"}
                    </label>
                    <select
                      value={favouritePosition}
                      onChange={(event) => setFavouritePosition(event.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition focus:border-white/30"
                    >
                      <option value="">Select a position</option>
                      {PLAYER_POSITION_OPTIONS.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                      </select>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                      Secondary position
                    </label>
                    <select
                      value={secondaryPosition}
                      onChange={(event) => setSecondaryPosition(event.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition focus:border-white/30"
                    >
                      <option value="">No secondary position</option>
                      {PLAYER_POSITION_OPTIONS.filter((position) => position !== favouritePosition).map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Foot ability</p>
                    <div className="mt-4 grid gap-5 sm:grid-cols-2">
                      <FootRatingPicker label="Left foot" value={leftFootRating} onChange={setLeftFootRating} />
                      <FootRatingPicker label="Right foot" value={rightFootRating} onChange={setRightFootRating} />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                      AcceleRATE type
                    </label>
                    <select
                      value={accelerateType}
                      onChange={(event) => setAccelerateType(event.target.value)}
                      className="mt-2 w-full rounded-3xl border border-zinc-700 bg-zinc-950 px-5 py-4 text-white outline-none transition focus:border-white/30"
                    >
                      <option value="">No movement profile selected</option>
                      {ACCELERATE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    {accelerateType ? (
                      <p className="mt-2 text-sm leading-6 text-zinc-500">
                        {ACCELERATE_DESCRIPTIONS[accelerateType as keyof typeof ACCELERATE_DESCRIPTIONS]}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Display name", value: profile?.username || username || "—" },
                    { label: "Email", value: displayEmail },
                    profile?.age || age ? { label: "Age", value: profile?.age || age } : null,
                    profile?.gender || gender ? { label: "Gender", value: profile?.gender || gender } : null,
                    profile?.favourite_position || favouritePosition
                      ? { label: "Favourite position", value: profile?.favourite_position || favouritePosition }
                      : null,
                    profile?.secondary_position || secondaryPosition
                      ? { label: "Secondary position", value: profile?.secondary_position || secondaryPosition }
                      : null,
                  ].filter((field): field is { label: string; value: string } => Boolean(field)).map((field) => (
                    <div
                      key={field.label}
                      className="flex items-center justify-between gap-4 rounded-3xl border border-stone-200/35 bg-zinc-950 px-5 py-4"
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
                <div aria-live="polite" className="rounded-3xl border border-stone-300/15 bg-zinc-950 p-4 text-sm font-semibold text-stone-200">
                  {statusMessage}
                </div>
              ) : null}

              {profile?.left_foot_rating != null || profile?.right_foot_rating != null || leftFootRating !== null || rightFootRating !== null ? (
                <div className="rounded-[2rem] border border-stone-200/45 bg-zinc-950 p-5 sm:p-6">
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">Foot ability</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200/35 bg-zinc-900 px-4 py-3">
                      <span className="text-sm text-zinc-500">Left</span>
                      <span className="text-lg tracking-[0.18em] text-stone-200">{formatFootRating(profile?.left_foot_rating ?? leftFootRating)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200/35 bg-zinc-900 px-4 py-3">
                      <span className="text-sm text-zinc-500">Right</span>
                      <span className="text-lg tracking-[0.18em] text-stone-200">{formatFootRating(profile?.right_foot_rating ?? rightFootRating)}</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {profile?.accelerate_type || accelerateType ? (
                <div className="rounded-[2rem] border border-stone-200/45 bg-zinc-950 p-5 sm:p-6">
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-stone-400">Movement profile</p>
                  <p className="mt-3 text-xl font-bold tracking-tight text-white">
                    {profile?.accelerate_type || accelerateType}
                  </p>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
                    {ACCELERATE_DESCRIPTIONS[(profile?.accelerate_type || accelerateType) as keyof typeof ACCELERATE_DESCRIPTIONS]}
                  </p>
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
                    {isSaving ? "Saving..." : needsPlayerDetails ? "Save and continue" : "Save Changes"}
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
                          className="w-full rounded-full border border-stone-200/35 bg-stone-200 px-5 py-3 text-sm font-bold text-zinc-950 shadow-[0_10px_28px_rgba(214,211,209,0.18)] transition hover:border-stone-100 hover:bg-stone-100 hover:shadow-[0_12px_34px_rgba(214,211,209,0.24)] sm:w-auto"
                        >
                          Book now
                        </button>
                        {notification.status === "unread" ? (
                          <button
                            type="button"
                            onClick={() => void updateNotificationStatus(notification, "read")}
                            className="w-full rounded-full border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-stone-200/25 hover:bg-zinc-800 sm:w-auto"
                          >
                            Mark as read
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void updateNotificationStatus(notification, "dismissed")}
                          className="w-full rounded-full px-3 py-3 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-900 hover:text-stone-200 sm:w-auto"
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
