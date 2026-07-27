import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-12 text-zinc-100 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl shadow-black/30 sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">
          Fair Play Football
        </p>
        <h1 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm leading-7 text-zinc-400">
          This policy explains how Fair Play Football uses the information needed to run accounts,
          bookings, payments, wallet credit, waiting lists and football updates.
        </p>

        <div className="mt-8 space-y-7 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-semibold text-white">Information we use</h2>
            <p className="mt-2">
              We use account details such as your email address, display name, profile details,
              bookings, payments, wallet transactions and waiting-list activity to operate Fair Play
              Football.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Emails we send</h2>
            <p className="mt-2">
              Fair Play Football sends email updates that help you use the service. These may include
              booking confirmations, payment confirmations, match reminders, waiting-list
              notifications, game cancellations, new game announcements and important account
              notifications.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Service providers</h2>
            <p className="mt-2">
              We use trusted providers to help run the service, including hosting, authentication,
              payments and email delivery. These providers only receive the information needed for
              their role.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Keeping records</h2>
            <p className="mt-2">
              We keep operational records such as bookings, payments, cancellations, wallet activity
              and refund history where needed to run games, support players and maintain accurate
              financial records.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Your choices</h2>
            <p className="mt-2">
              You can update your profile information from your account. You can also contact Fair
              Play Football if you have questions about your personal information or the emails you
              receive.
            </p>
          </section>
        </div>

        <div className="mt-10 rounded-3xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
          For service rules, read the{" "}
          <Link href="/terms" className="font-semibold text-stone-200 underline underline-offset-4">
            Terms of Service
          </Link>
          .
        </div>
      </section>
    </main>
  );
}
