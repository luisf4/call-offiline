/**
 * Servidor de sinalização local – roda na rede (ex: node scripts/signaling-server.js).
 * Não precisa de internet. Uma pessoa da rede executa e todos conectam no IP dessa máquina.
 * Ex: ws://192.168.1.10:4000
 */
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.SIGNALING_PORT) || 4000;
const wss = new WebSocketServer({ port: PORT });

const peerToSocket = new Map(); // peerId -> WebSocket
const roomToPeers = new Map();  // roomId -> Set(peerId)

function getPeersInRoom(roomId) {
  const set = roomToPeers.get(roomId);
  return set ? Array.from(set) : [];
}

function broadcastToRoom(roomId, message, excludePeerId = null) {
  const peers = getPeersInRoom(roomId);
  const payload = JSON.stringify(message);
  for (const peerId of peers) {
    if (peerId === excludePeerId) continue;
    const ws = peerToSocket.get(peerId);
    if (ws && ws.readyState === 1) ws.send(payload);
  }
}

wss.on("connection", (ws, req) => {
  let myPeerId = null;
  let myRoomId = null;

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "join" && msg.roomId && msg.peerId) {
        myPeerId = msg.peerId;
        myRoomId = msg.roomId;
        peerToSocket.set(msg.peerId, ws);
        if (!roomToPeers.has(msg.roomId)) roomToPeers.set(msg.roomId, new Set());
        roomToPeers.get(msg.roomId).add(msg.peerId);

        const peers = getPeersInRoom(msg.roomId);
        ws.send(JSON.stringify({ type: "peers", peers }));
        broadcastToRoom(msg.roomId, { type: "peers", peers }, msg.peerId);
      } else if (msg.type === "leave" && msg.roomId && msg.peerId) {
        const room = roomToPeers.get(msg.roomId);
        if (room) {
          room.delete(msg.peerId);
          if (room.size === 0) roomToPeers.delete(msg.roomId);
        }
        peerToSocket.delete(msg.peerId);
        broadcastToRoom(msg.roomId, { type: "peers", peers: getPeersInRoom(msg.roomId) });
      } else if (msg.type === "signal" && msg.from && msg.to && msg.signal !== undefined) {
        const target = peerToSocket.get(msg.to);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: "signal", from: msg.from, signal: msg.signal }));
        }
      }
    } catch (e) {
      console.error("Message error:", e);
    }
  });

  ws.on("close", () => {
    if (myPeerId) {
      peerToSocket.delete(myPeerId);
      if (myRoomId) {
        const room = roomToPeers.get(myRoomId);
        if (room) {
          room.delete(myPeerId);
          if (room.size === 0) roomToPeers.delete(myRoomId);
          broadcastToRoom(myRoomId, { type: "peers", peers: getPeersInRoom(myRoomId) });
        }
      }
    }
  });
});

wss.on("listening", () => {
  console.log(`Signaling server: ws://0.0.0.0:${PORT}`);
  console.log("Na rede local use o IP desta máquina, ex: ws://192.168.1.x:4000");
});
