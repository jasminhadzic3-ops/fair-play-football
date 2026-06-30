import { devices, expect, test } from "@playwright/test";

test.use({
  baseURL: "http://localhost:3000",
  ...devices["iPhone 13"],
  browserName: "chromium",
});

test("signed-out mobile homepage and game details smoke test", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Football on your schedule." })
  ).toBeVisible();

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
    await expect(page.getByText("Available wallet balance")).toHaveCount(0);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Game Info" })).toHaveCount(0);
  }

  await expect(page.getByText("Available wallet balance")).toHaveCount(0);
});
