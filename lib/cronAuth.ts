// Auth for /api/jobs/* routes: x-cron-secret header, not the session cookie
// (see src/proxy.ts, which exempts these routes for exactly this reason).
export function isAuthorizedCronRequest(request: Request): boolean {
  const header = request.headers.get("x-cron-secret");
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && header === secret;
}
