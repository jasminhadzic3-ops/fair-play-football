import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:3000" });

test("desktop navbar keeps public navigation centred and account links hidden when signed out", async ({
  page,
}) => {
  await page.goto("/");

  const navbar = page.getByRole("navigation").first();

  await expect(navbar.getByRole("link", { name: "FAIR PLAY" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "Games" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "About" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "My Bookings" })).toHaveCount(0);
  await expect(navbar.getByRole("link", { name: "Wallet" })).toHaveCount(0);
  await expect(navbar.getByRole("link", { name: "Profile" })).toHaveCount(0);
  await expect(navbar.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(navbar.getByRole("button", { name: "Sign in" })).toBeVisible();

  if (process.env.E2E_CAPTURE_NAV_SCREENSHOTS === "true") {
    await navbar.screenshot({ path: "/tmp/fair-play-navbar-desktop.png" });
  }
});

test("mobile navbar groups Browse links without overflowing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const navbar = page.getByRole("navigation").first();
  await navbar.getByRole("button", { name: "Toggle navigation menu" }).click();

  await expect(navbar.getByText("Browse", { exact: true })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "Games" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "About" })).toBeVisible();
  await expect(navbar.getByRole("link", { name: "Admin" })).toHaveCount(0);

  if (process.env.E2E_CAPTURE_NAV_SCREENSHOTS === "true") {
    await navbar.screenshot({ path: "/tmp/fair-play-navbar-mobile.png" });
  }

  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
});

test("signed-out navbar auth modal validates required signup profile fields", async ({
  page,
}) => {
  await page.goto("/");

  const navbar = page.getByRole("navigation");
  const signInButton = navbar.getByRole("button", { name: "Sign in" });

  await expect(page.getByText("Discover upcoming games")).toBeVisible();
  await expect(signInButton).toBeVisible();
  await expect(page.getByRole("link", { name: "Profile" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Wallet" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "My Bookings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await signInButton.click();

  await expect(
    page.getByRole("heading", { name: "Sign in or create account" })
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await expect(page.getByPlaceholder("Enter your password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Create account" }).first().click();
  await expect(page.getByPlaceholder("Create password")).toBeVisible();
  await page.getByRole("checkbox", { name: /I agree to the Terms of Service and Privacy Policy/ }).check();

  await page.getByRole("button", { name: "Create account" }).last().click();

  await expect(page.getByText("Please select your age.")).toBeVisible();
});

test("signed-out create account form validates password mismatch", async ({
  page,
}) => {
  await page.goto("/");

  const navbar = page.getByRole("navigation");
  await navbar.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Sign in or create account" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Create account" }).first().click();
  await expect(page.getByPlaceholder("Create password")).toBeVisible();

  await page.getByPlaceholder("you@example.com").fill("player@example.com");
  await page.getByPlaceholder("Create password").fill("safe-password-one");
  await page.getByPlaceholder("Confirm password").fill("safe-password-two");
  await page
    .getByRole("combobox")
    .filter({ has: page.getByRole("option", { name: "20" }) })
    .selectOption("20");
  await page
    .getByRole("combobox")
    .filter({ has: page.getByRole("option", { name: "Midfielder" }) })
    .selectOption("Midfielder");
  await page.getByRole("checkbox", { name: /I agree to the Terms of Service and Privacy Policy/ }).check();

  await page.getByRole("button", { name: "Create account" }).last().click();

  await expect(page.getByText("Passwords do not match.")).toBeVisible();
});
