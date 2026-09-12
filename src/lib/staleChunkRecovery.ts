/**
 * A dynamic `import()` (jsPDF, exceljs, …) embeds the exact hashed chunk
 * filename from the build the page was loaded with. If a new deploy lands
 * while someone still has an older page open — very easy on a phone that's
 * been sitting in the background — that filename no longer exists on the
 * server, and the import rejects with "Failed to fetch dynamically imported
 * module" (Chromium) or "error loading dynamically imported module"
 * (Firefox/Safari). No amount of retrying the same in-memory page fixes
 * this; the fix is a fresh load of the current build, the same recovery
 * `RouteErrorBoundary` already performs for render-time chunk failures.
 */
export function isStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(message);
}

/**
 * Unregisters service workers, clears caches, and reloads — mirrors
 * `RouteErrorBoundary.clearAndReload` in App.tsx. Kept separate (rather than
 * exported from there) so a plain event-handler catch block, not just a
 * render-time error boundary, can recover from a stale chunk.
 */
export async function recoverFromStaleChunk(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch {
    // Best effort — reload regardless.
  }
  window.location.reload();
}
