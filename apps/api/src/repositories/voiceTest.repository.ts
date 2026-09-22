import { randomUUID } from "node:crypto";
import type {
  VoicePipelineResponse,
  VoiceTestSession,
} from "@dongxin/shared";
import { VoiceTestSessionSchema } from "@dongxin/shared";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../storage.js";

const FILE_NAME = "voice-test-sessions.json";
let mutationQueue: Promise<unknown> = Promise.resolve();

export async function listVoiceTestSessions(): Promise<VoiceTestSession[]> {
  const sessions = await readJsonFile<VoiceTestSession[]>(FILE_NAME, []);
  return z.array(VoiceTestSessionSchema).parse(sessions);
}

export async function createVoiceTestSessionRecord(input: {
  deviceId: string;
  recordSeconds: number;
  mode: VoiceTestSession["mode"];
}): Promise<VoiceTestSession> {
  const now = new Date().toISOString();
  const session = VoiceTestSessionSchema.parse({
    id: randomUUID(),
    deviceId: input.deviceId,
    mode: input.mode,
    status: "CREATED",
    recordSeconds: input.recordSeconds,
    muted: true,
    message: "测试会话已创建",
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    result: null,
  });
  return mutate(async (sessions) => {
    await writeJsonFile(FILE_NAME, [...sessions, session].slice(-100));
    return session;
  });
}

export async function patchVoiceTestSession(
  sessionId: string,
  patch: Partial<{
    status: VoiceTestSession["status"];
    message: string;
    startedAt: string | null;
    completedAt: string | null;
    result: VoicePipelineResponse | null;
  }>,
): Promise<VoiceTestSession | null> {
  return mutate(async (sessions) => {
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return null;
    const next = VoiceTestSessionSchema.parse({
      ...sessions[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    const updated = [...sessions];
    updated[index] = next;
    await writeJsonFile(FILE_NAME, updated);
    return next;
  });
}

async function mutate<T>(
  operation: (sessions: VoiceTestSession[]) => Promise<T>,
): Promise<T> {
  const next = mutationQueue.then(async () => operation(await listVoiceTestSessions()));
  mutationQueue = next.catch(() => undefined);
  return next;
}
