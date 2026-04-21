import { NextRequest } from "next/server";
import { db } from "@/lib/db-server";
import { requireSpaceMembership } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_000;

function getCurrentCursor(spaceId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_logs WHERE space_id = ?")
    .get(spaceId) as { cursor: number } | undefined;
  return row?.cursor ?? 0;
}

function encodeEvent(type: string, payload: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  const auth = requireSpaceMembership(request, request.nextUrl.searchParams.get("space_id"));
  if ("response" in auth) return auth.response;
  const spaceId = auth.membership.space.id;

  let cursor = Math.max(0, Number(request.nextUrl.searchParams.get("cursor") || 0));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (pollTimer) clearInterval(pollTimer);
        controller.close();
      };

      request.signal.addEventListener("abort", cleanup);

      controller.enqueue(
        encoder.encode(
          encodeEvent("hello", {
            cursor: getCurrentCursor(spaceId),
          })
        )
      );

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            encodeEvent("heartbeat", {
              ts: Date.now(),
            })
          )
        );
      }, HEARTBEAT_MS);

      pollTimer = setInterval(() => {
        if (closed) return;

        const rows = db.prepare(
          `SELECT seq, table_name
           FROM change_logs
           WHERE space_id = ? AND seq > ?
           ORDER BY seq ASC
           LIMIT 200`
        ).all(spaceId, cursor) as Array<{ seq: number; table_name: string }>;

        if (rows.length === 0) {
          return;
        }

        cursor = rows[rows.length - 1]!.seq;
        const tables = Array.from(new Set(rows.map((row) => row.table_name)));
        controller.enqueue(
          encoder.encode(
            encodeEvent("change", {
              cursor,
              tables,
            })
          )
        );
      }, POLL_MS);
    },
    cancel() {
      // no-op: request abort handler performs cleanup
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
