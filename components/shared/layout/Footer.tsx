import Link from "next/link";

const footerLinks = [
  { label: "Games", href: "/#games" },
  { label: "About", href: "/#about" },
  { label: "Contact", href: "/contact" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms & Conditions", href: "/terms" },
];

export default function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-black px-6 py-8 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="inline-flex w-fit items-center text-sm font-black tracking-[0.28em] text-white">
          FAIR PLAY
        </Link>

        <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-semibold text-zinc-400 transition-colors hover:text-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-200/50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
