import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedAdminUserMock = vi.hoisted(() => vi.fn());
const sendResendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/adminAuth", () => ({
  getAuthenticatedAdminUser: getAuthenticatedAdminUserMock,
}));

vi.mock("@/lib/email/resend", () => ({
  sendResendEmail: sendResendEmailMock,
}));

import { POST } from "@/app/api/admin/test-email/route";

function request(body: unknown, authorization = "Bearer admin-token") {
  return new Request("http://localhost/api/admin/test-email", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedAdminUserMock.mockResolvedValue({ id: "admin-1" });
  sendResendEmailMock.mockResolvedValue({ id: "email-1" });
});

describe("admin test email route", () => {
  it("requires an authenticated admin", async () => {
    getAuthenticatedAdminUserMock.mockResolvedValue(null);

    const response = await POST(request({ recipient_email: "player@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: "Unauthorized" });
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid recipient emails", async () => {
    const response = await POST(request({ recipient_email: "not-an-email" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: "A valid recipient email is required.",
    });
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it("sends exactly one simple test email", async () => {
    const response = await POST(request({ recipient_email: " jasmin@example.com " }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock).toHaveBeenCalledWith({
      to: "jasmin@example.com",
      subject: "Fair Play Football - Email Test",
      html: expect.stringContaining("Fair Play Football email delivery is working."),
      text: expect.stringContaining("Fair Play Football email delivery is working."),
      idempotencyKey: expect.stringMatching(/^admin_test_email:admin-1:\d+$/),
    });
  });

  it("returns safe failure JSON when Resend fails", async () => {
    sendResendEmailMock.mockRejectedValue(new Error("Unable to send email with Resend."));

    const response = await POST(request({ recipient_email: "jasmin@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "Unable to send email with Resend.",
    });
    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
  });
});
