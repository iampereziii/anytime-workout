/**
 * Boot-time fail-fast (feature brief: timezone-correct-today, Risk #3).
 * Next runs `register()` once at server startup. Validating APP_TIMEZONE here
 * turns a misconfigured deploy into a loud startup failure instead of subtle
 * wrong-day behavior surfacing per-request. The date helpers guard again at
 * call time, so this is the early tripwire, not the only one.
 */
export async function register() {
  const { appTimeZone } = await import("@/lib/dates");
  appTimeZone();
}
