/**
 * Call com servidor de sinalização WebSocket (um processo só = estado consistente).
 * Na Vercel a memória das API routes não é compartilhada, então conecta/desconecta e áudio
 * só funcionam de forma estável usando o servidor local: npm run signaling
 */

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

export type WsSignaling = {
  joinRoom: (roomId: string, peerId: string) => Promise<string[]>;
  leaveRoom: (roomId: string, peerId: string) => void;
  sendSignal: (from: string, to: string, signal: unknown) => void;
  onPeers: (cb: (peers: string[]) => void) => void;
  onSignal: (cb: (from: string, signal: string) => void) => void;
  onDisconnect: (cb: () => void) => void;
  onReconnect: (cb: () => void) => void;
  isConnected: () => boolean;
  close: () => void;
};

export function createWsSignaling(wsUrl: string): WsSignaling {
  let ws: WebSocket | null = null;
  let peersCb: ((peers: string[]) => void) | null = null;
  let signalCb: ((from: string, signal: string) => void) | null = null;
  let disconnectCb: (() => void) | null = null;
  let reconnectCb: (() => void) | null = null;
  let joinResolve: ((peers: string[]) => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => reconnectCb?.();
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "peers") {
          const list = Array.isArray(msg.peers) ? msg.peers : [];
          if (joinResolve) {
            joinResolve(list);
            joinResolve = null;
          }
          peersCb?.(list);
        } else if (msg.type === "signal" && msg.from != null && msg.signal != null) {
          const sig = typeof msg.signal === "string" ? msg.signal : JSON.stringify(msg.signal);
          signalCb?.(msg.from, sig);
        }
      } catch (_) {}
    };
    ws.onclose = () => {
      ws = null;
      disconnectCb?.();
      scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  return {
    isConnected: () => ws?.readyState === WebSocket.OPEN,
    joinRoom(roomId: string, peerId: string): Promise<string[]> {
      connect();
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          if (joinResolve) {
            joinResolve = null;
            reject(new Error("Servidor não respondeu. Rode: npm run signaling"));
          }
        }, 10000);
        joinResolve = (peers) => {
          clearTimeout(t);
          joinResolve = null;
          resolve(peers);
        };
        const send = () => {
          if (ws?.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "join", roomId, peerId }));
        };
        if (ws?.readyState === WebSocket.OPEN) send();
        else ws?.addEventListener?.("open", send, { once: true });
      });
    },
    leaveRoom(roomId: string, peerId: string) {
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "leave", roomId, peerId }));
    },
    sendSignal(from: string, to: string, signal: unknown) {
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({
          type: "signal",
          from,
          to,
          signal: typeof signal === "string" ? signal : JSON.stringify(signal),
        }));
    },
    onPeers(cb: (peers: string[]) => void) { peersCb = cb; },
    onSignal(cb: (from: string, signal: string) => void) { signalCb = cb; },
    onDisconnect(cb: () => void) { disconnectCb = cb; },
    onReconnect(cb: () => void) { reconnectCb = cb; },
    close() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      ws?.close();
      ws = null;
    },
  };
}

function createPeerConnection(
  myId: string,
  otherId: string,
  isInitiator: boolean,
  localStream: MediaStream,
  sendSignalFn: (to: string, signal: unknown) => void,
  onRemoteStream: (peerId: string, stream: MediaStream) => void,
  onClose: (peerId: string) => void
): PeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  const iceQueue: RTCIceCandidateInit[] = [];
  const applyIceQueue = async () => {
    while (iceQueue.length > 0) {
      const c = iceQueue.shift()!;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (_) {}
    }
  };

  pc.ontrack = (e) => {
    if (e.streams[0]) onRemoteStream(otherId, e.streams[0]);
  };
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === "disconnected" || state === "failed" || state === "closed") onClose(otherId);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") onClose(otherId);
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignalFn(otherId, { type: "candidate", candidate: e.candidate.toJSON() });
  };

  const addSignal = async (msg: SignalMessage) => {
    try {
      if (msg.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp }));
        await applyIceQueue();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignalFn(otherId, { type: "answer", sdp: answer.sdp! });
      } else if (msg.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp }));
        await applyIceQueue();
      } else if (msg.type === "candidate") {
        const c = typeof msg.candidate === "string" ? JSON.parse(msg.candidate) : msg.candidate;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } else {
          iceQueue.push(c);
        }
      }
    } catch (err) {
      console.error("Signal error:", err);
    }
  };

  if (isInitiator) {
    (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignalFn(otherId, { type: "offer", sdp: offer.sdp! });
    })();
  }

  return { addSignal, close: () => pc.close() };
}

export function connectToPeersWithSignaling(
  myId: string,
  roomId: string,
  localStream: MediaStream,
  signaling: WsSignaling,
  connections: Map<string, PeerConnection>,
  onRemoteStream: (peerId: string, stream: MediaStream) => void,
  onPeerLeft: (peerId: string) => void,
  onPeersChange: (peers: string[]) => void,
  stopRef: { stop: boolean }
): () => void {
  const closeConnection = (peerId: string) => {
    connections.get(peerId)?.close();
    connections.delete(peerId);
    onPeerLeft(peerId);
  };

  signaling.onPeers((peers) => {
    if (stopRef.stop) return;
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
        (to, signal) => signaling.sendSignal(myId, to, signal),
        onRemoteStream,
        closeConnection
      );
      connections.set(peerId, conn);
    }
    for (const peerId of connections.keys()) {
      if (!peers.includes(peerId)) closeConnection(peerId);
    }
  });

  signaling.onSignal((from, signalStr) => {
    const msg = parseSignal(signalStr);
    const conn = connections.get(from);
    if (conn) conn.addSignal(msg);
  });

  return () => signaling.close();
}
