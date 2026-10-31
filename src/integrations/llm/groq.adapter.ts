import { postJson } from './postJson';
import { LlmHttpError, type LlmTransport, type TransportRequest, type TransportResponse } from './types';

interface GroqResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Groq adapter (OpenAI-compatible chat completions). Temperature 0 and json_object response format. */
export function createGroqTransport(apiKey: string, model: string): LlmTransport {
  return {
    provider: 'groq',
    model,
    async complete(req: TransportRequest): Promise<TransportResponse> {
      const raw = await postJson(
        'https://api.groq.com/openai/v1/chat/completions',
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        },
        req.timeoutMs,
      );
      const res = raw as GroqResponse;
      const text = res.choices?.[0]?.message?.content ?? '';
      if (text.length === 0) throw new LlmHttpError(502, 'Groq returned an empty response');
      return {
        text,
        model,
        usage: { tokensIn: res.usage?.prompt_tokens ?? 0, tokensOut: res.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
