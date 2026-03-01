import { NextRequest, NextResponse } from "next/server";
import { roomGetPeers, roomAdd, roomRemove } from "@/lib/store";

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId") ?? "";
  const peers = roomId ? await roomGetPeers(roomId) : [];
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
    await roomRemove(roomId, peerId);
    return NextResponse.json({ ok: true });
  }
  const peers = await roomAdd(roomId, peerId);
  return NextResponse.json(peers);
}
