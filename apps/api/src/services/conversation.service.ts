import { randomUUID } from 'node:crypto';
import type { AiResult } from '@dongxin/shared';
import { ApiError } from '../http/apiError.js';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ConversationChannel = 'pipeline' | 'llm-test';
interface Scope { deviceId: string; channel: ConversationChannel }
interface Conversation extends Scope {
  id: string;
  updatedAt: number;
  messages: ConversationMessage[];
  queue: Promise<unknown>;
  closed: boolean;
}

export interface ConversationTurn {
  text: string;
  aiResult: AiResult;
  replyText: string;
  executionStatus?: string;
}

// Temporary context only. Audio and API credentials are never stored here.
// Replace this store with Redis when deploying multiple API processes.
export class ConversationStore {
  private readonly sessions = new Map<string, Conversation>();
  constructor(
    private readonly now = Date.now,
    private readonly ttlMs = 5 * 60_000,
    private readonly maxSessions = 1000,
  ) {}

  async run<T>(
    scope: Scope,
    options: { conversationId?: string; resumeLatest?: boolean },
    operation: (context: { id: string; messages: ConversationMessage[] }) => Promise<{
      value: T;
      turn?: ConversationTurn;
      end?: boolean;
    }>,
  ): Promise<T> {
    this.expire();
    let session = options.conversationId ? this.sessions.get(options.conversationId) : undefined;
    if (session && (session.deviceId !== scope.deviceId || session.channel !== scope.channel)) {
      throw new ApiError(409, 'CONVERSATION_SCOPE_MISMATCH', '该会话不属于当前设备或测试类型');
    }
    if (!session && !options.conversationId && options.resumeLatest) {
      session = [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).find((item) =>
        item.deviceId === scope.deviceId && item.channel === scope.channel && !item.closed,
      );
    }
    if (!session) {
      if (this.sessions.size >= this.maxSessions) {
        const oldest = [...this.sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
        this.close(oldest);
      }
      session = { ...scope, id: randomUUID(), updatedAt: this.now(), messages: [], queue: Promise.resolve(), closed: false };
      this.sessions.set(session.id, session);
    }
    const current = session;
    current.updatedAt = this.now();
    const task = current.queue.then(async () => {
      if (current.closed) throw new ApiError(409, 'CONVERSATION_CLOSED', '会话已结束，请重新发起测试');
      const result = await operation({ id: current.id, messages: current.messages.map((item) => ({ ...item })) });
      if (!current.closed && result.turn) {
        const turn = result.turn;
        current.messages.push(
          { role: 'user', content: turn.text.slice(0, 2000) },
          { role: 'assistant', content: JSON.stringify({ ...turn.aiResult, speak: turn.replyText.slice(0, 1200), executionStatus: turn.executionStatus ?? 'NOT_EXECUTED' }) },
        );
        while (current.messages.length > 24 || current.messages.reduce((sum, item) => sum + item.content.length, 0) > 12_000) {
          current.messages.splice(0, 2);
        }
        current.updatedAt = this.now();
      }
      if (result.end) this.close(current);
      return result.value;
    });
    current.queue = task.catch(() => undefined);
    return task;
  }

  reset(scope: Scope): void {
    for (const session of this.sessions.values()) {
      if (session.deviceId === scope.deviceId && session.channel === scope.channel) this.close(session);
    }
  }

  private expire(): void {
    for (const session of this.sessions.values()) {
      if (this.now() - session.updatedAt >= this.ttlMs) this.close(session);
    }
  }

  private close(session: Conversation): void {
    session.closed = true;
    this.sessions.delete(session.id);
  }
}

export const voiceConversations = new ConversationStore();

export function isConversationEnd(text: string): boolean {
  return /^(再见|拜拜|晚安|结束对话|结束会话|退出对话|不用了)[，。！？!?,\s]*$/.test(text.trim());
}
