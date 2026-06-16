import "server-only";

type SendResendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

type ResendEmailResult = {
  id?: string;
  dryRun?: boolean;
};

function isEmailDryRun() {
  return process.env.EMAIL_DRY_RUN === "true";
}

function getEmailFrom() {
  const emailFrom = process.env.EMAIL_FROM;

  if (!emailFrom) {
    throw new Error("EMAIL_FROM is required.");
  }

  return emailFrom;
}

function getResendApiKey() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required.");
  }

  return apiKey;
}

async function readResendResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function sendResendEmail(params: SendResendEmailParams): Promise<ResendEmailResult> {
  if (isEmailDryRun()) {
    console.info("Email dry run:", {
      idempotencyKey: params.idempotencyKey,
      subject: params.subject,
      to: params.to,
    });
    return { dryRun: true };
  }

  const body: Record<string, unknown> = {
    from: getEmailFrom(),
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  };

  if (process.env.EMAIL_REPLY_TO) {
    body.reply_to = process.env.EMAIL_REPLY_TO;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getResendApiKey()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const result = await readResendResponse(response);

  if (!response.ok) {
    throw new Error(result?.message || result?.error || "Unable to send email with Resend.");
  }

  return result ?? {};
}
