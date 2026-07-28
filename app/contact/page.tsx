import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/shared/layout/Footer";

export const metadata: Metadata = {
  title: "Contact & Support",
  description:
    "Contact Fair Play Football for general enquiries, booking issues, refund questions and support with North London football games.",
};

const supportEmailSource = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || process.env.EMAIL_REPLY_TO || "";

function extractEmailAddress(value: string) {
  const bracketMatch = value.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1];
  }

  const emailMatch = value.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  return emailMatch?.[0] ?? "";
}

const supportEmail = extractEmailAddress(supportEmailSource);
const supportHref = supportEmail ? `mailto:${supportEmail}` : "/#games";

const contactCategories = ["General enquiries", "Booking issues", "Refund questions", "Report a problem"];

const faqs = [
  {
    category: "Booking",
    answer: "Places are confirmed on a first paid, first served basis.",
  },
  {
    category: "Payments",
    answer: "Reserve your spot online. Fair Play Football may use card payments, wallet credit or other supported payment methods.",
  },
  {
    category: "Wallet",
    answer: "Wallet credit can be used for supported bookings, cancellations and refunds.",
  },
  {
    category: "Refunds",
    answer:
      "Cancel your booking at least 24 hours before kick-off and you'll receive a full refund. If you cancel within 24 hours of kick-off, no refund is available.",
  },
  {
    category: "Waiting list",
    answer: "If a game is full, you can join the waiting list. If a space opens, you will be notified.",
  },
  {
    category: "Game cancellations",
    answer:
      "If Fair Play Football cancels a game, all booked players receive a full refund. If a game is cancelled because the minimum number of players is not reached, all booked players receive a full refund.",
  },
  {
    category: "Competitive vs Casual games",
    answer: "Casual games are relaxed and social. Competitive games have a sharper tempo while staying respectful.",
  },
  {
    category: "Age requirement",
    answer: "Players must be 18 or over.",
  },
  {
    category: "Equipment / Boots",
    answer: "Astros, moulds and football boots are allowed. No metal studs.",
  },
  {
    category: "Weather",
    answer: "Games usually go ahead in normal rain. If the organiser cancels, players receive the full amount back.",
  },
];

export default function ContactPage() {
  return (
    <>
      <main className="min-h-screen bg-black px-6 py-12 text-white sm:py-16">
        <div className="mx-auto max-w-5xl">
          <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500">
                Fair Play Football
              </p>
              <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                Contact & Support
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
                Have a question about a game, booking, payment or refund? Get in touch and we will help you find
                the right answer.
              </p>
            </div>

            <div className="rounded-2xl border border-stone-200/15 bg-stone-200 px-5 py-5 text-zinc-950 shadow-[0_18px_54px_rgba(214,211,209,0.12)]">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-zinc-700">
                Usually reply within
              </p>
              <p className="mt-2 text-3xl font-black text-zinc-950">24 hours</p>
              <p className="mt-3 text-sm leading-6 text-zinc-800">
                Include your game, booking or payment details where relevant so support can help quickly.
              </p>
            </div>
          </section>

          <section className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
            <div className="grid gap-6 md:grid-cols-[0.9fr_1.1fr] md:items-center">
              <div>
                <h2 className="text-2xl font-bold text-white">Contact</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Send a message for player support, booking questions or anything that needs a closer look.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-black/40 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Support email</p>
                {supportEmail ? (
                  <a
                    href={supportHref}
                    className="mt-2 inline-flex break-all text-base font-bold text-stone-200 underline underline-offset-4 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50"
                  >
                    {supportEmail}
                  </a>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-zinc-300">Support email is configured for production.</p>
                )}
                <p className="mt-3 text-sm text-zinc-400">Usually reply within 24 hours.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {contactCategories.map((category) => (
                <div key={category} className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                  <p className="text-sm font-semibold text-white">{category}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
            <h2 className="text-2xl font-bold text-white">Frequently Asked Questions</h2>
            <div className="mt-5 grid gap-3">
              {faqs.map((item) => (
                <details key={item.category} className="group rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50">
                    <span className="inline-flex w-full items-center justify-between gap-3">
                      {item.category}
                      <span className="text-zinc-500 transition group-open:rotate-45" aria-hidden="true">
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{item.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-center sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-500">Need more help?</p>
            <h2 className="mt-3 text-2xl font-extrabold text-white">We are here to help you play.</h2>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href={supportHref}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-stone-200 px-6 text-sm font-bold text-zinc-950 transition-colors hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50"
              >
                Email Support
              </a>
              <Link
                href="/#games"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-stone-300/20 bg-zinc-900 px-6 text-sm font-bold text-stone-200 transition-colors hover:border-stone-200/35 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/40"
              >
                Browse Games
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
