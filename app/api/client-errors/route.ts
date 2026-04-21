import { NextRequest, NextResponse } from "next/server";
import { ErrorReport, isErrorReportType, sanitizeErrorReport } from "@/lib/error-monitor-shared";
import {
  checkRateLimit,
  consumeRateLimit,
  getRequestFingerprint,
  rateLimitError,
  RateLimitConfig,
} from "@/lib/server-auth";

const MAX_REPORTS_PER_REQUEST = 10;
const MAX_BODY_BYTES = 100_000;
const CLIENT_ERROR_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 60,
  windowMs: 60 * 1_000,
  blockMs: 60 * 1_000,
  message: "错误上报过于频繁，请稍后再试",
};

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "请求体过大" }, { status: 413 });
  }

  const rateLimitKey = `client-errors:${getRequestFingerprint(request)}`;
  if (checkRateLimit(rateLimitKey, CLIENT_ERROR_RATE_LIMIT).limited) {
    return rateLimitError(CLIENT_ERROR_RATE_LIMIT);
  }
  consumeRateLimit(rateLimitKey, CLIENT_ERROR_RATE_LIMIT);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  if (!isRecord(body) || !Array.isArray(body.reports)) {
    return NextResponse.json({ error: "请求体必须包含 reports 数组" }, { status: 400 });
  }

  if (body.reports.length > MAX_REPORTS_PER_REQUEST) {
    return NextResponse.json({ error: "单次上报过多" }, { status: 413 });
  }

  const reports: ErrorReport[] = [];
  for (const candidate of body.reports) {
    const report = parseReport(candidate, request);
    if (!report) {
      return NextResponse.json({ error: "错误报告格式无效" }, { status: 400 });
    }
    reports.push(sanitizeErrorReport(report));
  }

  if (reports.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[ClientErrors]", JSON.stringify({ count: reports.length, reports }));
  }

  return NextResponse.json({ success: true, count: reports.length });
}

function parseReport(candidate: unknown, request: NextRequest): ErrorReport | null {
  if (!isRecord(candidate)) return null;
  if (!isErrorReportType(candidate.type) || typeof candidate.message !== "string") return null;

  const timestamp = typeof candidate.timestamp === "number" && Number.isFinite(candidate.timestamp)
    ? candidate.timestamp
    : Date.now();
  const userAgent = typeof candidate.userAgent === "string"
    ? candidate.userAgent
    : request.headers.get("user-agent") ?? "unknown";

  return {
    type: candidate.type,
    message: candidate.message,
    stack: typeof candidate.stack === "string" ? candidate.stack : undefined,
    url: typeof candidate.url === "string" ? candidate.url : "/",
    timestamp,
    userAgent,
    context: isRecord(candidate.context) ? candidate.context : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
