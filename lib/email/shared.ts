import "server-only";

type EmailLayoutParams = {
  previewText: string;
  title: string;
  bodyHtml: string;
  ctaHref?: string;
  ctaLabel?: string;
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

export function renderEmailLayout({
  previewText,
  title,
  bodyHtml,
  ctaHref,
  ctaLabel,
}: EmailLayoutParams) {
  const escapedPreviewText = escapeHtml(previewText);
  const escapedTitle = escapeHtml(title);
  const escapedCtaHref = ctaHref ? escapeHtml(ctaHref) : null;
  const escapedCtaLabel = ctaLabel ? escapeHtml(ctaLabel) : null;

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapedPreviewText}
    </div>
    <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
      <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
        <div style="border:1px solid #27272a;background:#09090b;border-radius:28px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,0.35);">
          <div style="padding:28px 24px 20px;border-bottom:1px solid #27272a;background:#0f0f10;">
            <p style="margin:0 0 12px;font-size:11px;line-height:16px;letter-spacing:0.26em;text-transform:uppercase;color:#d6d3d1;font-weight:700;">
              Fair Play Football
            </p>
            <h1 style="margin:0;font-size:30px;line-height:36px;letter-spacing:-0.01em;color:#ffffff;font-weight:800;">
              ${escapedTitle}
            </h1>
          </div>

          <div style="padding:24px;color:#e4e4e7;font-size:15px;line-height:24px;">
            ${bodyHtml}

            ${
              escapedCtaHref && escapedCtaLabel
                ? `<div style="margin-top:28px;">
                    <a href="${escapedCtaHref}" style="display:inline-block;border-radius:999px;background:#e7e5e4;color:#09090b;text-decoration:none;font-size:15px;line-height:20px;font-weight:800;padding:14px 22px;">
                      ${escapedCtaLabel}
                    </a>
                  </div>`
                : ""
            }
          </div>

          <div style="padding:18px 24px;border-top:1px solid #27272a;background:#050505;color:#a1a1aa;font-size:12px;line-height:20px;">
            <p style="margin:0;">
              You're receiving this because you use Fair Play Football.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}
