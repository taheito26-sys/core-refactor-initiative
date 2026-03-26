export function randomUUID() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `nonce_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
