/** Bound startup reads so a stalled request cannot block every retry behind it. */
export async function withAuthDeadline<T>(query: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> }, milliseconds = 10000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Account loading timed out')); }, milliseconds);
    });
    return await Promise.race([query.abortSignal ? query.abortSignal(controller.signal) : query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function profileReadFailure(error: unknown) {
  return { data: null, error: { message: error instanceof Error ? error.message : 'Account loading failed' } };
}
