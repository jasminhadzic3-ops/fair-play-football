import "server-only";

export type AutomaticSumUpRefundMode =
  | "disabled"
  | "test_mock"
  | "local_sandbox_real"
  | "production_real";

export type AutomaticSumUpRefundDiagnostics = {
  isProductionProject: boolean;
  productionRuntime: boolean;
  realRefundsExplicitlyEnabled: boolean;
  hasRequiredSumUpRefundConfig: boolean;
  mockOrTestFlagPresent: boolean;
  sandboxRefundsExplicitlyEnabled: boolean;
  mode: AutomaticSumUpRefundMode;
};

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

function calculateAutomaticSumUpRefundState(): AutomaticSumUpRefundDiagnostics {
  const supabaseUrl = getSupabaseUrl();
  const isTestProject = supabaseUrl.includes(`${testSupabaseRef}.supabase.co`);
  const isProductionProject = supabaseUrl.includes(`${productionSupabaseRef}.supabase.co`);
  const isMutationE2E = process.env.E2E_ALLOW_DB_MUTATION === "true";
  const isMockEnabled = process.env.E2E_MOCK_SUMUP_REFUNDS === "true";
  const productionRuntime = process.env.NODE_ENV === "production";
  const productionVercelEnvironment = process.env.VERCEL_ENV === "production";
  const realRefundsExplicitlyEnabled = process.env.SUMUP_REAL_REFUNDS_ENABLED === "true";
  const sandboxRefundsExplicitlyEnabled = process.env.SUMUP_SANDBOX_REFUNDS_ENABLED === "true";
  const sumUpRefundConfigPresent = hasRequiredSumUpRefundConfig();
  const mockOrTestFlagPresent = Boolean(
    process.env.E2E_ALLOW_DB_MUTATION ||
      process.env.E2E_MOCK_SUMUP_REFUNDS ||
      process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME ||
      sandboxRefundsExplicitlyEnabled
  );

  let mode: AutomaticSumUpRefundMode = "disabled";

  if (isTestProject && isMutationE2E && isMockEnabled) {
    mode = "test_mock";
  }

  if (mode === "disabled" &&
    isTestProject &&
    sandboxRefundsExplicitlyEnabled &&
    hasRequiredSumUpSandboxRefundConfig() &&
    !realRefundsExplicitlyEnabled &&
    !productionRuntime &&
    !productionVercelEnvironment
  ) {
    mode = "local_sandbox_real";
  }

  if (mode === "disabled" &&
    isProductionProject &&
    productionRuntime &&
    realRefundsExplicitlyEnabled &&
    sumUpRefundConfigPresent &&
    !mockOrTestFlagPresent
  ) {
    mode = "production_real";
  }

  return {
    isProductionProject,
    productionRuntime,
    realRefundsExplicitlyEnabled,
    hasRequiredSumUpRefundConfig: sumUpRefundConfigPresent,
    mockOrTestFlagPresent,
    sandboxRefundsExplicitlyEnabled,
    mode,
  };
}

export function getAutomaticSumUpRefundMode(): AutomaticSumUpRefundMode {
  return calculateAutomaticSumUpRefundState().mode;
}

export function getAutomaticSumUpRefundDiagnostics(): AutomaticSumUpRefundDiagnostics {
  return calculateAutomaticSumUpRefundState();
}

export function getAutomaticSumUpRefundCapabilities() {
  const { mode } = calculateAutomaticSumUpRefundState();

  return {
    automaticSumUpRefundMode: mode,
    automaticSumUpRefundEnabled: mode !== "disabled",
    automaticSumUpRefundMockEnabled: mode === "test_mock",
  };
}
