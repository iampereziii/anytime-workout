/**
 * Client-side fetch helpers typed to the fixed API shape
 * `{ data } | { error: { code, message } }` (spec Conventions #5).
 */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handle<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string } }
    | null;
  if (!res.ok || !json || json.error || json.data === undefined) {
    throw new ApiError(
      json?.error?.code ?? "http_error",
      json?.error?.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return json.data;
}

export async function apiGet<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url));
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
