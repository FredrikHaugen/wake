import { GRADIENT, bigText, colourBar, dim, paint, renderBar, renderSweep } from './draw.ts';
import { renderPanel } from './panel.ts';
import type { Stats } from './stats.ts';

export type View = {
  clock: string;
  caption: string;
  fraction: number | null;
  tick: number;
  status: string;
};

const BIG_HEIGHT = 10;

function percent(fraction: number): string {
  return Math.floor(fraction * 100) + '%';
}

function makeBar(view: View, width: number, color: boolean): string {
  const bar = view.fraction === null ? renderSweep(view.tick, width) : renderBar(view.fraction, width);
  return colourBar(bar, view.fraction, color);
}

function bigFrame(view: View, big: string[], cols: number, rows: number, color: boolean): string[] {
  const lines: string[] = Array.from({ length: Math.floor((rows - BIG_HEIGHT) / 2) }, () => '');
  const indent = ' '.repeat(Math.floor((cols - big[0].length) / 2));
  big.forEach((row, r) => lines.push(indent + paint(row, GRADIENT[r], color)));
  lines.push('');
  const caption = view.caption.slice(0, cols - 1);
  lines.push(' '.repeat(Math.floor((cols - caption.length) / 2)) + dim(caption, color));
  lines.push('');
  lines.push('  ' + makeBar(view, cols - 4, color));
  const left = view.fraction === null ? '' : '  ' + percent(view.fraction);
  if (left.length + 1 + view.status.length <= cols - 2) {
    const gap = ' '.repeat(cols - 2 - left.length - view.status.length);
    lines.push(left + gap + dim(view.status, color));
  } else {
    lines.push(left);
  }
  return lines;
}

function compactFrame(view: View, cols: number, color: boolean): string[] {
  const pct = view.fraction === null ? '' : ' ' + percent(view.fraction).padStart(4);
  const barWidth = cols - 3 - view.clock.length - pct.length;
  if (barWidth >= 1) {
    return [' ' + view.clock + ' ' + makeBar(view, barWidth, color) + pct];
  }
  return [(' ' + view.clock).slice(0, Math.max(0, cols - 1))];
}

/** Whether the big clock layout fits: its ten rows, and the digits with a two-cell margin each side. */
export function fitsBig(clock: string, cols: number, rows: number): boolean {
  return rows >= BIG_HEIGHT && cols >= bigText(clock)[0].length + 4;
}

export function renderFrame(view: View, cols: number, rows: number, color: boolean): string[] {
  if (fitsBig(view.clock, cols, rows)) return bigFrame(view, bigText(view.clock), cols, rows, color);
  return compactFrame(view, cols, color);
}

/**
 * The clock frame in the upper half and the system panel in the lower half.
 * Falls back to the clock frame alone when there is no reading yet or no room
 * for both; under twenty rows the clock keeps its ten and the panel takes the rest.
 */
export function renderDashboard(view: View, stats: Stats | null, cols: number, rows: number, color: boolean): string[] {
  if (stats === null) return renderFrame(view, cols, rows, color);
  const top = Math.max(Math.floor(rows / 2), BIG_HEIGHT);
  if (!fitsBig(view.clock, cols, top)) return renderFrame(view, cols, rows, color);
  const panel = renderPanel(stats, cols, rows - top, color);
  if (panel.length === 0) return renderFrame(view, cols, rows, color);
  const clock = renderFrame(view, cols, top, color);
  return [...clock, ...Array.from({ length: top - clock.length }, () => ''), ...panel];
}

export function frameUpdate(prev: string[] | null, next: string[]): string {
  if (prev === null || prev.length !== next.length) {
    return '\x1b[H' + next.map((line) => line + '\x1b[K').join('\r\n') + '\x1b[J';
  }
  let out = '';
  next.forEach((line, i) => {
    if (line !== prev[i]) out += `\x1b[${i + 1};1H` + line + '\x1b[K';
  });
  return out;
}
