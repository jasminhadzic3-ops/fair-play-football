import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAutomaticSumUpRefundDiagnostics,
  getAutomaticSumUpRefundMode,
} from "@/lib/sumupRefundCapabilities";

function configureProductionRealCandidate() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bpvbkndywnvfvxxzzaes.supabase.co";
  vi.stubEnv("NODE_ENV", "production");
  process.env.SUMUP_API_KEY = "configured-sumup-key";
  process.env.SUMUP_MERCHANT_CODE = "configured-merchant";
  process.env.SUMUP_CURRENCY = "GBP";
  process.env.SUMUP_REAL_REFUNDS_ENABLED = "true";
  delete process.env.E2E_ALLOW_DB_MUTATION;
  delete process.env.E2E_MOCK_SUMUP_REFUNDS;
  delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
  delete process.env.SUMUP_SANDBOX_REFUNDS_ENABLED;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUMUP_API_KEY;
  delete process.env.SUMUP_MERCHANT_CODE;
  delete process.env.SUMUP_CURRENCY;
  delete process.env.SUMUP_REAL_REFUNDS_ENABLED;
  delete process.env.SUMUP_SANDBOX_REFUNDS_ENABLED;
  delete process.env.E2E_ALLOW_DB_MUTATION;
  delete process.env.E2E_MOCK_SUMUP_REFUNDS;
  delete process.env.E2E_MOCK_SUMUP_REFUND_OUTCOME;
});

describe("getAutomaticSumUpRefundMode", () => {
  it("blocks production real mode when sandbox refunds are explicitly enabled", () => {
    configureProductionRealCandidate();
    process.env.SUMUP_SANDBOX_REFUNDS_ENABLED = "true";

    expect(getAutomaticSumUpRefundMode()).toBe("disabled");
  });

  it("allows production real mode when the sandbox flag is the string false", () => {
    configureProductionRealCandidate();
    process.env.SUMUP_SANDBOX_REFUNDS_ENABLED = "false";

    expect(getAutomaticSumUpRefundMode()).toBe("production_real");
  });

  it("allows production real mode when the sandbox flag is unset", () => {
    configureProductionRealCandidate();

    expect(getAutomaticSumUpRefundMode()).toBe("production_real");
    expect(getAutomaticSumUpRefundDiagnostics()).toEqual({
      isProductionProject: true,
      productionRuntime: true,
      realRefundsExplicitlyEnabled: true,
      hasRequiredSumUpRefundConfig: true,
      mockOrTestFlagPresent: false,
      sandboxRefundsExplicitlyEnabled: false,
      mode: "production_real",
    });
  });

  it("keeps production disabled when the real refund flag is false or unset", () => {
    configureProductionRealCandidate();
    process.env.SUMUP_REAL_REFUNDS_ENABLED = "false";

    expect(getAutomaticSumUpRefundMode()).toBe("disabled");

    delete process.env.SUMUP_REAL_REFUNDS_ENABLED;

    expect(getAutomaticSumUpRefundMode()).toBe("disabled");
  });

  it("keeps production disabled for the wrong Supabase project", () => {
    configureProductionRealCandidate();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gtrpegnxhawmkbhyqedh.supabase.co";

    expect(getAutomaticSumUpRefundMode()).toBe("disabled");
  });
});
