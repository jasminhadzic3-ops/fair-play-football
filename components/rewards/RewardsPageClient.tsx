"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "@/components/rewards/BackButton";
import { supabase } from "@/lib/supabase";

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

function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true"><path d="M20.5 3.5A11.85 11.85 0 0 0 12.06 0C5.5 0 .17 5.32.17 11.88c0 2.1.55 4.15 1.6 5.96L.07 24l6.3-1.65a11.85 11.85 0 0 0 5.69 1.45h.01c6.55 0 11.87-5.33 11.87-11.88 0-3.18-1.24-6.17-3.44-8.42ZM12.07 21.8h-.01a9.86 9.86 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.23-.37a9.87 9.87 0 0 1-1.52-5.29C2.21 6.43 6.61 2 12.07 2c2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.89 7.02c0 5.46-4.43 9.88-9.87 9.88Z" fill="currentColor" /><path d="M17.56 14.45c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.09 4.49.71.31 1.37.2 1.89.12.58-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35Z" fill="currentColor" /></svg>;
}

const cardClass = "relative overflow-hidden rounded-[2rem] border border-zinc-800 bg-[#080b0d] p-6 shadow-[0_18px_54px_rgba(0,0,0,0.3)] sm:p-6";
const iconClass = "absolute right-6 top-6 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300 sm:right-6 sm:top-6";
const labelClass = "text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400";
const primaryButtonClass = "inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-400 px-5 text-sm font-bold text-white transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200/60";
const outlineButtonClass = "inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-bold text-zinc-100 transition hover:border-white hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-zinc-300/60";

export default function RewardsPageClient() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (isMounted) setIsLoggedIn(Boolean(data.user));
    });
    return () => { isMounted = false; };
  }, []);

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white sm:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 lg:mb-6"><BackButton /></div>
        <header className="mb-10 max-w-2xl lg:mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500">Fair Play Football</p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Rewards &amp; Perks</h1>
        </header>

        <div className="space-y-8 lg:space-y-5">
          <section className={`${cardClass} lg:mr-auto lg:max-w-[720px]`}>
            <div className={iconClass}><RewardIcon name="trophy" /></div>
            <p className={labelClass}>Fair Play Rewards</p>
            <h2 className="mt-3 max-w-[calc(100%-4rem)] text-2xl font-extrabold tracking-tight text-white sm:mt-2">Fair Play Rewards</h2>
            <p className="mt-5 max-w-4xl text-base leading-7 text-zinc-100 sm:mt-4 sm:leading-6">Complete 5 eligible games booked through your Fair Play account and get your 6th game free.</p>
            <p className="mt-4 max-w-4xl text-sm leading-6 text-zinc-400 sm:mt-3 sm:leading-5">Only attended, paid Fair Play bookings count. Cancelled, refunded, complimentary and third-party bookings are excluded. Your progress is tracked automatically in your account.</p>
            <div className="mt-6 sm:mt-5"><Link href={isLoggedIn ? "/wallet" : "/?sign_in=1"} className={primaryButtonClass}>{isLoggedIn ? "View your rewards" : "Create Fair Play account"}<span className="ml-3 text-lg" aria-hidden="true">→</span></Link></div>
          </section>

          <section className={`${cardClass} lg:ml-[120px] lg:max-w-[720px]`}>
            <div className={iconClass}><RewardIcon name="people" /></div>
            <p className={labelClass}>Referral promotion</p>
            <h2 className="mt-3 max-w-[calc(100%-4rem)] text-2xl font-extrabold tracking-tight text-white sm:mt-2">Football is better with friends.</h2>
            <p className="mt-5 text-base leading-7 text-zinc-100 sm:mt-4 sm:leading-6">Invite a new player to Fair Play and they’ll get their first game free with £5 credit. Once they complete their second paid game, you’ll get £5 Fair Play credit towards your next game.</p>
            <p className="mt-4 text-sm leading-6 text-zinc-400 sm:mt-3 sm:leading-5">Share your personal referral code from your account.</p>
            <div className="mt-6 sm:mt-5"><button type="button" disabled className={`${outlineButtonClass} cursor-not-allowed`} aria-disabled="true">View your referral code <span className="ml-3 text-lg" aria-hidden="true">→</span></button></div>
          </section>

          <section className={`${cardClass} lg:mr-auto lg:max-w-[720px]`}>
            <div className={iconClass}><RewardIcon name="star" /></div>
            <p className={labelClass}>Player Perks</p>
            <h2 className="mt-3 max-w-[calc(100%-4rem)] text-2xl font-extrabold tracking-tight text-white sm:mt-2">Affordable football for everyone.</h2>
            <p className="mt-5 text-base leading-7 text-zinc-100 sm:mt-4 sm:leading-6">Enjoy Fair Play games from just £5–£5.50, alongside exclusive player benefits, special offers and more.</p>
            <p className="mt-4 text-sm leading-6 text-zinc-400 sm:mt-3 sm:leading-5">More value, more football, and more reasons to play with Fair Play.</p>
            <div className="mt-6 sm:mt-5"><a href={whatsappCommunityUrl} target="_blank" rel="noopener noreferrer" className={primaryButtonClass}><WhatsAppIcon /><span className="ml-2">Join WhatsApp group</span><span className="ml-3 text-lg" aria-hidden="true">→</span></a></div>
          </section>
        </div>
      </div>
    </main>
  );
}
