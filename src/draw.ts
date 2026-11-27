export const GRADIENT: readonly number[] = [57, 63, 69, 75, 81, 87];

const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function paint(text: string, color: number, enabled: boolean): string {
  return enabled ? `\x1b[38;5;${color}m${text}\x1b[0m` : text;
}

export function dim(text: string, enabled: boolean): string {
  return enabled ? `\x1b[2m${text}\x1b[0m` : text;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

const PARTIAL_CELLS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

export function renderBar(fraction: number, width: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const eighths = Math.floor(clamped * width * 8);
  const whole = Math.floor(eighths / 8);
  const partial = PARTIAL_CELLS[eighths % 8];
  return '█'.repeat(whole) + partial + '░'.repeat(width - whole - partial.length);
}

const COMET = '▒▓█▓▒';

export function renderSweep(tick: number, width: number): string {
  const start = (tick % (width + COMET.length)) - COMET.length;
  let line = '';
  for (let cell = 0; cell < width; cell++) {
    const index = cell - start;
    line += index >= 0 && index < COMET.length ? COMET[index] : '░';
  }
  return line;
}

// Colours a bar or sweep by runs of cells: filled cells take their gradient
// colour, the comet takes the last one, and the `░` track is dimmed.
export function colourBar(bar: string, fraction: number | null, color: boolean): string {
  if (!color) return bar;
  const cells = [...bar];
  let out = '';
  let run = '';
  let runKey: number | null = null;
  const flush = () => {
    if (run === '') return;
    out += runKey === null ? dim(run, true) : paint(run, runKey, true);
    run = '';
  };
  cells.forEach((cell, i) => {
    const key =
      cell === '░'
        ? null
        : fraction === null
          ? GRADIENT[GRADIENT.length - 1]
          : GRADIENT[Math.floor((i * GRADIENT.length) / cells.length)];
    if (key !== runKey) flush();
    runKey = key;
    run += cell;
  });
  flush();
  return out;
}

const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  ':': ['.', '#', '.', '#', '.'],
};

export function bigText(text: string): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 5; row++) {
    rows.push(
      [...text]
        .map((char) => FONT[char][row].replace(/#/g, '██').replace(/\./g, '  '))
        .join('  '),
    );
  }
  return rows;
}
