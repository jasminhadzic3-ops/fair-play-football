import Link from "next/link";
import Footer from "@/components/shared/layout/Footer";

export default function TermsPage() {
  return (
    <>
      <main className="min-h-screen bg-zinc-950 px-4 py-12 text-zinc-100 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl shadow-black/30 sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">
            Fair Play Football
          </p>
          <h1 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-4 text-sm leading-7 text-zinc-400">
            These terms explain the basic rules for using Fair Play Football to create an account,
            book football games, join waiting lists, manage wallet credit and receive service updates.
          </p>

        <div className="mt-8 space-y-7 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-semibold text-white">Using your account</h2>
            <p className="mt-2">
              You are responsible for keeping your account details accurate and secure. You should
              only book games for yourself unless Fair Play Football has agreed otherwise.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Bookings and payments</h2>
            <p className="mt-2">
              Places are confirmed on a first paid, first served basis. Fair Play Football may use
              card payments, wallet credit or other supported payment methods to manage bookings,
              cancellations and refunds.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Email updates</h2>
            <p className="mt-2">
              By creating an account, you understand that Fair Play Football will email you important
              updates about your account and football activity. These emails may include booking
              confirmations, payment confirmations, match reminders, waiting-list notifications,
              game cancellations, new game announcements and important account notifications.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Fair play</h2>
            <p className="mt-2">
              Players are expected to treat each other respectfully, arrive on time and follow the
              match rules shown for each game. Fair Play Football may refuse or remove bookings where
              needed to protect players, organisers or the integrity of a game.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Changes</h2>
            <p className="mt-2">
              Fair Play Football may update these terms as the service develops. Continued use of
              the service after changes are published means you accept the updated terms.
            </p>
          </section>
        </div>

        <div className="mt-10 rounded-3xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
          For privacy details, read the{" "}
          <Link href="/privacy" className="font-semibold text-stone-200 underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
