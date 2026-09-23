import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://localhost:3000" });

test("verification inbox route stays within the mobile viewport", async ({ page }) => {
  await page.goto("/verify-email?intent=booking");

  await expect(page.getByRole("heading", { name: "Verify your email to book" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    bodyWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
});