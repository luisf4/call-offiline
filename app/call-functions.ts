/**
 * Call na Vercel: usa API routes + Redis para sinalização.
 * Quando a conexão com a Vercel cai, as conexões P2P já estabelecidas continuam (áudio segue).
 */

const getApi = () => (typeof window !== "undefined" ? "" : "http://localhost:3000");

export function createPeerId(): string {
  return `peer-${Math.random().toString(36).slice(2, 11)}`;
}

export type SignalMessage =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: string | RTCIceCandidateInit };

export type PeerConnection = {
  addSignal: (msg: SignalMessage) => Promise<void>;
  close: () => void;
};

function parseSignal(raw: string): SignalMessage {
  return JSON.parse(raw) as SignalMessage;
}

export async function joinRoom(roomId: string, peerId: string): Promise<string[]> {
  const res = await fetch(`${getApi()}/api/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, peerId }),
  });
  if (!res.ok) throw new Error("Falha ao entrar na sala");
  return res.json();
}

export async function leaveRoom(roomId: string, peerId: string): Promise<void> {
  try {
    await fetch(`${getApi()}/api/room`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, peerId, action: "leave" }),
    });
  } catch (_) {}
}

async function getPeersInRoom(roomId: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${getApi()}/api/room?roomId=${encodeURIComponent(roomId)}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function sendSignal(
  from: string,
  to: string,
  signal: unknown
): Promise<void> {
  try {
    await fetch(`${getApi()}/api/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, signal: JSON.stringify(signal) }),
    });
  } catch (_) {}
}

async function getSignals(peerId: string): Promise<Array<{ from: string; signal: string }>> {
  try {
    const res = await fetch(
      `${getApi()}/api/signal?peerId=${encodeURIComponent(peerId)}`
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

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

  if (isInitiator) {
    (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(myId, otherId, { type: "offer", sdp: offer.sdp! });
    })();
  }

  return { addSignal, close: () => pc.close() };
}

export async function connectToPeers(
  myId: string,
  roomId: string,
  localStream: MediaStream,
  connections: Map<string, PeerConnection>,
  onRemoteStream: (peerId: string, stream: MediaStream) => void,
  onPeerLeft: (peerId: string) => void,
  onPeersChange: (peers: string[]) => void,
  onSignalingOnline: (online: boolean) => void,
  stopRef: { stop: boolean }
): Promise<void> {
  const closeConnection = (peerId: string) => {
    connections.get(peerId)?.close();
    connections.delete(peerId);
    onPeerLeft(peerId);
  };

  let hadSuccess = false;

  while (!stopRef.stop) {
    const peers = await getPeersInRoom(roomId);
    if (peers !== null) {
      hadSuccess = true;
      onSignalingOnline(true);
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

      for (const peerId of connections.keys()) {
        if (!peers.includes(peerId)) closeConnection(peerId);
      }

      const list = await getSignals(myId);
      for (const { from, signal } of list) {
        const msg = parseSignal(signal);
        const conn = connections.get(from);
        if (conn) conn.addSignal(msg);
      }
    } else {
      if (hadSuccess) onSignalingOnline(false);
    }

    await new Promise((r) => setTimeout(r, 800));
  }
}
