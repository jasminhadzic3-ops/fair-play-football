"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/");
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className="inline-flex min-h-11 items-center rounded-full border border-zinc-800 bg-zinc-950 px-4 text-sm font-semibold text-zinc-300 transition hover:border-stone-200/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-stone-200/40"
      aria-label="Go back"
    >
      <span className="mr-2 text-base" aria-hidden="true">←</span>
      Back
    </button>
  );
}
