import {
  DEFAULT_ERROR_MONITOR_ENDPOINT,
  ErrorReport,
  ErrorReportInput,
  sanitizeErrorReport,
} from "./error-monitor-shared";

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000;
const MAX_QUEUE_SIZE = 50;

let queue: ErrorReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let endpoint: string | null = null;
let initialized = false;
let listeners:
  | {
      error: (event: ErrorEvent) => void;
      unhandledrejection: (event: PromiseRejectionEvent) => void;
      beforeunload: () => void;
    }
  | null = null;

export function initErrorMonitor(options?: { endpoint?: string | null }): void {
  if (typeof window === "undefined") return;

  endpoint = normalizeEndpoint(options?.endpoint ?? DEFAULT_ERROR_MONITOR_ENDPOINT);
  if (initialized) return;

  const handleError = (event: ErrorEvent) => {
    reportError({
      type: "error",
      message: event.message,
      stack: event.error?.stack,
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportError({
      type: "unhandledrejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };

  const handleBeforeUnload = () => {
    if (queue.length > 0 && endpoint) {
      const batch = queue.splice(0, BATCH_SIZE).map(sanitizeErrorReport);
      try {
        const blob = new Blob([JSON.stringify({ reports: batch })], { type: "application/json" });
        navigator.sendBeacon?.(endpoint, blob);
      } catch {
        // 页面卸载阶段无法可靠重试，静默丢弃。
      }
    }
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  window.addEventListener("beforeunload", handleBeforeUnload);
  listeners = {
    error: handleError,
    unhandledrejection: handleUnhandledRejection,
    beforeunload: handleBeforeUnload,
  };
  initialized = true;
}

export function reportError(report: ErrorReportInput): void {
  if (typeof window === "undefined") {
    const serverReport = sanitizeErrorReport({
      ...report,
      timestamp: report.timestamp ?? Date.now(),
      userAgent: report.userAgent ?? "server",
      url: report.url ?? "/",
    });
    // eslint-disable-next-line no-console
    console.error("[ErrorMonitor]", serverReport.type, serverReport.message, serverReport.context ?? "");
    return;
  }

  const fullReport = sanitizeErrorReport({
    ...report,
    timestamp: report.timestamp ?? Date.now(),
    userAgent: report.userAgent ?? navigator.userAgent,
    url: report.url ?? window.location.href,
  });

  // eslint-disable-next-line no-console
  console.error(`[ErrorMonitor:${fullReport.type}]`, fullReport.message, fullReport.context ?? "");

  queue.push(fullReport);

  if (queue.length > MAX_QUEUE_SIZE) {
    queue = queue.slice(-MAX_QUEUE_SIZE);
  }

  scheduleFlush();
}

export function reportSyncError(message: string, context?: Record<string, unknown>): void {
  reportError({ type: "sync", message, context });
}

export function reportApiError(message: string, context?: Record<string, unknown>): void {
  reportError({ type: "api", message, context });
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_INTERVAL_MS);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;
  if (!endpoint) {
    // 未配置上报端点，仅保留在内存队列中（最多保留最近 50 条）
    return;
  }

  const batch = queue.splice(0, BATCH_SIZE).map(sanitizeErrorReport);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reports: batch }),
      keepalive: true,
    });
    if (!response.ok && response.status >= 500) {
      throw new Error(`Error monitor endpoint returned ${response.status}`);
    }
  } catch {
    queue.push(...batch);
    if (queue.length > MAX_QUEUE_SIZE) {
      queue = queue.slice(-MAX_QUEUE_SIZE);
    }
  }
}

function normalizeEndpoint(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function __resetErrorMonitorForTests(): void {
  if (typeof window !== "undefined" && listeners) {
    window.removeEventListener("error", listeners.error);
    window.removeEventListener("unhandledrejection", listeners.unhandledrejection);
    window.removeEventListener("beforeunload", listeners.beforeunload);
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  queue = [];
  flushTimer = null;
  endpoint = null;
  initialized = false;
  listeners = null;
}
