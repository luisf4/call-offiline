/**
 * Store compartilhado: Redis na Vercel (Upstash), memória local em dev.
 * Na Vercel, crie um Redis no Upstash (free) e configure:
 * UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN nas env vars do projeto.
 */

const ROOM_PREFIX = "room:";
const SIGNAL_PREFIX = "signal:";

// Fallback in-memory para quando Redis não está configurado (ex: dev local)
const memoryRooms = new Map<string, Set<string>>();
const memorySignals = new Map<string, Array<{ from: string; signal: string }>>();

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  // Dynamic import para não quebrar build se @upstash/redis não estiver instalado
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis");
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

const redis = typeof process !== "undefined" ? getRedis() : null;

export async function roomGetPeers(roomId: string): Promise<string[]> {
  if (redis) {
    const list = await redis.smembers(ROOM_PREFIX + roomId);
    return Array.isArray(list) ? list : [];
  }
  return Array.from(memoryRooms.get(roomId) ?? []);
}

export async function roomAdd(roomId: string, peerId: string): Promise<string[]> {
  if (redis) {
    await redis.sadd(ROOM_PREFIX + roomId, peerId);
    const all = await redis.smembers(ROOM_PREFIX + roomId);
    const list = Array.isArray(all) ? all : [];
    return list.filter((id: string) => id !== peerId);
  }
  if (!memoryRooms.has(roomId)) memoryRooms.set(roomId, new Set());
  memoryRooms.get(roomId)!.add(peerId);
  return Array.from(memoryRooms.get(roomId)!).filter((id) => id !== peerId);
}

export async function roomRemove(roomId: string, peerId: string): Promise<void> {
  if (redis) {
    await redis.srem(ROOM_PREFIX + roomId, peerId);
    return;
  }
  const room = memoryRooms.get(roomId);
  if (room) {
    room.delete(peerId);
    if (room.size === 0) memoryRooms.delete(roomId);
  }
}

export async function signalPush(to: string, from: string, signal: string): Promise<void> {
  if (redis) {
    await redis.lpush(SIGNAL_PREFIX + to, JSON.stringify({ from, signal }));
    return;
  }
  if (!memorySignals.has(to)) memorySignals.set(to, []);
  memorySignals.get(to)!.push({ from, signal });
}

export async function signalPopAll(peerId: string): Promise<Array<{ from: string; signal: string }>> {
  if (redis) {
    const key = SIGNAL_PREFIX + peerId;
    const raw = await redis.lrange(key, 0, -1);
    await redis.del(key);
    if (!Array.isArray(raw)) return [];
    return raw.map((s: string) => {
      try {
        return JSON.parse(s) as { from: string; signal: string };
      } catch {
        return { from: "", signal: s };
      }
    });
  }
  const list = memorySignals.get(peerId) ?? [];
  memorySignals.set(peerId, []);
  return list;
}
