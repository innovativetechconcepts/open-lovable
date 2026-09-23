/** Single-operator pilot. No permissive development fallback. */
export async function operatorAuthorized(headers: Headers): Promise<boolean> {
  const user = process.env.AIDAOS_OPERATOR_USERNAME;
  const password = process.env.AIDAOS_OPERATOR_PASSWORD;
  if (!user || !password || password.length < 32) return false;
  const expected = `Basic ${btoa(`${user}:${password}`)}`;
  const actual = headers.get("authorization") || "";
  const hash = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [a, b] = await Promise.all([hash(expected), hash(actual)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function sameOriginRequest(request: Request): boolean {
  const configured = process.env.AIDAOS_BUILDER_ORIGIN;
  if (!configured) return false;
  const expected = new URL(configured);
  if (
    expected.origin !== configured ||
    (expected.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(expected.hostname))
  )
    return false;
  // Next may normalize its internal URL to localhost behind the deployment proxy.
  // Host must still exactly match the fixed operator origin; forwarded headers are ignored.
  if (
    (request.headers.get("host") || new URL(request.url).host) !== expected.host
  )
    return false;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  if (origin && origin !== configured) return false;
  return (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) || origin === configured
  );
}
