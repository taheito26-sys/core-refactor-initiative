export function loginErrorKey(error: unknown): 'loginInvalidCredentials' | 'loginConnectionError' | 'loginFailed' {
  const value = error as { code?: string; message?: string; name?: string; status?: number } | null;
  if (value?.code === 'invalid_credentials' || /invalid login credentials/i.test(value?.message || '')) return 'loginInvalidCredentials';
  if (value?.name === 'AbortError' || /network|fetch|timed? out|timeout|connection/i.test(value?.message || '') || (value?.status || 0) >= 500) return 'loginConnectionError';
  return 'loginFailed';
}
