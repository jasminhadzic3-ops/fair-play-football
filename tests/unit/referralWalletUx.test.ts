import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const referralCardSource = readFileSync(
  join(process.cwd(), "components/wallet/ReferralWalletCard.tsx"),
  "utf8"
);
const walletPageSource = readFileSync(join(process.cwd(), "app/wallet/page.tsx"), "utf8");
const rewardsPageSource = readFileSync(join(process.cwd(), "app/rewards/page.tsx"), "utf8");

describe("referral wallet UX", () => {
  it("loads the database-owned status projection and isolates RPC failure", () => {
    expect(referralCardSource).toContain('supabase.rpc("get_my_referral_reward_status")');
    expect(referralCardSource).toContain("Referral details are currently unavailable. Please try again later.");
    expect(referralCardSource).toContain("id=\"referral\"");
    expect(walletPageSource).toContain("<ReferralWalletCard userId={userId} />");
    expect(walletPageSource.indexOf("<ReferralWalletCard userId={userId} />")).toBeGreaterThan(
      walletPageSource.indexOf("<LoyaltyProgressCard userId={userId} />")
    );
    expect(walletPageSource.indexOf("<ReferralWalletCard userId={userId} />")).toBeLessThan(
      walletPageSource.indexOf("Recent activity")
    );
  });

  it("renders the permanent code with copy and share fallback actions", () => {
    expect(referralCardSource).toContain("Your personal code");
    expect(referralCardSource).toContain("navigator.clipboard.writeText(referralCode)");
    expect(referralCardSource).toContain("navigator.share");
    expect(referralCardSource).toContain("Message copied");
    expect(referralCardSource).toContain('aria-label="Loading referral details"');
    expect(referralCardSource).toContain('aria-live="polite"');
  });

  it("keeps the approved locked-state copy and removes future timing at the eligible_at deadline", () => {
    expect(referralCardSource).toContain("£5 Locked");
    expect(referralCardSource).toContain(
      "Please complete your first qualifying paid Fair Play game to unlock your £5 credit towards your next game."
    );
    expect(referralCardSource).toContain("Thank you for booking with Fair Play. We hope you enjoyed the game!");
    expect(referralCardSource).toContain("Your £5 credit will be added to your wallet shortly.");
    expect(referralCardSource).toContain("eligibleAt.getTime() <= currentTime");
    expect(referralCardSource).toContain("Expected after");
    expect(referralCardSource).toContain("window.setTimeout(() => setCurrentTime(Date.now()), timeoutDelay)");
    expect(referralCardSource).toContain("window.clearTimeout(timeout)");
  });

  it("does not add a separate activation or unlocked reward state", () => {
    expect(referralCardSource).not.toContain("Your £5 referral credit is included in your wallet balance.");
    expect(referralCardSource).not.toContain("Activated");
    expect(referralCardSource).not.toContain("Activating");
    expect(referralCardSource).not.toContain("Claim");
  });

  it("handles the referral hash once after mount with accessible, reduced-motion-aware focus", () => {
    expect(referralCardSource).toContain('window.location.hash !== "#referral"');
    expect(referralCardSource).toContain("hasHandledReferralHashRef.current = true");
    expect(referralCardSource).toContain("section.scrollIntoView({");
    expect(referralCardSource).toContain('behavior: prefersReducedMotion ? "auto" : "smooth"');
    expect(referralCardSource).toContain("section.focus({ preventScroll: true })");
  });

  it("keeps the approved Rewards and referral copy with the Wallet referral CTA", () => {
    expect(rewardsPageSource).toContain('href: "/wallet#referral"');
    expect(rewardsPageSource).toContain("Fair Play Rewards");
    expect(rewardsPageSource).toContain(
      "Complete 5 eligible games booked through your Fair Play account and get your 6th game free."
    );
    expect(rewardsPageSource).toContain(
      "Only attended, paid Fair Play bookings count. Cancelled, refunded, complimentary and third-party bookings are excluded. Your progress is tracked automatically in your account."
    );
    expect(rewardsPageSource).toContain("Referral promotion");
    expect(rewardsPageSource).toContain("Football is better with friends.");
    expect(rewardsPageSource).toContain("Invite a new player using your personal referral code.");
    expect(rewardsPageSource).toContain("Once they register with your code and verify their account, you’ll receive £5 Fair Play Wallet credit.");
    expect(rewardsPageSource).toContain("They’ll have £5 waiting for them too, which unlocks after their first qualifying paid Fair Play game.");
    expect(rewardsPageSource).toContain("Rewards are applied automatically once eligibility is confirmed.");
    expect(rewardsPageSource).toContain("View and share your code");
  });
});