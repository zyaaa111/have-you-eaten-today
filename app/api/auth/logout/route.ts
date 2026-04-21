import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { clearSessionCookie, getSessionTokenFromRequest } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const token = getSessionTokenFromRequest(request);
  if (token) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
