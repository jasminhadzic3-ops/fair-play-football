import "server-only";

type PremiumEmailLayoutParams = {
  previewText: string;
  title: string;
  introHtml: string;
  cardHtml?: string;
  ctaHref?: string;
  ctaLabel?: string;
  footerText?: string;
};

type EmailCardItem = {
  icon?: string;
  label?: string;
  value: string;
};

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getSiteUrl() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL is required.");
  }

  return siteUrl.replace(/\/$/, "");
}

export function getGameUrl(gameId: number) {
  return `${getSiteUrl()}/?open_game_id=${encodeURIComponent(String(gameId))}#games`;
}

export function getPublicAssetUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getSiteUrl()}${normalizedPath}`;
}

export function formatPrice(amount: number | null | undefined, currency: string | null | undefined = "GBP") {
  const normalizedAmount = Number(amount ?? 0);
  const normalizedCurrency = currency || "GBP";

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(normalizedAmount);
  } catch {
    return `${normalizedCurrency} ${normalizedAmount.toFixed(2)}`;
  }
}

const londonDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
});

const londonTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatEmailGameDateTime(startsAt: string | null | undefined, fallbackTime: string | null | undefined) {
  const fallback = fallbackTime || "TBD";

  if (!startsAt) {
    return {
      date: fallback,
      time: fallback,
    };
  }

  const parsedStartsAt = new Date(startsAt);

  if (Number.isNaN(parsedStartsAt.getTime())) {
    return {
      date: fallback,
      time: fallback,
    };
  }

  return {
    date: londonDateFormatter.format(parsedStartsAt),
    time: londonTimeFormatter.format(parsedStartsAt).toUpperCase(),
  };
}

export function renderEmailParagraphs(paragraphs: string[]) {
  return paragraphs
    .map(
      (paragraph) => `<p style="margin:0 0 16px;color:#d4d4d8;font-size:16px;line-height:25px;">
        ${escapeHtml(paragraph)}
      </p>`
    )
    .join("");
}

export function renderPremiumInfoCard(title: string, items: EmailCardItem[]) {
  return `
    <div style="border:1px solid #27272a;background:#111113;border-radius:26px;padding:20px;margin:0;">
      <p style="margin:0 0 16px;font-size:11px;line-height:16px;letter-spacing:0.22em;text-transform:uppercase;color:#d6d3d1;font-weight:800;">
        ${escapeHtml(title)}
      </p>
      <div style="margin:0;">
        ${items
          .map(
            (item, index) => `<p style="margin:${index === items.length - 1 ? "0" : "0 0 12px"};color:#f4f4f5;font-size:16px;line-height:24px;font-weight:700;">
              ${item.icon ? `${escapeHtml(item.icon)} ` : ""}${item.label ? `${escapeHtml(item.label)} ` : ""}<span style="font-weight:500;color:#e4e4e7;">${escapeHtml(item.value)}</span>
            </p>`
          )
          .join("")}
      </div>
    </div>
  `;
}

export function renderPremiumGameDetailsCard({
  date,
  time,
  venue,
  price,
}: {
  date: string;
  time: string;
  venue: string;
  price?: string | null;
}) {
  const items: EmailCardItem[] = [
    { icon: "📅", value: date },
    { icon: "🕒", value: time },
    { icon: "📍", value: venue },
  ];

  if (price) {
    items.push({ icon: "💷", value: price });
  }

  return renderPremiumInfoCard("Game Details", items);
}

export function renderPremiumEmailLayout({
  previewText,
  title,
  introHtml,
  cardHtml,
  ctaHref,
  ctaLabel,
  footerText,
}: PremiumEmailLayoutParams) {
  const escapedPreviewText = escapeHtml(previewText);
  const escapedTitle = escapeHtml(title);
  const escapedCtaHref = ctaHref ? escapeHtml(ctaHref) : null;
  const escapedCtaLabel = ctaLabel ? escapeHtml(ctaLabel) : null;
  const escapedLogoUrl = escapeHtml(getPublicAssetUrl("/email-logo.png"));

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapedPreviewText}
    </div>
    <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
      <div style="max-width:640px;margin:0 auto;padding:24px 14px;">
        <div style="border:1px solid #27272a;background:#09090b;border-radius:32px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,0.42);">
          <div style="padding:32px 24px 26px;text-align:center;background:#09090b;">
            <img src="${escapedLogoUrl}" width="64" height="67" alt="Fair Play Football" style="display:block;width:64px;height:auto;margin:0 auto 22px;border:0;outline:none;text-decoration:none;" />
            <h1 style="margin:0;color:#ffffff;font-size:34px;line-height:40px;font-weight:900;letter-spacing:-0.01em;">
              ${escapedTitle}
            </h1>
          </div>

          <div style="padding:0 24px 30px;">
            <div style="color:#d4d4d8;font-size:16px;line-height:25px;">
              ${introHtml}
            </div>

            ${cardHtml ? `<div style="margin-top:10px;">${cardHtml}</div>` : ""}

            ${
              escapedCtaHref && escapedCtaLabel
                ? `<div style="margin-top:26px;">
                    <a href="${escapedCtaHref}" style="display:block;border-radius:999px;background:#e7e5e4;color:#09090b;text-align:center;text-decoration:none;font-size:16px;line-height:20px;font-weight:900;padding:17px 24px;">
                      ${escapedCtaLabel}
                    </a>
                  </div>`
                : ""
            }

            ${
              footerText
                ? `<p style="margin:22px 0 0;color:#a1a1aa;font-size:13px;line-height:21px;text-align:center;">
                    ${escapeHtml(footerText)}
                  </p>`
                : ""
            }
          </div>

          <div style="padding:20px 24px;border-top:1px solid #27272a;background:#050505;color:#a1a1aa;font-size:12px;line-height:20px;text-align:center;">
            <p style="margin:0;">
              booking@fairplayfootball.co.uk
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}
