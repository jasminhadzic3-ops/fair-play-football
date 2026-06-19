import { getAuthenticatedAdminUser } from "@/lib/adminAuth";

export async function GET(request: Request) {
  try {
    const adminUser = await getAuthenticatedAdminUser(request.headers.get("authorization"));

    return Response.json({ isAdmin: Boolean(adminUser) });
  } catch {
    return Response.json({ isAdmin: false });
  }
}
