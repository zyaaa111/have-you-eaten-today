export const DEFAULT_ERROR_MONITOR_ENDPOINT = "/api/client-errors";

export type ErrorReportType = "error" | "unhandledrejection" | "sync" | "api" | "custom";

export interface ErrorReport {
  type: ErrorReportType;
  message: string;
  stack?: string;
  url: string;
  timestamp: number;
  userAgent: string;
  context?: Record<string, unknown>;
}

export type ErrorReportInput =
  Omit<ErrorReport, "timestamp" | "userAgent" | "url"> &
  Partial<Pick<ErrorReport, "timestamp" | "userAgent" | "url">>;

type SanitizedValue = string | number | boolean | null | SanitizedValue[] | { [key: string]: SanitizedValue };

const ALLOWED_TYPES = new Set<ErrorReportType>(["error", "unhandledrejection", "sync", "api", "custom"]);
const URL_QUERY_ALLOWLIST = ["mode"] as const;
const SENSITIVE_KEY_PATTERN = /token|password|secret|email|authorization|cookie/i;
const SENSITIVE_QUERY_PATTERN = /([?&])(?:token|password|secret|email|authorization|cookie)=[^&\s"']*/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const MAX_STRING_LENGTH = 1_000;
const MAX_STACK_LENGTH = 4_000;
const MAX_URL_LENGTH = 500;
const MAX_USER_AGENT_LENGTH = 300;
const MAX_OBJECT_KEYS = 20;
const MAX_ARRAY_ITEMS = 10;
const MAX_DEPTH = 3;

export function isErrorReportType(value: unknown): value is ErrorReportType {
  return typeof value === "string" && ALLOWED_TYPES.has(value as ErrorReportType);
}

export function sanitizeErrorReport(report: ErrorReport): ErrorReport {
  const sanitized: ErrorReport = {
    type: isErrorReportType(report.type) ? report.type : "custom",
    message: sanitizeString(report.message, MAX_STRING_LENGTH),
    url: sanitizeUrl(report.url),
    timestamp: Number.isFinite(report.timestamp) ? report.timestamp : Date.now(),
    userAgent: sanitizeString(report.userAgent, MAX_USER_AGENT_LENGTH),
  };

  if (report.stack) {
    sanitized.stack = sanitizeString(report.stack, MAX_STACK_LENGTH);
  }

  const context = sanitizeContext(report.context);
  if (context && Object.keys(context).length > 0) {
    sanitized.context = context;
  }

  return sanitized;
}

export function sanitizeUrl(value: string | undefined): string {
  if (!value) return "/";

  try {
    const parsed = new URL(value, "http://localhost");
    const params = new URLSearchParams();
    for (const key of URL_QUERY_ALLOWLIST) {
      const allowedValue = parsed.searchParams.get(key);
      if (allowedValue !== null) {
        params.set(key, sanitizeString(allowedValue, 100));
      }
    }
    const query = params.toString();
    return truncateString(`${parsed.pathname}${query ? `?${query}` : ""}`, MAX_URL_LENGTH);
  } catch {
    const pathOnly = value.split(/[?#]/)[0] || "/";
    return truncateString(pathOnly, MAX_URL_LENGTH);
  }
}

export function sanitizeContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const sanitized = sanitizeValue(context, 0);
  return isPlainRecord(sanitized) ? sanitized : undefined;
}

export function sanitizeValue(value: unknown, depth = 0): SanitizedValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return sanitizeString(value, MAX_STRING_LENGTH);
  if (typeof value === "bigint") return sanitizeString(value.toString(), MAX_STRING_LENGTH);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return null;
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push("[TRUNCATED]");
    }
    return items;
  }

  if (!isPlainRecord(value)) {
    return sanitizeString(String(value), MAX_STRING_LENGTH);
  }

  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const result: Record<string, SanitizedValue> = {};
  let redactedKeyCount = 0;

  for (const [key, entryValue] of entries) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[`redacted${redactedKeyCount}`] = "[REDACTED]";
      redactedKeyCount += 1;
      continue;
    }
    result[truncateString(key, 100)] = sanitizeValue(entryValue, depth + 1);
  }

  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    result.truncated = true;
  }

  return result;
}

function sanitizeString(value: string, maxLength: number): string {
  const redacted = value
    .replace(SENSITIVE_QUERY_PATTERN, "$1redacted=[REDACTED]")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(EMAIL_PATTERN, "[REDACTED]");
  return truncateString(redacted, maxLength);
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[TRUNCATED]`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
