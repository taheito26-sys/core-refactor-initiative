// Demo mode disabled — production environment

export async function isDemoMode(): Promise<boolean> {
  return false;
}

export function getDemoMode(): boolean {
  return false;
}
