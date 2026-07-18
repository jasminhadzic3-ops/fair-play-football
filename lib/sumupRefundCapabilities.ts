import "server-only";

export type AutomaticSumUpRefundMode =
  | "disabled"
  | "test_mock"
  | "local_sandbox_real"
  | "production_real";

const testSupabaseRef = "gtrpegnxhawmkbhyqedh";
const productionSupabaseRef = "bpvbkndywnvfvxxzzaes";
const sumUpSandboxMerchantCode = "MY4BGACH";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function hasRequiredSumUpRefundConfig() {
  return Boolean(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE);
}

function hasRequiredSumUpSandboxRefundConfig() {
  return Boolean(
    process.env.SUMUP_API_KEY &&
      process.env.SUMUP_MERCHANT_CODE === sumUpSandboxMerchantCode &&
      process.env.SUMUP_CURRENCY === "GBP"
  );
}

export function getAutomaticSumUpRefundMode(): AutomaticSumUpRefundMode {
  const supabaseUrl = getSupabaseUrl();
  const isTestProject = supabaseUrl.includes(`${testSupabaseRef}.supabase.co`);
  const isProductionProject = supabaseUrl.includes(`${productionSupabaseRef}.supabase.co`);
  const isMutationE2E = process.env.E2E_ALLOW_DB_MUTATION === "true";
  const isMockEnabled = process.env.E2E_MOCK_SUMUP_REFUNDS === "true";

  if (isTestProject && isMutationE2E && isMockEnabled) {
    return "test_mock";
  }

  const productionRuntime = process.env.NODE_ENV === "production";
  const productionVercelEnvironment = process.env.VERCEL_ENV === "production";
  const realRefundsExplicitlyEnabled = process.env.SUMUP_REAL_REFUNDS_ENABLED === "true";
  const sandboxRefundsExplicitlyEnabled = process.env.SUMUP_SANDBOX_REFUNDS_ENABLED === "true";

  if (
    isTestProject &&
    sandboxRefundsExplicitlyEnabled &&
    hasRequiredSumUpSandboxRefundConfig() &&
    !realRefundsExplicitlyEnabled &&
    !productionRuntime &&
    !productionVercelEnvironment
  ) {
    return "local_sandbox_real";
  }

  const mockOrTestFlagPresent = Boolean(
    process.env.E2E_ALLOW_DB_MUTATION ||
      process.env.E2E_MOCK_SUMUP_REFUNDS ||
      process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME ||
      process.env.SUMUP_SANDBOX_REFUNDS_ENABLED
  );

  if (
    isProductionProject &&
    productionRuntime &&
    realRefundsExplicitlyEnabled &&
    hasRequiredSumUpRefundConfig() &&
    !mockOrTestFlagPresent
  ) {
    return "production_real";
  }

  return "disabled";
}

export function getAutomaticSumUpRefundCapabilities() {
  const mode = getAutomaticSumUpRefundMode();

  return {
    automaticSumUpRefundMode: mode,
    automaticSumUpRefundEnabled: mode !== "disabled",
    automaticSumUpRefundMockEnabled: mode === "test_mock",
  };
}
