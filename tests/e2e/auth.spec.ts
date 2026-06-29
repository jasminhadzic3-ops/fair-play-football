import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:3000" });

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

  await page.getByRole("button", { name: "Create account" }).last().click();

  await expect(page.getByText("Please select your age.")).toBeVisible();
});
