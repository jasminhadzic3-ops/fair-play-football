import Image from "next/image";
import Link from "next/link";

export default function Hero() {
  return (
    <div className="relative w-full bg-black overflow-hidden">
      <div className="absolute inset-0 bg-black/95" />
      <div className="relative max-w-6xl mx-auto px-6 pt-28 pb-20 md:pt-32 md:pb-24 flex flex-col items-center text-center">
        <div className="relative mb-12 px-10 py-14 rounded-[2.5rem] bg-zinc-950 border border-zinc-800 shadow-[0_35px_90px_rgba(0,0,0,0.45)] backdrop-blur-sm w-full">
          <div className="absolute inset-x-12 top-6 h-24 bg-white/5 blur-2xl" />

          <div className="relative flex flex-col items-center gap-8">
            <div className="relative flex items-center justify-center w-40 h-40 md:w-48 md:h-48 rounded-full overflow-hidden border border-white/10 bg-black shadow-[0_0_42px_rgba(255,255,255,0.12)]">
              <span className="absolute inset-0 rounded-full bg-white/10 blur-3xl" />
              <Image
                src="/image.png"
                alt="Fair Play Football logo"
                fill
                sizes="(min-width: 768px) 12rem, 10rem"
                preload
                className="object-cover"
              />
            </div>

            <div className="space-y-4 px-2 md:px-0">
              <h1 className="text-2xl md:text-2xl font-extrabold text-white leading-tight tracking-[-0.03em] md:tracking-[-0.02em] drop-shadow-[0_1px_15px_rgba(255,255,255,0.08)]">
                Play football in North London. No team needed.
              </h1>
              <p className="mx-auto max-w-[42rem] text-base font-normal leading-[1.65] text-zinc-300 md:text-[18px]">
                Book friendly, organised 6v6, 7v7 and 8v8 games on quality pitches. Come alone or with friends, choose a time that suits you and pay online. Games from £5.
              </p>
              <div className="inline-flex flex-wrap items-center justify-center gap-3 text-sm font-semibold text-zinc-200 md:text-base">
                <span>No team needed</span>
                <span className="hidden h-4 w-px bg-white/15 sm:block" />
                <span>Mixed 18+ games</span>
                <span className="hidden h-4 w-px bg-white/15 sm:block" />
                <span>Quality 3G pitches</span>
                <span className="hidden h-4 w-px bg-white/15 sm:block" />
                <span>Bibs and balls provided</span>
              </div>
            </div>

            <div className="mt-2 flex w-full flex-col items-center gap-4">
              <div className="flex w-full flex-col justify-center gap-4 sm:flex-row">
                <a
                  href="#games"
                  className="inline-flex items-center justify-center px-8 py-4 bg-white text-black font-semibold rounded-full shadow-lg shadow-white/10 transition-transform duration-300 hover:-translate-y-0.5"
                >
                  Find a game
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-full border border-stone-300/20 bg-zinc-900 px-8 py-4 font-semibold text-stone-200 transition-transform duration-300 hover:-translate-y-0.5 hover:border-stone-200/35 hover:bg-zinc-800"
                >
                  How it works
                </a>
              </div>
              <Link
                href="/rewards"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-amber-200/30 bg-zinc-900 px-10 py-4 font-semibold text-amber-100 transition-transform duration-300 hover:-translate-y-0.5 hover:border-amber-100/45 hover:bg-zinc-800 sm:w-auto sm:min-w-[16rem]"
              >
                Loyalty &amp; Referral Rewards
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
