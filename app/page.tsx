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
        stopRef.current
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao entrar na call");
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
    if (myId) {
      await leaveRoom(ROOM_ID, myId);
    }
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <main className="max-w-xl mx-auto flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Call offline (mesma rede)</h1>
        <p className="text-zinc-400 text-sm">
          Quem estiver na mesma rede WiFi entra na mesma call.
        </p>

        {!inCall ? (
          <button
            onClick={handleJoin}
            className="px-4 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium w-fit"
          >
            Entrar na call
          </button>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span>Você: {myId}</span>
            </div>
            <div className="rounded-lg overflow-hidden bg-zinc-900 border border-zinc-700 aspect-video flex items-center justify-center min-h-[200px]">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="max-h-32 rounded object-cover"
              />
            </div>
            <p className="text-sm text-zinc-400">
              {peers.length === 0
                ? "Aguardando outras pessoas na sala..."
                : `${peers.length} pessoa(s) na sala`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
                <RemoteVideo key={peerId} peerId={peerId} stream={stream} />
              ))}
            </div>
            <button
              onClick={handleLeave}
              className="px-4 py-3 rounded-lg bg-red-600 hover:bg-red-500 font-medium"
            >
              Sair da call
            </button>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
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
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full aspect-video object-cover"
      />
      <p className="text-xs text-zinc-500 p-1 truncate">{peerId}</p>
    </div>
  );
}
