import { expect, test } from "@playwright/test";

test.use({
  baseURL: "http://localhost:3000",
});

test("signed-out Join Game opens auth prompt without checkout access", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Find Games" }).click();
  await expect(page.locator("#games")).toBeVisible();
  await expect(page.getByText("Discover upcoming games")).toBeVisible();

  const gameCards = page.locator("#games").locator(".cursor-pointer");
  const gameCount = await gameCards.count();

  if (gameCount === 0) {
    await expect(page.getByText("Discover upcoming games")).toBeVisible();
    return;
  }

  await gameCards.first().click();
  await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();

  const joinGameButton = page.getByRole("button", { name: "Join Game" });

  if ((await joinGameButton.count()) === 0) {
    await expect(page.getByText("Secure checkout")).toHaveCount(0);
    await expect(page.getByText(/Pay .*with Wallet/)).toHaveCount(0);
    await expect(page.getByText(/Pay .*with SumUp/)).toHaveCount(0);
    await expect(page.getByText("Available wallet balance")).toHaveCount(0);
    return;
  }

  await joinGameButton.click();

  await expect(
    page.getByRole("heading", { name: "Sign in to continue" })
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await expect(page.getByPlaceholder("Enter your password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" }).last()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create account" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to match" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to match" }).click();

  await expect(
    page.getByRole("heading", { name: "Sign in to continue" })
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();

  await expect(page.getByText("Secure checkout")).toHaveCount(0);
  await expect(page.getByText(/Pay .*with Wallet/)).toHaveCount(0);
  await expect(page.getByText(/Pay .*with SumUp/)).toHaveCount(0);
  await expect(page.getByText("Available wallet balance")).toHaveCount(0);
});
