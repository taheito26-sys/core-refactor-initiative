// Pure parsing of the vision model's answer, kept free of Deno APIs so the Vitest suite can import it.

export interface ScreenReading {
  temperature: number;
  setPoint: number | null;
}

const MIN_C = -60;
const MAX_C = 60;

const inRange = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= MIN_C && n <= MAX_C;

/** Rounds to the one decimal a reefer display shows. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * Accepts the model's reply, which should be one JSON object but may arrive wrapped in prose or a code
 * fence. Returns null unless the temperature is a believable number; the driver then types it instead.
 * A set point that is missing or out of range is dropped on its own without discarding the temperature.
 */
export function parseScreenReading(text: string): ScreenReading | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { readable?: unknown; temperature?: unknown; set_point?: unknown };
  if (o.readable === false) return null;
  if (!inRange(o.temperature)) return null;
  return { temperature: tenth(o.temperature), setPoint: inRange(o.set_point) ? tenth(o.set_point) : null };
}
