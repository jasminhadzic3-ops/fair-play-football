import { expect, type Page } from "@playwright/test";

export async function signInWithEmail(page: Page, email: string, password: string) {
  await page.goto("/");

  const navbar = page.getByRole("navigation");
  const signInButton = navbar.getByRole("button", { name: "Sign in" });

  await expect(page.getByText("Discover upcoming games")).toBeVisible();
  await expect(signInButton).toBeVisible();

  await signInButton.click();

  await expect(page.getByRole("heading", { name: "Sign in or create account" })).toBeVisible();

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).last().click();

  await expect(page.getByRole("link", { name: "Wallet" })).toBeVisible();
}
