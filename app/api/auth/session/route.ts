import { NextRequest, NextResponse } from "next/server";
import { getAuthSessionPayload, getSessionUser } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json(getAuthSessionPayload(""));
  }
  return NextResponse.json(getAuthSessionPayload(user.id));
}
