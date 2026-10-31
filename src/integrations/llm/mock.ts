import type { ZodType, ZodTypeDef } from 'zod';
import { PROMPT_IDS } from './prompts';
import {
  LlmHttpError,
  type LlmClient,
  type LlmJsonResult,
  type LlmTransport,
  type TransportRequest,
  type TransportResponse,
} from './types';

/**
 * Test doubles. Never imported by production code paths.
 *
 * createMockLlmClient: deterministic JSON per prompt.
 *   mode "normal"      : quotes a real line of the resume, moderate scores.
 *   mode "adversarial" : HALLUCINATED quote + over-generous score (10) with confidence 1, so the
 *                        downstream defences (quote verification, scoring in code) can be tested.
 */
export type MockMode = 'normal' | 'adversarial';

export interface MockLlmClient extends LlmClient {
  calls: Array<{ promptId: string; user: string }>;
}

const HALLUCINATED_QUOTE = 'Led a team of 500 engineers at NASA for twenty years';

function resumeBlock(user: string): string {
  return /<<<RESUME_\w+_START>>>\n([\s\S]*?)\n<<<RESUME_\w+_END>>>/.exec(user)?.[1] ?? '';
}

function criterionIds(user: string): string[] {
  return [...user.matchAll(/criterionId="([^"]+)"/g)].map((m) => m[1]!);
}

function firstQuotableLine(resume: string): string {
  const line = resume
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length >= 20 && !/^\[[A-Z ]+\]$/.test(l));
  return line ? line.slice(0, 80) : '';
}

function buildPayload(mode: MockMode, promptId: string, user: string): unknown {
  switch (promptId) {
    case PROMPT_IDS.extractAndScore: {
      const resume = resumeBlock(user);
      const real = firstQuotableLine(resume);
      const ids = criterionIds(user);
      return {
        skills: ['Node.js', 'MongoDB'],
        yearsExperience: 4,
        projects: [{ name: 'Mock project', description: 'Deterministic mock output' }],
        criteria: ids.map((id, i) => {
          if (mode === 'adversarial') {
            return { criterionId: id, score: 10, quote: HALLUCINATED_QUOTE, confidence: 1, missing: false, reason: 'Exceptional.' };
          }
          if (real === '') {
            return { criterionId: id, score: 0, quote: '', confidence: 0, missing: true, reason: 'No evidence in resume.' };
          }
          return { criterionId: id, score: 3 + (i % 5), quote: real, confidence: 0.8, missing: false, reason: 'Supported by the quoted line.' };
        }),
      };
    }
    case PROMPT_IDS.draftInvitation:
    case PROMPT_IDS.draftPromotion:
      return {
        subject: 'Your interview invitation',
        body: 'Hello, we would like to invite you to an interview. Please use the buttons below to respond.',
      };
    case PROMPT_IDS.probeQuestions:
      return {
        questions: [
          'Walk me through the most complex system you built and your part in it.',
          'How did you verify that your last project actually worked in production?',
          'Which listed skill are you least confident in, and why?',
        ],
      };
    case PROMPT_IDS.candidateSummary:
      return { summary: 'The application shows relevant skills based on verified evidence. A human reviews every decision.' };
    default:
      throw new Error(`mock: unknown promptId ${promptId}`);
  }
}

export function createMockLlmClient(mode: MockMode = 'normal'): MockLlmClient {
  const calls: Array<{ promptId: string; user: string }> = [];
  return {
    provider: 'mock',
    calls,
    async generateJson<T>(
      promptId: string,
      _system: string,
      user: string,
      schema: ZodType<T, ZodTypeDef, unknown>,
    ): Promise<LlmJsonResult<T>> {
      calls.push({ promptId, user });
      const data = schema.parse(buildPayload(mode, promptId, user));
      return { data, usage: { tokensIn: Math.ceil(user.length / 4), tokensOut: 100 }, model: 'mock-model' };
    },
  };
}

/**
 * Scripted transport for gateway tests: each call consumes the next item. A string is returned as
 * the model text, an Error is thrown. When the script runs out the last item repeats.
 */
export interface ScriptedTransport extends LlmTransport {
  callCount: () => number;
  requests: TransportRequest[];
}

export function createScriptedTransport(script: Array<string | Error>): ScriptedTransport {
  let n = 0;
  const requests: TransportRequest[] = [];
  return {
    provider: 'scripted',
    model: 'scripted-model',
    requests,
    callCount: () => n,
    async complete(req: TransportRequest): Promise<TransportResponse> {
      requests.push(req);
      const item = script[Math.min(n, script.length - 1)]!;
      n += 1;
      if (item instanceof Error) throw item;
      return { text: item, usage: { tokensIn: 10, tokensOut: 5 }, model: 'scripted-model' };
    },
  };
}

export function httpError(status: number): LlmHttpError {
  return new LlmHttpError(status, `HTTP ${status}`);
}
