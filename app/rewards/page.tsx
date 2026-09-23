import Footer from "@/components/shared/layout/Footer";
import Link from "next/link";

export const metadata = {
  title: "Rewards & Perks | Fair Play Football",
  description: "Rewards, referrals and player perks from Fair Play Football.",
};

const whatsappCommunityUrl = "https://chat.whatsapp.com/JAGpOaEd8jf2njevCRK7JE?mode=gi_t";

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
    label: "Loyalty promotion",
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
    heading: "Football is better with friends.",
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

const actionClass =
  "mt-6 inline-flex min-h-11 items-center justify-center rounded-full border border-amber-100/45 px-5 text-sm font-bold text-amber-50 transition-colors hover:border-amber-100/70 hover:bg-amber-100/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-100/70";

export default function RewardsPage() {
  return (
    <>
      <main className="min-h-screen bg-black px-6 py-12 text-white sm:py-16">
        <div className="mx-auto max-w-5xl">
          <header className="mb-10 max-w-2xl">
            <Link
              href="/"
              className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500 transition-colors hover:text-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/60"
            >
              Fair Play Football
            </Link>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Rewards &amp; Perks
            </h1>
          </header>

          <div className="mx-auto max-w-5xl space-y-10 lg:space-y-14">
            {rewardsSections.map((item, index) => (
              <section
                key={item.heading}
                aria-labelledby={`${item.id}-heading`}
                className={`w-full rounded-[1.5rem] border border-stone-300/15 bg-zinc-950 p-6 shadow-[0_18px_54px_rgba(0,0,0,0.22)] sm:p-8 lg:max-w-3xl ${index === 1 ? "lg:ml-auto" : "lg:mr-auto"}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">{item.label}</p>
                <h2 id={`${item.id}-heading`} className="mt-3 text-2xl font-extrabold tracking-tight text-stone-100">
                  {item.heading}
                </h2>
                <p className="mt-5 text-base leading-7 text-stone-200">{item.body}</p>
                <p className="mt-6 max-w-3xl text-sm leading-6 text-stone-400">{item.supportingText}</p>
                {item.rewardText && item.automaticText ? (
                  <>
                    <p className="mt-4 max-w-3xl text-sm leading-6 text-stone-400">{item.rewardText}</p>
                    <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-stone-200">{item.automaticText}</p>
                  </>
                ) : null}
                {item.action.external ? (
                  <a
                    href={item.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={actionClass}
                    aria-label={`${item.action.label} (opens in a new tab)`}
                  >
                    {item.action.label} <span className="ml-3 text-lg" aria-hidden="true">→</span>
                  </a>
                ) : (
                  <Link href={item.action.href} className={actionClass}>
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