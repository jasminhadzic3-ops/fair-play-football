import "server-only";

export type AutomaticSumUpRefundMode = "disabled" | "test_mock" | "production_real";

const testSupabaseRef = "gtrpegnxhawmkbhyqedh";
const productionSupabaseRef = "bpvbkndywnvfvxxzzaes";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function hasRequiredSumUpRefundConfig() {
  return Boolean(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE);
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

  const mockOrTestFlagPresent = Boolean(
    process.env.E2E_ALLOW_DB_MUTATION ||
      process.env.E2E_MOCK_SUMUP_REFUNDS ||
      process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME
  );
  const realRefundsExplicitlyEnabled = process.env.SUMUP_REAL_REFUNDS_ENABLED === "true";
  const productionRuntime = process.env.NODE_ENV === "production";

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
