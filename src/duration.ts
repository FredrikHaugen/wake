const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
type Unit = keyof typeof UNIT_MS;

const WHOLE = /^(\d+(\.\d+)?[smhd])+$/;
const PART = /(\d+(?:\.\d+)?)([smhd])/g;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Milliseconds for a text like `1h30m`, or null unless it is a positive duration. */
export function parseDuration(text: string): number | null {
  const compact = text.replace(/\s+/g, '').toLowerCase();
  if (!WHOLE.test(compact)) return null;
  let total = 0;
  for (const [, amount, unit] of compact.matchAll(PART)) {
    total += Number(amount) * UNIT_MS[unit as Unit];
  }
  total = Math.round(total);
  return total > 0 ? total : null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `MM:SS` under an hour, else `H:MM:SS`; negatives show `00:00`. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Like `1d 1h 1m 1s`, zero parts dropped, `0s` for zero. */
export function formatHuman(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const parts: [number, string][] = [
    [Math.floor(s / 86_400), 'd'],
    [Math.floor((s % 86_400) / 3600), 'h'],
    [Math.floor((s % 3600) / 60), 'm'],
    [s % 60, 's'],
  ];
  const shown = parts.filter(([n]) => n > 0).map(([n, u]) => `${n}${u}`);
  return shown.length > 0 ? shown.join(' ') : '0s';
}

/** Local `HH:MM`, prefixed with the weekday when `endMs` is on another day than `nowMs`. */
export function formatEndTime(endMs: number, nowMs: number): string {
  const end = new Date(endMs);
  const now = new Date(nowMs);
  const clock = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  const sameDay =
    end.getFullYear() === now.getFullYear() &&
    end.getMonth() === now.getMonth() &&
    end.getDate() === now.getDate();
  return sameDay ? clock : `${WEEKDAYS[end.getDay()]} ${clock}`;
}
