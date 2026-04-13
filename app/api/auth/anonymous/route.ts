import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export async function POST() {
  const userId = uuidv4();
  return NextResponse.json({ userId });
}
