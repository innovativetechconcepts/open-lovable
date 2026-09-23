import { pilotState } from "./pilot-context";
export function pilotFetch(input: string, init: RequestInit = {}) {
  const origin = process.env.AIDAOS_BUILDER_ORIGIN!;
  const url = new URL(input, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/"))
    throw new Error("Invalid internal endpoint");
  const current = pilotState().requestHeaders as Headers;
  const headers = new Headers(init.headers);
  for (const name of ["authorization", "cookie"]) {
    const value = current.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("origin", origin);
  return fetch(url, { ...init, headers, redirect: "error" });
}
