export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("throw") !== "1") {
    return Response.json({
      ok: true,
      message: "Visit /api/sentry-test?throw=1 to send a test error to Sentry.",
    });
  }

  throw new Error("Sentry test error: explicit /api/sentry-test?throw=1 visit");
}
