/**
 * supabase.functions.invoke() returns `data: null` for any non-2xx response
 * and buries the actual JSON error body inside `error.context` (a Response
 * object) rather than `error.message` — callers that only fall back to a
 * generic string on `error` end up hiding exactly the detail (missing
 * deploy, RLS denial, validation message) needed to debug the failure.
 */
export async function extractFunctionErrorMessage(
  error: unknown,
  data: unknown,
  fallback = 'Something went wrong',
): Promise<string> {
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object' && 'json' in context && typeof (context as { json?: unknown }).json === 'function') {
      try {
        const body = await (context as { json: () => Promise<unknown> }).json();
        if (body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'string') {
          return (body as { error: string }).error;
        }
      } catch {
        // context body wasn't JSON (e.g. a 404 HTML page from a function that
        // was never deployed) — fall through to the generic messages below.
      }
    }
  }
  // FunctionsFetchError / FunctionsRelayError — the request never got a
  // parseable response at all (most commonly: the function hasn't been
  // deployed yet, or the project ref/URL is wrong).
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') {
      const message = error instanceof Error ? error.message : '';
      return `Could not reach the server function (${message || String(name)}). It may not be deployed yet.`;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
