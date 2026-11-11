import { randomUUID } from "node:crypto";
import type {
  VoicePipelineResponse,
  VoiceTestSession,
  VoiceTestSettings,
  VoiceTestTurn,
} from "@dongxin/shared";
import { VoiceTestSessionSchema } from "@dongxin/shared";
import { z } from "zod";
import { readJsonFile, updateJsonFile } from "../storage.js";
import { retainRecent, retentionSettings } from '../runtime/retention.js';

const FILE_NAME = "voice-test-sessions.json";

export async function listVoiceTestSessions(): Promise<VoiceTestSession[]> {
  const sessions = await readJsonFile<VoiceTestSession[]>(FILE_NAME, []);
  return pruneVoiceTestSessions(z.array(VoiceTestSessionSchema).parse(sessions));
}

export function pruneVoiceTestSessions(sessions: VoiceTestSession[], now = Date.now()): VoiceTestSession[] {
  const settings = retentionSettings();
  const withoutAudio = (result: VoicePipelineResponse): VoicePipelineResponse => ({ ...result, ttsAudioBase64: null });
  return retainRecent(sessions, (item) => item.updatedAt, settings.testSessions, now).map((session) => ({
    ...session,
    result: session.result ? withoutAudio(session.result) : null,
    turns: retainRecent(session.turns, (turn) => turn.at, settings.testTurns, now)
      .map((turn) => ({ ...turn, result: withoutAudio(turn.result) })),
  }));
}

export async function createVoiceTestSessionRecord(input: {
  deviceId: string;
  recordSeconds: number;
  mode: VoiceTestSession["mode"];
  asrDatasetId?: string | null;
  expectedText?: string | null;
  continuous?: boolean;
  settings?: VoiceTestSettings;
}): Promise<VoiceTestSession> {
  const now = new Date().toISOString();
  const session = VoiceTestSessionSchema.parse({
    id: randomUUID(),
    deviceId: input.deviceId,
    mode: input.mode,
    asrDatasetId: input.asrDatasetId ?? null,
    expectedText: input.expectedText ?? null,
    capturedDatasetItemId: null,
    status: "CREATED",
    recordSeconds: input.recordSeconds,
    continuous: input.continuous ?? false,
    settings: input.settings ?? {},
    turns: [],
    muted: true,
    message: "测试会话已创建",
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    result: null,
  });
  return updateJsonFile<VoiceTestSession[], VoiceTestSession>(FILE_NAME, [], (sessions) => {
    return { value: pruneVoiceTestSessions([...sessions, session]), result: session };
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
    capturedDatasetItemId: string | null;
    turns: VoiceTestTurn[];
  }>,
): Promise<VoiceTestSession | null> {
  return updateJsonFile<VoiceTestSession[], VoiceTestSession | null>(FILE_NAME, [], (sessions) => {
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return { value: pruneVoiceTestSessions(sessions), result: null };
    const next = VoiceTestSessionSchema.parse({
      ...sessions[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    const updated = [...sessions];
    updated[index] = next;
    return { value: pruneVoiceTestSessions(updated), result: next };
  });
}
