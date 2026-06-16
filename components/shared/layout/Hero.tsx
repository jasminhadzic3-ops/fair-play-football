"use client";

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
              <img
                src="/image.png"
                alt="Fair Play Football logo"
                className="relative h-full w-full object-cover"
              />
            </div>

            <div className="space-y-4 px-2 md:px-0">
              <h1 className="text-2xl md:text-2xl font-extrabold text-white leading-tight tracking-[-0.03em] md:tracking-[-0.02em] drop-shadow-[0_1px_15px_rgba(255,255,255,0.08)]">
                Football on your schedule.
              </h1>
              <p className="mx-auto max-w-2xl text-lg md:text-xl text-zinc-300 leading-relaxed">
                Join weekly 6v6, 7v7 & 8v8 games across North London.
              </p>
              <div className="inline-flex flex-wrap items-center justify-center gap-3 text-sm font-semibold text-zinc-200 md:text-base">
                <span className="inline-flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-white"
                    aria-hidden="true"
                  >
                    <path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4" />
                    <circle cx="12" cy="9" r="3" />
                    <path d="M20 19c0-1.7-1-3.1-2.4-3.7" />
                    <path d="M4 19c0-1.7 1-3.1 2.4-3.7" />
                  </svg>
                  Friendly games
                </span>
                <span className="hidden h-4 w-px bg-white/15 sm:block" />
                <span className="inline-flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-white"
                    aria-hidden="true"
                  >
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="M12 5v14" />
                    <path d="M4 12h4" />
                    <path d="M16 12h4" />
                    <circle cx="12" cy="12" r="2" />
                  </svg>
                  Quality pitches
                </span>
                <span className="hidden h-4 w-px bg-white/15 sm:block" />
                <span className="inline-flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-white"
                    aria-hidden="true"
                  >
                    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
                  </svg>
                  All levels welcome
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mt-2 w-full justify-center">
              <a
                href="#games"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-black font-semibold rounded-full shadow-lg shadow-white/10 transition-transform duration-300 hover:-translate-y-0.5"
              >
                Find Games
              </a>
              <a
                href="/admin"
                className="inline-flex items-center justify-center px-8 py-4 border border-zinc-700 text-white font-semibold rounded-full transition-colors duration-300 hover:bg-zinc-900"
              >
                Host a Match
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
