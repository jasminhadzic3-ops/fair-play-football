import Footer from "@/components/shared/layout/Footer";
import Link from "next/link";
import BackButton from "@/components/rewards/BackButton";
import LoyaltyRewardAction from "@/components/rewards/LoyaltyRewardAction";

export const metadata = {
  title: "Rewards & Perks | Fair Play Football",
  description: "Rewards, referrals and player perks from Fair Play Football.",
};

const whatsappCommunityUrl = "https://chat.whatsapp.com/JAGpOaEd8jf2njevCRK7JE?mode=gi_t";

function RewardIcon({ name }: { name: "trophy" | "people" | "star" }) {
  if (name === "trophy") {
    return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true"><path d="M8 4h8v5.5a4 4 0 0 1-8 0V4Z" stroke="currentColor" strokeWidth="1.8" /><path d="M8 6H5.5A1.5 1.5 0 0 0 4 7.5v.5a4 4 0 0 0 4 4M16 6h2.5A1.5 1.5 0 0 1 20 7.5v.5a4 4 0 0 1-4 4M12 13.5V17M8.5 20h7M10 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (name === "people") {
    return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="2.5" fill="currentColor" /><circle cx="16.5" cy="9" r="2" fill="currentColor" /><path d="M4.5 18a4.5 4.5 0 0 1 9 0M14 18a3.5 3.5 0 0 1 6.5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true"><path d="m12 2.7 2.76 5.59 6.17.9-4.46 4.35 1.05 6.15L12 16.79l-5.52 2.9 1.05-6.15-4.46-4.35 6.17-.9L12 2.7Z" /></svg>;
}

type RewardAction = {
  href: string;
  label: string;
  external?: boolean;
};

type RewardsSection = {
  id: string;
  label: string;
  heading: string;
  body: string;
  supportingText: string;
  rewardText?: string;
  automaticText?: string;
  action: RewardAction;
};

const rewardsSections: RewardsSection[] = [
  {
    id: "loyalty",
    label: "Loyalty Reward",
    heading: "Fair Play Rewards",
    body: "Complete 5 eligible games booked through your Fair Play account and get your 6th game free.",
    supportingText:
      "Only attended, paid Fair Play bookings count. Cancelled, refunded, complimentary and third-party bookings are excluded. Your progress is tracked automatically in your account.",
    action: {
      href: "/?sign_in=1",
      label: "Create Fair Play account",
    },
  },
  {
    id: "referral-promotion",
    label: "Referral promotion",
    heading: "Invite a friend. Earn a free game.",
    body: "Invite a new player using your personal referral code.",
    supportingText:
      "Once they register with your code and verify their account, you’ll receive £5 Fair Play Wallet credit.",
    rewardText:
      "They’ll have £5 waiting for them too, which unlocks after their first qualifying paid Fair Play game.",
    automaticText: "Rewards are applied automatically once eligibility is confirmed.",
    action: {
      href: "/wallet#referral",
      label: "View and share your code",
    },
  },
  {
    id: "player-perks",
    label: "Player Perks",
    heading: "Affordable football for everyone.",
    body: "Enjoy Fair Play games from just £5–£5.50, alongside exclusive player benefits, special offers and more.",
    supportingText: "More value, more football, and more reasons to play with Fair Play.",
    action: {
      href: whatsappCommunityUrl,
      label: "Join WhatsApp group",
      external: true,
    },
  },
];

const cardClass = "relative overflow-hidden rounded-[2rem] border border-zinc-800 bg-[#080b0d] p-6 shadow-[0_18px_54px_rgba(0,0,0,0.3)] sm:p-6";
const iconClass = "absolute right-6 top-6 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300";
const outlineActionClass = "mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-bold text-zinc-100 transition hover:border-white hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-zinc-300/60";

export default function RewardsPage() {
  return (
    <>
      <main className="min-h-screen bg-black px-6 py-3 text-white sm:py-3">
        <div className="mx-auto max-w-[960px]">
          <div className="mb-5 lg:mb-4"><BackButton /></div>
          <header className="mb-3 max-w-2xl">
            <Link href="/" className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500 transition-colors hover:text-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/60">
              Fair Play Football
            </Link>
            <h1 className="mt-1 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Rewards &amp; Perks
            </h1>
          </header>

          <div className="mx-auto max-w-[960px] space-y-5">
            {rewardsSections.map((item, index) => (
              <section
                key={item.heading}
                aria-labelledby={`${item.id}-heading`}
                className={`${cardClass} w-full ${index === 0 ? "lg:max-w-[820px] lg:mr-auto" : index === 1 ? "lg:ml-[225px] lg:max-w-[760px]" : "lg:max-w-[770px] lg:mr-auto"}`}
              >
                <div className={iconClass}><RewardIcon name={index === 0 ? "trophy" : index === 1 ? "people" : "star"} /></div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">{item.label}</p>
                <h2 id={`${item.id}-heading`} className="mt-2 max-w-[calc(100%-4rem)] text-2xl font-extrabold tracking-tight text-stone-100">
                  {item.heading}
                </h2>
                <p className="mt-3 max-w-4xl text-base leading-7 text-zinc-100">{item.body}</p>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-400">{item.supportingText}</p>
                {item.rewardText && item.automaticText ? (
                  <>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{item.rewardText}</p>
                    <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-zinc-100">{item.automaticText}</p>
                  </>
                ) : null}
                {item.action.external ? (
                  <a
                    href={item.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={outlineActionClass}
                    aria-label={`${item.action.label} (opens in a new tab)`}
                  >
                    {item.action.label} <span className="ml-3 text-lg" aria-hidden="true">→</span>
                  </a>
                ) : index === 0 ? (
                    <LoyaltyRewardAction />
                ) : (
                    <Link href={item.action.href} className={outlineActionClass}>
                      {item.action.label} <span className="ml-3 text-lg" aria-hidden="true">→</span>
                    </Link>
                )}
              </section>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
