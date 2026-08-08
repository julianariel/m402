import { styleText } from 'node:util';

export type OutputOptions = {
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
};

type Color = 'cyan' | 'gray' | 'green' | 'red' | 'yellow';

function canStyle(stream: NodeJS.WriteStream, options: OutputOptions): boolean {
  return Boolean(
    stream.isTTY &&
      !options.noColor &&
      !process.env['NO_COLOR'] &&
      process.env['TERM'] !== 'dumb',
  );
}

function color(text: string, format: Color, stream: NodeJS.WriteStream, options: OutputOptions): string {
  return canStyle(stream, options) ? styleText(format, text) : text;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

export class Output {
  readonly options: OutputOptions;

  constructor(options: OutputOptions = {}) {
    this.options = options;
  }

  info(message: string): void {
    if (!this.options.quiet && !this.options.json) process.stderr.write(`${message}\n`);
  }

  success(message: string): void {
    if (!this.options.quiet && !this.options.json) {
      process.stderr.write(`${color(message, 'green', process.stderr, this.options)}\n`);
    }
  }

  warn(message: string): void {
    if (!this.options.quiet && !this.options.json) {
      process.stderr.write(`${color(message, 'yellow', process.stderr, this.options)}\n`);
    }
  }

  error(message: string): void {
    process.stderr.write(`${color(message, 'red', process.stderr, this.options)}\n`);
  }

  data(value: unknown): void {
    if (this.options.json) {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    } else if (typeof value === 'string') {
      process.stdout.write(value);
    }
  }

  spinner(label: string): Spinner {
    return new Spinner(label, this.options);
  }
}

export class Spinner {
  private readonly startedAt = Date.now();
  private readonly frames = ['-', '\\', '|', '/'];
  private frame = 0;
  private timer?: NodeJS.Timeout;
  private label: string;
  private readonly enabled: boolean;

  constructor(label: string, private readonly options: OutputOptions) {
    this.label = label;
    this.enabled = Boolean(process.stderr.isTTY && !options.json && !options.quiet);
    if (this.enabled) {
      this.render();
      this.timer = setInterval(() => this.render(), 100);
    } else if (!options.json && !options.quiet) {
      process.stderr.write(`${label}...\n`);
    }
  }

  update(label: string): void {
    this.label = label;
    if (this.enabled) this.render();
  }

  stop(finalLabel?: string): void {
    if (this.timer) clearInterval(this.timer);
    if (!this.enabled) return;
    process.stderr.write('\r\x1b[2K');
    if (finalLabel) process.stderr.write(`${finalLabel}\n`);
  }

  private render(): void {
    const elapsed = formatDuration(Date.now() - this.startedAt);
    process.stderr.write(
      `\r\x1b[2K${color(this.frames[this.frame++ % this.frames.length]!, 'cyan', process.stderr, this.options)} ` +
        `${this.label} ${color(elapsed, 'gray', process.stderr, this.options)}`,
    );
  }
}
