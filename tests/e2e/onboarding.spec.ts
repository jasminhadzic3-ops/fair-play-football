import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:3000" });

test("verification inbox route explains the next step and offers recovery", async ({ page }) => {
  await page.goto("/verify-email");

  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Fair Play" })).toBeVisible();
});

test("expired confirmation links fail safely into verification recovery", async ({ page }) => {
  await page.goto("/auth/confirm");

  await expect(page.getByRole("heading", { name: "We couldn't verify your email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Send another email" })).toHaveAttribute(
    "href",
    "/verify-email?issue=link"
  );
});