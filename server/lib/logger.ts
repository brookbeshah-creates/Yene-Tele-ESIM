export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_PATTERN =
  /secret|password|token|authorization|apikey|api_key|private|encryption|qrpayload|activationcode|lpauri|credential|cookie|fayda|fan|fullname|full_name|phonenumber|phone_number|contactphone|email/i;

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]';
    if (value.startsWith('LPA:1$')) return 'LPA:1$[REDACTED]';
    return value.length > 500 ? `${value.slice(0, 500)}...[TRUNCATED]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function redactForLog(value: unknown): unknown {
  return redactValue(value);
}

export class StructuredLogger {
  private readonly minRank: number;

  constructor(level: LogLevel = 'info') {
    this.minRank = LEVEL_RANK[level] ?? LEVEL_RANK.info;
  }

  public log(level: LogLevel, event: string, context?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < this.minRank) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      service: 'yene-tele',
      event,
      ...(context ? (redactValue(context) as Record<string, unknown>) : {}),
    };
    const line = JSON.stringify(payload);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  public debug(event: string, context?: Record<string, unknown>): void {
    this.log('debug', event, context);
  }

  public info(event: string, context?: Record<string, unknown>): void {
    this.log('info', event, context);
  }

  public warn(event: string, context?: Record<string, unknown>): void {
    this.log('warn', event, context);
  }

  public error(event: string, context?: Record<string, unknown>): void {
    this.log('error', event, context);
  }
}
