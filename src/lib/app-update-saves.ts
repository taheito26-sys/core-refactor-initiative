const pending = new Set<Promise<unknown>>();
const outcomes = new Map<string, { sequence: number; failed: boolean; error?: unknown; retry?: () => Promise<unknown> }>();
let epoch = 0;
let sequence = 0;
let activeMutations = () => 0;

export function registerAppUpdateMutationCheck(check: () => number): void {
  activeMutations = check;
}

/** Updates may interrupt an editor, but must not interrupt submitted financial writes. */
export function trackAppSave<T>(request: Promise<T>, channel: 'tracker' | 'cash', retry?: () => Promise<T>): Promise<T> {
  const startedIn = epoch;
  const requestSequence = ++sequence;
  const record = (failed: boolean, error?: unknown) => {
    if (startedIn !== epoch || requestSequence < (outcomes.get(channel)?.sequence ?? 0)) return;
    outcomes.set(channel, { sequence: requestSequence, failed, error, retry });
  };
  pending.add(request);
  request.then(() => {
    pending.delete(request);
    record(false);
  }, error => {
    pending.delete(request);
    record(true, error);
  });
  return request;
}

export function hasPendingAppSaves(): boolean {
  return activeMutations() > 0 || pending.size > 0 || [...outcomes.values()].some(outcome => outcome.failed);
}

export async function waitForAppSaves(): Promise<void> {
  while (pending.size || activeMutations() > 0) {
    if (pending.size) await Promise.all([...pending]);
    else await new Promise(resolve => setTimeout(resolve, 50));
  }
  const failed = [...outcomes.entries()].filter(([, outcome]) => outcome.failed);
  for (const [channel, outcome] of failed) {
    if (outcome.retry) await trackAppSave(Promise.resolve().then(outcome.retry), channel as 'tracker' | 'cash', outcome.retry);
  }
  const failure = [...outcomes.values()].find(outcome => outcome.failed);
  if (failure) throw failure.error ?? new Error('A submitted save has not completed.');
}

export function resetAppUpdateSaves(): void {
  epoch += 1;
  outcomes.clear();
}
