import { supabase } from "@/lib/supabase";

export const REFERRAL_INVALID_MESSAGE =
  "That referral code is not valid. Please check it and try again.";
export const REFERRAL_APPLIED_MESSAGE = "Referral code applied";
export const REFERRAL_SIGNUP_ERROR_MESSAGE =
  "We couldn't apply that referral code. Please check it and try again.";

export function normalizeReferralCode(value: string) {
  return value.trim().toUpperCase();
}

export async function validateReferralCode(value: string) {
  const code = normalizeReferralCode(value);

  if (!code) {
    return { valid: false, code };
  }

  const { data, error } = await supabase.rpc("validate_referral_code", {
    p_code: code,
  });

  if (error) {
    throw error;
  }

  return { valid: data === true, code };
}

export async function createReferralSignupIntent(value: string) {
  const code = normalizeReferralCode(value);

  if (!code) {
    return null;
  }

  const { data, error } = await supabase.rpc("create_referral_signup_intent", {
    p_code: code,
  });

  if (error) {
    throw error;
  }

  if (typeof data !== "string" || !data) {
    throw new Error(REFERRAL_SIGNUP_ERROR_MESSAGE);
  }

  return data;
}
