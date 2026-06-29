import { expect, test } from "@playwright/test";

test("signed-out homepage and game details smoke test", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Football on your schedule." })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Find Games" })).toBeVisible();

  await page.getByRole("link", { name: "Find Games" }).click();
  await expect(page.locator("#games")).toBeVisible();
  await expect(page.getByText("Discover upcoming games")).toBeVisible();

  const gameCards = page.locator("#games").locator(".cursor-pointer");
  const gameCount = await gameCards.count();

  if (gameCount > 0) {
    await gameCards.first().click();

    await expect(page.getByRole("heading", { name: "Game Info" })).toBeVisible();
    await expect(page.getByText("Teams")).toBeVisible();
    await expect(page.getByText("Rules")).toBeVisible();
  }

  await expect(page.getByText("Available wallet balance")).toHaveCount(0);
});
