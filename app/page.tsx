"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPeerId,
  joinRoom,
  leaveRoom,
  connectToPeers,
  type PeerConnection,
} from "./call-functions";

const ROOM_ID = "default";

export default function Home() {
  const [inCall, setInCall] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map()
  );
  const [signalingOnline, setSignalingOnline] = useState(true);
  const [error, setError] = useState("");
  const [myId, setMyId] = useState("");

  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const connectionsRef = useRef<Map<string, PeerConnection>>(new Map());
  const stopRef = useRef({ stop: false });

  const addRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.set(peerId, stream);
      return next;
    });
  }, []);

  const removeRemoteStream = useCallback((peerId: string) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const handleJoin = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const peerId = createPeerId();
      setMyId(peerId);
      await joinRoom(ROOM_ID, peerId);

      setInCall(true);
      setSignalingOnline(true);
      stopRef.current.stop = false;
      connectionsRef.current = new Map();

      connectToPeers(
        peerId,
        ROOM_ID,
        stream,
        connectionsRef.current,
        addRemoteStream,
        removeRemoteStream,
        setPeers,
        setSignalingOnline,
        stopRef.current
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao entrar na call.");
    }
  }, [addRemoteStream, removeRemoteStream]);

  const handleLeave = useCallback(async () => {
    stopRef.current.stop = true;
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    connectionsRef.current.forEach((c) => c.close());
    connectionsRef.current.clear();
    if (myId) await leaveRoom(ROOM_ID, myId);

    setPeers([]);
    setRemoteStreams(new Map());
    setInCall(false);
  }, [myId]);

  useEffect(() => {
    return () => {
      stopRef.current.stop = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      connectionsRef.current.forEach((c) => c.close());
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 font-sans">
      <main className="w-full max-w-md flex flex-col items-center gap-6 text-center">
        <h1 className="text-2xl font-semibold">Call (mesma rede)</h1>
        <p className="text-zinc-400 text-sm max-w-xs">
          Quem estiver na mesma rede entra na mesma call. Se a conexão cair no meio, o áudio continua (P2P).
        </p>

        {!inCall ? (
          <button
            onClick={handleJoin}
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-medium transition-colors"
          >
            Entrar na call
          </button>
        ) : (
          <div className="w-full flex flex-col items-center gap-4">
            {!signalingOnline && (
              <p className="text-amber-400 text-sm">
                Sem conexão com o servidor — chamada ativa (P2P)
              </p>
            )}
            <p className="text-xs text-zinc-500 truncate max-w-full" title={myId}>
              Você: {myId}
            </p>
            <div className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700 w-full aspect-video max-h-32 flex items-center justify-center">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-sm text-zinc-400">
              {peers.length <= 1
                ? "Aguardando outras pessoas na sala..."
                : `${peers.length} pessoa(s) na sala`}
            </p>
            <div className="w-full grid grid-cols-2 gap-2">
              {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
                <RemoteVideo key={peerId} peerId={peerId} stream={stream} />
              ))}
            </div>
            <button
              onClick={handleLeave}
              className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 font-medium transition-colors w-full max-w-xs"
            >
              Sair da call
            </button>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </main>
    </div>
  );
}

function RemoteVideo({
  peerId,
  stream,
}: {
  peerId: string;
  stream: MediaStream;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    return () => {
      const el = videoRef.current;
      if (el) el.srcObject = null;
    };
  }, []);
  return (
    <div className="rounded-xl overflow-hidden bg-zinc-800 border border-zinc-700">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full aspect-video object-cover"
      />
      <p className="text-xs text-zinc-500 p-1.5 truncate">{peerId}</p>
    </div>
  );
}
