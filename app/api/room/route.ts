import { NextRequest, NextResponse } from "next/server";

const rooms = new Map<string, Set<string>>();

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId") ?? "";
  const peers = roomId ? Array.from(rooms.get(roomId) ?? []) : [];
  return NextResponse.json(peers);
}

export async function POST(request: NextRequest) {
  const { roomId, peerId, action } = await request.json();
  if (!roomId || !peerId) {
    return NextResponse.json(
      { error: "roomId and peerId required" },
      { status: 400 }
    );
  }
  if (action === "leave") {
    const room = rooms.get(roomId);
    if (room) {
      room.delete(peerId);
      if (room.size === 0) rooms.delete(roomId);
    }
    return NextResponse.json({ ok: true });
  }
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId)!.add(peerId);
  const peers = Array.from(rooms.get(roomId)!).filter((id) => id !== peerId);
  return NextResponse.json(peers);
}
