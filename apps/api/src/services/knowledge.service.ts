import { randomUUID } from 'node:crypto';
import type {
  KnowledgeCategory,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeQueryResponse
} from '@dongxin/shared';
import { CreateKnowledgeDocumentRequestSchema, KnowledgeQueryRequestSchema } from '@dongxin/shared';
import { z } from 'zod';
import { appendLog } from './log.service.js';
import * as systemRepository from '../repositories/system.repository.js';

export const KnowledgeDocumentParamsSchema = z.object({
  documentId: z.string().min(1)
});

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return systemRepository.listKnowledgeDocuments();
}

export async function upsertKnowledgeDocument(requestBody: unknown): Promise<KnowledgeDocument> {
  const body = CreateKnowledgeDocumentRequestSchema.parse(requestBody);
  const documents = await listKnowledgeDocuments();
  const now = new Date().toISOString();
  const nextDocument: KnowledgeDocument = {
    id: randomUUID(),
    title: body.title,
    category: body.category,
    content: body.content,
    tags: body.tags,
    status: body.status,
    createdAt: now,
    updatedAt: now
  };

  await systemRepository.saveKnowledgeDocuments([...documents, nextDocument]);
  await appendLog({
    type: 'KNOWLEDGE',
    summary: `Knowledge document saved: ${nextDocument.title}`,
    payload: nextDocument
  });

  return nextDocument;
}

export async function answerKnowledgeQuestion(requestBody: unknown): Promise<KnowledgeQueryResponse> {
  const body = KnowledgeQueryRequestSchema.parse(requestBody);
  const documents = await listKnowledgeDocuments();
  const hits = rankKnowledgeDocuments(documents, body.question, body.category, body.limit);

  if (!hits.length) {
    const response: KnowledgeQueryResponse = {
      answer: '资料里暂时没有找到直接答案，建议联系官方售后。',
      hits: [],
      usedFallback: true
    };

    await appendLog({
      type: 'KNOWLEDGE',
      summary: 'Knowledge fallback answer',
      payload: {
        question: body.question
      }
    });

    return response;
  }

  const bestHit = hits[0];
  const response: KnowledgeQueryResponse = {
    answer: `根据《${bestHit.title}》：${bestHit.snippet}`,
    hits,
    usedFallback: false
  };

  await appendLog({
    type: 'KNOWLEDGE',
    summary: `Knowledge answered: ${bestHit.title}`,
    payload: {
      question: body.question,
      hitIds: hits.map((hit) => hit.documentId)
    }
  });

  return response;
}

function rankKnowledgeDocuments(
  documents: KnowledgeDocument[],
  question: string,
  category: KnowledgeCategory | undefined,
  limit: number
): KnowledgeHit[] {
  const normalizedQuestion = question.trim();
  const scored = documents
    .filter((document) => document.status === 'PUBLISHED')
    .map((document) => {
      if (category && document.category !== category) {
        return null;
      }

      const score = scoreDocument(document, normalizedQuestion);
      if (score <= 0) {
        return null;
      }

      return {
        documentId: document.id,
        title: document.title,
        category: document.category,
        score,
        snippet: buildSnippet(document.content, normalizedQuestion)
      };
    })
    .filter((item): item is KnowledgeHit => item !== null)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

function scoreDocument(document: KnowledgeDocument, question: string): number {
  const tokens = new Set(
    [...document.tags, document.title, document.category]
      .join(' ')
      .split(/[\s,，。；;:/|]+/g)
      .filter(Boolean)
  );
  let score = 0;
  for (const token of tokens) {
    if (question.includes(token)) {
      score += token.length >= 4 ? 3 : 1;
    }
  }

  if (question.includes(document.title)) {
    score += 5;
  }

  return score;
}

function buildSnippet(content: string, question: string): string {
  const index = question.length ? content.indexOf(question.slice(0, 4)) : -1;
  if (index >= 0) {
    return content.slice(Math.max(0, index - 20), Math.min(content.length, index + 60));
  }

  return content.slice(0, 80);
}
