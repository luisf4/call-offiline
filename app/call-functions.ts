const API = typeof window !== "undefined" ? "" : "http://localhost:3000";

export function createPeerId(): string {
  return `peer-${Math.random().toString(36).slice(2, 11)}`;
}

export async function joinRoom(roomId: string, peerId: string): Promise<string[]> {
  const res = await fetch(`${API}/api/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, peerId }),
  });
  if (!res.ok) throw new Error("Failed to join room");
  return res.json();
}

export async function leaveRoom(roomId: string, peerId: string): Promise<void> {
  await fetch(`${API}/api/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, peerId, action: "leave" }),
  });
}

export async function getPeersInRoom(roomId: string): Promise<string[]> {
  const res = await fetch(`${API}/api/room?roomId=${encodeURIComponent(roomId)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function sendSignal(
  from: string,
  to: string,
  signal: unknown
): Promise<void> {
  await fetch(`${API}/api/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, signal: JSON.stringify(signal) }),
  });
}

export async function getSignals(
  peerId: string
): Promise<Array<{ from: string; signal: string }>> {
  const res = await fetch(
    `${API}/api/signal?peerId=${encodeURIComponent(peerId)}`
  );
  if (!res.ok) return [];
  return res.json();
}

export type SignalMessage =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: string | RTCIceCandidateInit };

function parseSignal(raw: string): SignalMessage {
  return JSON.parse(raw) as SignalMessage;
}

export type PeerConnection = {
  addSignal: (msg: SignalMessage) => Promise<void>;
  close: () => void;
};

export function createPeerConnection(
  myId: string,
  otherId: string,
  isInitiator: boolean,
  localStream: MediaStream,
  onRemoteStream: (peerId: string, stream: MediaStream) => void,
  onClose: (peerId: string) => void
): PeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  pc.ontrack = (e) => {
    if (e.streams[0]) onRemoteStream(otherId, e.streams[0]);
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed")
      onClose(otherId);
  };
  pc.onicecandidate = (e) => {
    if (e.candidate)
      sendSignal(myId, otherId, { type: "candidate", candidate: e.candidate.toJSON() });
  };

  const addSignal = async (msg: SignalMessage) => {
    try {
      if (msg.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(myId, otherId, { type: "answer", sdp: answer.sdp! });
      } else if (msg.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp }));
      } else if (msg.type === "candidate") {
        const c = typeof msg.candidate === "string" ? JSON.parse(msg.candidate) : msg.candidate;
        await pc.addIceCandidate(new RTCIceCandidate(c));
      }
    } catch (err) {
      console.error("Signal error:", err);
    }
  };

  const close = () => {
    pc.close();
  };

  if (isInitiator) {
    (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(myId, otherId, { type: "offer", sdp: offer.sdp! });
    })();
  }

  return { addSignal, close };
}

export async function connectToPeers(
  myId: string,
  roomId: string,
  localStream: MediaStream,
  connections: Map<string, PeerConnection>,
  onRemoteStream: (peerId: string, stream: MediaStream) => void,
  onPeerLeft: (peerId: string) => void,
  onPeersChange: (peers: string[]) => void,
  stopRef: { stop: boolean }
): Promise<void> {
  const closeConnection = (peerId: string) => {
    connections.get(peerId)?.close();
    connections.delete(peerId);
    onPeerLeft(peerId);
  };

  while (!stopRef.stop) {
    const peers = await getPeersInRoom(roomId);
    onPeersChange(peers);

    for (const peerId of peers) {
      if (peerId === myId) continue;
      if (connections.has(peerId)) continue;
      const isInitiator = myId < peerId;
      const conn = createPeerConnection(
        myId,
        peerId,
        isInitiator,
        localStream,
        onRemoteStream,
        closeConnection
      );
      connections.set(peerId, conn);
    }

    // remove connections for peers that left
    for (const peerId of connections.keys()) {
      if (!peers.includes(peerId)) closeConnection(peerId);
    }

    // handle incoming signals (offers, answers, ICE)
    const list = await getSignals(myId);
    for (const { from, signal } of list) {
      const msg = parseSignal(signal);
      const conn = connections.get(from);
      if (conn) conn.addSignal(msg);
    }

    await new Promise((r) => setTimeout(r, 800));
  }
}
