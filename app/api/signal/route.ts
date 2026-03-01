import { NextRequest, NextResponse } from "next/server";
import { signalPush, signalPopAll } from "@/lib/store";

export async function GET(request: NextRequest) {
  const peerId = request.nextUrl.searchParams.get("peerId") ?? "";
  const list = await signalPopAll(peerId);
  return NextResponse.json(list);
}

export async function POST(request: NextRequest) {
  const { from, to, signal } = await request.json();
  if (!from || !to || signal === undefined) {
    return NextResponse.json(
      { error: "from, to and signal required" },
      { status: 400 }
    );
  }
  await signalPush(to, from, signal);
  return NextResponse.json({ ok: true });
}
