import type { ZodType, ZodTypeDef } from 'zod';

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface LlmJsonResult<T> {
  data: T;
  usage: LlmUsage;
  model: string;
}

/** The only LLM surface the rest of the app sees. */
export interface LlmClient {
  readonly provider: string;
  generateJson<T>(
    promptId: string,
    system: string,
    user: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
  ): Promise<LlmJsonResult<T>>;
}

export interface TransportRequest {
  system: string;
  user: string;
  /** Ask the provider for strict JSON output mode where supported. */
  json: boolean;
  timeoutMs: number;
}

export interface TransportResponse {
  text: string;
  usage: LlmUsage;
  model: string;
}

/** One raw HTTP round trip to a provider. Adapters (Gemini, Groq) implement this. */
export interface LlmTransport {
  readonly provider: string;
  readonly model: string;
  complete(req: TransportRequest): Promise<TransportResponse>;
}

/** Provider HTTP failure. status 0 = network error or timeout. */
export class LlmHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
  }
}

/** The model answered, but not with valid JSON for the schema (after one corrective retry). */
export class LlmSchemaError extends Error {
  readonly issues: string[];
  readonly promptId: string;
  constructor(promptId: string, issues: string[]) {
    super(`LLM output failed validation for ${promptId}: ${issues.join('; ')}`);
    this.name = 'LlmSchemaError';
    this.issues = issues;
    this.promptId = promptId;
  }
}
