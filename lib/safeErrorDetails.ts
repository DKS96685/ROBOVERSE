const secretAssignment = /\b(password|secret|token|authorization|api[_-]?key|database[_-]?url|connection[_-]?string)\b\s*[:=]\s*[^\s,;]+/gi;
const databaseUrl = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi;

function redactString(value: string) {
  return value
    .replace(databaseUrl, '[REDACTED_DATABASE_URL]')
    .replace(secretAssignment, '$1=[REDACTED]');
}

export function safeErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { message: redactString(String(error)) };
  }

  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    clientVersion?: unknown;
    meta?: unknown;
  };
  const details: Record<string, unknown> = {};
  if (typeof candidate.name === 'string') details.name = candidate.name;
  if (typeof candidate.code === 'string') details.code = candidate.code;
  if (typeof candidate.clientVersion === 'string') details.clientVersion = candidate.clientVersion;
  if (typeof candidate.message === 'string') details.message = redactString(candidate.message);

  if (candidate.meta && typeof candidate.meta === 'object' && !Array.isArray(candidate.meta)) {
    details.meta = Object.fromEntries(
      Object.entries(candidate.meta as Record<string, unknown>).map(([key, value]) => [
        key,
        /password|secret|token|authorization|api[_-]?key|url|connection/i.test(key)
          ? '[REDACTED]'
          : typeof value === 'string' ? redactString(value) : value,
      ])
    );
  }
  return details;
}
