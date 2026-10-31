import { postJson } from './postJson';
import { LlmHttpError, type LlmTransport, type TransportRequest, type TransportResponse } from './types';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Gemini REST adapter. Temperature 0 and responseMimeType application/json (strict JSON mode). */
export function createGeminiTransport(apiKey: string, model: string): LlmTransport {
  return {
    provider: 'gemini',
    model,
    async complete(req: TransportRequest): Promise<TransportResponse> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const raw = await postJson(
        url,
        { 'x-goog-api-key': apiKey },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: 0,
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        },
        req.timeoutMs,
      );
      const res = raw as GeminiResponse;
      const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (text.length === 0) throw new LlmHttpError(502, 'Gemini returned an empty response');
      return {
        text,
        model,
        usage: {
          tokensIn: res.usageMetadata?.promptTokenCount ?? 0,
          tokensOut: res.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}
