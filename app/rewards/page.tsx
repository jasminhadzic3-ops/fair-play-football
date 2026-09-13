import Footer from "@/components/shared/layout/Footer";

export const metadata = {
  title: "Rewards & Perks | Fair Play Football",
  description: "Rewards, referrals and player perks from Fair Play Football.",
};

const rewardsSections = [
  {
    label: "Loyalty promotion",
    heading: "Fair Play Rewards",
    body: "Complete 9 eligible games booked through your Fair Play account and receive £5 credit towards your next game.",
    supportingText:
      "Only attended, paid Fair Play bookings count. Cancelled, refunded, complimentary and third-party bookings are excluded. Your progress is tracked automatically in your account.",
  },
  {
    label: "Referral promotion",
    heading: "Football is better with friends.",
    body: "Invite a new player to Fair Play and they’ll receive £5 off their first game. Once they complete their second paid game, you’ll receive £5 Fair Play credit.",
    supportingText: "Share your personal referral code from your account.",
  },
  {
    label: "Player Perks",
    heading: "Affordable football for everyone.",
    body: "Enjoy Fair Play games from just £5–£5.50, alongside exclusive player benefits, special offers and more.",
    supportingText: "More value, more football, and more reasons to play with Fair Play.",
  },
];

export default function RewardsPage() {
  return (
    <>
      <main className="min-h-screen bg-black px-6 py-12 text-white sm:py-16">
        <div className="mx-auto max-w-5xl">
          <header className="mb-10 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500">
              Fair Play Football
            </p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Rewards &amp; Perks
            </h1>
          </header>

          <div className="mx-auto max-w-5xl space-y-10 lg:space-y-14">
            {rewardsSections.map((item, index) => (
              <section
                key={item.heading}
                className={`w-full rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-[0_18px_54px_rgba(0,0,0,0.22)] sm:p-8 lg:max-w-3xl ${index === 1 ? "lg:ml-auto" : "lg:mr-auto"}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">{item.label}</p>
                <h2 className="text-2xl font-extrabold tracking-tight text-white">{item.heading}</h2>
                <p className="mt-5 text-base leading-7 text-zinc-200">{item.body}</p>
                <p className="mt-6 max-w-3xl text-sm leading-6 text-zinc-500">{item.supportingText}</p>
              </section>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}