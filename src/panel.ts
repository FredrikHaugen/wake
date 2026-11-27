import { GRADIENT, colourBar, dim, paint, renderBar } from './draw.ts';
import type { Stats } from './stats.ts';

export type Meter = {
  label: string;
  fraction: number;
  value: string;
  note: string;
  group: 'load' | 'memory' | 'temperature';
  /** Lower ranks survive longest when the box is too short for every row. */
  rank: number;
};

const MIN_BAR = 8;
// A temperature bar is empty at 20°C and full at 100°C.
const TEMP_FLOOR = 20;
const TEMP_SPAN = 80;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** Binary gigabytes, like Activity Monitor: `32.00 GB`, `128.0 GB`. */
export function formatGb(bytes: number): string {
  const gb = bytes / 2 ** 30;
  return `${gb.toFixed(gb < 100 ? 2 : 1)} GB`;
}

/** One meter per reading this Mac gave, in display order. */
export function buildMeters(stats: Stats): Meter[] {
  const meters: Meter[] = [];
  const add = (group: Meter['group'], rank: number, label: string, fraction: number, value: string, note = '') => {
    meters.push({ label, fraction: clamp01(fraction), value, note, group, rank });
  };

  const cpu = clamp01(stats.cpu);
  add('load', 0, 'cpu', cpu, percent(cpu));
  if (stats.gpu !== null) add('load', 2, 'gpu', stats.gpu, percent(clamp01(stats.gpu)));

  const memory = stats.memory;
  if (memory !== null) {
    const share = (bytes: number) => (memory.physical > 0 ? bytes / memory.physical : 0);
    const hasSwap = memory.swapTotal > 0;
    add('memory', 1, 'memory used', share(memory.used), formatGb(memory.used), `of ${formatGb(memory.physical)}`);
    add('memory', 6, '  app memory', share(memory.app), formatGb(memory.app));
    add('memory', 7, '  wired memory', share(memory.wired), formatGb(memory.wired));
    add('memory', 8, '  compressed', share(memory.compressed), formatGb(memory.compressed));
    add('memory', 5, 'cached files', share(memory.cached), formatGb(memory.cached));
    add(
      'memory', 4, 'swap used',
      hasSwap ? memory.swapUsed / memory.swapTotal : 0,
      formatGb(memory.swapUsed),
      hasSwap ? `of ${formatGb(memory.swapTotal)}` : '',
    );
  }

  const temp = (rank: number, label: string, celsius: number | null | undefined) => {
    if (celsius === null || celsius === undefined) return;
    add('temperature', rank, label, (celsius - TEMP_FLOOR) / TEMP_SPAN, `${Math.round(celsius)}°C`);
  };
  temp(3, 'chip temp', stats.temps?.chip);
  temp(9, 'battery temp', stats.temps?.battery);
  temp(10, 'ssd temp', stats.temps?.ssd);
  return meters;
}

/**
 * Lays the meters out as labelled bars in a box of `cols` by `rows`: at most
 * `rows` lines, none wider than `cols - 2`, or nothing when the box is too small.
 * The first line of the box always stays empty.
 */
export function renderPanel(stats: Stats, cols: number, rows: number, color: boolean): string[] {
  const budget = rows - 1;
  if (budget < 2) return [];

  const all = buildMeters(stats);
  let shown = all;
  if (all.length > budget) {
    const kept = new Set([...all].sort((a, b) => a.rank - b.rank).slice(0, budget));
    shown = all.filter((meter) => kept.has(meter));
  }

  const labelWidth = Math.max(...shown.map((meter) => meter.label.length));
  const valueWidth = Math.max(...shown.map((meter) => meter.value.length));
  let noteWidth = Math.max(...shown.map((meter) => meter.note.length));
  const barFor = (notes: number) => cols - 8 - labelWidth - valueWidth - (notes > 0 ? notes + 2 : 0);
  let barWidth = barFor(noteWidth);
  if (barWidth < MIN_BAR) {
    noteWidth = 0;
    barWidth = barFor(0);
  }
  if (barWidth < MIN_BAR) return [];

  const groups = new Set(shown.map((meter) => meter.group)).size;
  const gapped = shown.length === all.length && shown.length + groups - 1 <= budget;
  const content: string[] = [];
  shown.forEach((meter, i) => {
    if (gapped && i > 0 && meter.group !== shown[i - 1].group) content.push('');
    // Rows run down the gradient the way the clock's rows do.
    const hue = GRADIENT[Math.floor((i * GRADIENT.length) / shown.length)];
    const label = paint(meter.label.padEnd(labelWidth), hue, color);
    const bar = colourBar(renderBar(meter.fraction, barWidth), meter.fraction, color);
    const value = paint(meter.value.padStart(valueWidth), hue, color);
    const note = noteWidth > 0 && meter.note !== '' ? '  ' + dim(meter.note, color) : '';
    content.push('  ' + (meter.label.startsWith(' ') ? dim(label, color) : label) + '  ' + bar + '  ' + value + note);
  });

  const top = 1 + Math.floor((budget - content.length) / 2);
  return [...Array.from({ length: top }, () => ''), ...content];
}
