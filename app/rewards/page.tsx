import Footer from "@/components/shared/layout/Footer";
import RewardsPageClient from "@/components/rewards/RewardsPageClient";

export const metadata = {
  title: "Rewards & Perks | Fair Play Football",
  description: "Rewards, referrals and player perks from Fair Play Football.",
};

export default function RewardsPage() {
  return (
    <>
      <RewardsPageClient />
      <Footer />
    </>
  );
}
