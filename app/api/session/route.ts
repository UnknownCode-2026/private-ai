import { isAccessConfigured, isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    configured: isAccessConfigured(),
    authenticated: await isAuthorized(),
  });
}
