import { NextRequest, NextResponse } from "next/server";

const signals: Map<string, Array<{ from: string; signal: string }>> = new Map();

export async function GET(request: NextRequest) {
  const peerId = request.nextUrl.searchParams.get("peerId") ?? "";
  const list = signals.get(peerId) ?? [];
  signals.set(peerId, []);
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
  if (!signals.has(to)) signals.set(to, []);
  signals.get(to)!.push({ from, signal });
  return NextResponse.json({ ok: true });
}
