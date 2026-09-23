export const PENDING_SIGNUP_PROFILE_KEY = "fairPlayPendingSignupProfile";

export type PendingSignupProfile = {
  username?: string;
  age?: string;
  gender?: string;
  favouritePosition?: string;
  favourite_position?: string;
  email?: string;
  terms_accepted_at?: string;
  terms_version?: string;
  referral_signup_intent_id?: string;
  onboarding_source?: "email" | "google";
};

type VerificationUser = {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

type PlayerProfile = {
  age?: string | null;
  favourite_position?: string | null;
};

export type VerificationIntent = "booking" | "wallet" | "waiting-list";

export function isEmailVerified(user: VerificationUser | null | undefined) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

export function hasRequiredPlayerDetails(profile: PlayerProfile | null | undefined) {
  return Boolean(profile?.age && profile?.favourite_position);
}

export function getEmailConfirmationRedirectUrl(origin: string) {
  return `${origin.replace(/\/$/, "")}/auth/confirm`;
}

export function getEmailVerificationPath(intent?: VerificationIntent) {
  return intent ? `/verify-email?intent=${intent}` : "/verify-email";
}

export function getProfileOnboardingPath(source: "profile" | "verified") {
  return `/profile?onboarding=${source}`;
}