import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGREEMENT_VERSION, SIGNUP_AGREEMENT_LABEL } from "@/lib/signupAgreement";
import { createE2ESupabaseClient } from "./helpers/moneySeed";
import { requireDatabaseMutationE2EEnv } from "./helpers/supabaseEnv";

type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

function uniqueRunId() {
  return `e2esignup${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueEmail(suffix = "") {
  return `${uniqueRunId()}${suffix.replace(/[^a-z0-9]/gi, "")}@example.com`;
}

async function openSignupModal(page: Page) {
  await page.goto("/");

  const navbar = page.getByRole("navigation");
  await navbar.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in or create account" })).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).first().click();
  await expect(page.getByPlaceholder("Create password")).toBeVisible();
}

async function fillSignupForm(page: Page, params: { email: string; password: string }) {
  await page.getByPlaceholder("you@example.com").fill(params.email);
  await page.getByPlaceholder("Create password").fill(params.password);
  await page.getByPlaceholder("Confirm password").fill(params.password);
  await page
    .getByRole("combobox")
    .filter({ has: page.getByRole("option", { name: "20" }) })
    .selectOption("20");
  await page
    .getByRole("combobox")
    .filter({ has: page.getByRole("option", { name: "Midfielder" }) })
    .selectOption("Midfielder");
}

async function findAuthUserByEmail(supabase: SupabaseClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });

    if (error) {
      throw new Error(`list auth users: ${error.message}`);
    }

    const user = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email.trim().toLowerCase()
    );

    if (user) {
      return user as AuthUser;
    }

    if (data.users.length < 100) {
      return null;
    }
  }

  return null;
}

async function cleanupSignupUser(supabase: SupabaseClient, email: string, knownUserId?: string | null) {
  const user = knownUserId ? { id: knownUserId } : await findAuthUserByEmail(supabase, email);

  if (!user?.id) {
    return;
  }

  const profileDelete = await supabase.from("profiles").delete().eq("id", user.id);

  if (profileDelete.error) {
    throw new Error(`delete signup profile: ${profileDelete.error.message}`);
  }

  const { error } = await supabase.auth.admin.deleteUser(user.id);

  if (error) {
    throw new Error(`delete signup auth user: ${error.message}`);
  }
}

test.describe("signup agreement", () => {
  test("blocks email signup when agreement is unticked and opens legal links", async ({
    context,
    page,
  }) => {
    requireDatabaseMutationE2EEnv();
    await openSignupModal(page);

    await expect(page.getByRole("checkbox", { name: SIGNUP_AGREEMENT_LABEL })).not.toBeChecked();
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "/terms"
    );
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "target",
      "_blank"
    );
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy"
    );

    const [termsPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "Terms of Service" }).click(),
    ]);
    await expect(termsPage.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
    await termsPage.close();

    await fillSignupForm(page, {
      email: uniqueEmail("_blocked"),
      password: "Password-signup-blocked",
    });
    await page.getByRole("button", { name: "Create account" }).last().click();
    await expect(
      page.getByText("Please accept the Terms of Service and Privacy Policy to create an account.")
    ).toBeVisible();
  });

  test("blocks Google signup initiated from signup mode when agreement is unticked", async ({
    page,
  }) => {
    requireDatabaseMutationE2EEnv();
    await openSignupModal(page);

    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(
      page.getByText("Please accept the Terms of Service and Privacy Policy to create an account.")
    ).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("allows checked email signup to submit agreement metadata without sending an email", async ({
    page,
  }) => {
    requireDatabaseMutationE2EEnv();
    const runId = uniqueRunId();
    const email = `${runId}@example.com`;
    const password = `Password-${runId}`;
    let signupPayload: Record<string, unknown> | null = null;

    await page.route(/\/auth\/v1\/signup/, async (route) => {
      signupPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "00000000-0000-0000-0000-000000000000",
            email,
            user_metadata: signupPayload?.data ?? {},
          },
          session: null,
        }),
      });
    });

    await openSignupModal(page);
    await fillSignupForm(page, { email, password });
    await page.getByRole("checkbox", { name: SIGNUP_AGREEMENT_LABEL }).check();
    await page.getByRole("button", { name: "Create account" }).last().click();

    await expect.poll(() => signupPayload).not.toBeNull();
    const capturedSignupPayload = signupPayload as unknown as Record<string, unknown>;
    const capturedSignupData = capturedSignupPayload.data as Record<string, unknown>;

    expect(capturedSignupPayload.email).toBe(email);
    expect(capturedSignupData.terms_version).toBe(AGREEMENT_VERSION);
    expect(typeof capturedSignupData.terms_accepted_at).toBe("string");
    await expect(page.getByText("Almost there. Check your email to activate your account.")).toBeVisible();
  });

  test("profile completion after email verification stores agreement fields", async ({ page }) => {
    const env = requireDatabaseMutationE2EEnv();
    const supabase = createE2ESupabaseClient(env);
    const runId = uniqueRunId();
    const email = `${runId}complete@example.com`;
    const password = `Password-${runId}`;
    const termsAcceptedAt = new Date().toISOString();
    let userId: string | null = null;

    try {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: `Verified ${runId}`,
          age: "20",
          favourite_position: "Midfielder",
          terms_accepted_at: termsAcceptedAt,
          terms_version: AGREEMENT_VERSION,
        },
      });

      if (authError || !authData.user) {
        throw new Error(`create verified signup user: ${authError?.message || "no user returned"}`);
      }

      userId = authData.user.id;

      await page.goto("/");
      await page.getByRole("navigation").getByRole("button", { name: "Sign in" }).click();
      await page.getByPlaceholder("you@example.com").fill(email);
      await page.getByPlaceholder("Enter your password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).last().click();
      await expect(page.getByRole("link", { name: "Wallet" })).toBeVisible();
      await page.goto("/profile?complete_profile=1");

      await expect
        .poll(async () => {
          const { data } = await supabase
            .from("profiles")
            .select("terms_accepted_at,terms_version")
            .eq("id", userId)
            .maybeSingle();

          return data
            ? {
                terms_accepted_at: data.terms_accepted_at
                  ? new Date(data.terms_accepted_at).toISOString()
                  : null,
                terms_version: data.terms_version,
              }
            : null;
        })
        .toMatchObject({
          terms_accepted_at: termsAcceptedAt,
          terms_version: AGREEMENT_VERSION,
        });
    } finally {
      await cleanupSignupUser(supabase, email, userId);
    }
  });

  test("existing confirmed users with null agreement fields can sign in", async ({ page }) => {
    const env = requireDatabaseMutationE2EEnv();
    const supabase = createE2ESupabaseClient(env);
    const runId = uniqueRunId();
    const email = `${runId}_existing@example.com`;
    const password = `Password-${runId}`;
    let userId: string | null = null;

    try {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username: `Existing ${runId}` },
      });

      if (authError || !authData.user) {
        throw new Error(`create existing user: ${authError?.message || "no user returned"}`);
      }

      userId = authData.user.id;

      const { error: profileError } = await supabase.from("profiles").insert({
        id: userId,
        email,
        username: `Existing ${runId}`,
        terms_accepted_at: null,
        terms_version: null,
      });

      if (profileError) {
        throw new Error(`insert existing user profile: ${profileError.message}`);
      }

      await page.goto("/");
      await page.getByRole("navigation").getByRole("button", { name: "Sign in" }).click();
      await page.getByPlaceholder("you@example.com").fill(email);
      await page.getByPlaceholder("Enter your password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).last().click();

      await expect(page.getByRole("link", { name: "Wallet" })).toBeVisible();
    } finally {
      await cleanupSignupUser(supabase, email, userId);
    }
  });
});
