import type { z } from "zod";

/**
 * One narrow interface; every model call in the project goes through it
 * (docs/04). There is exactly one real adapter — WebLLM over WebGPU, which
 * ships as a browser-only entry point because it cannot satisfy hard rule 1 —
 * plus the recording/replay wrapper that makes the system testable without a
 * GPU.
 *
 * Only the types live in core. The WebLLM adapter arrives in M4.
 */

export interface ModelCapabilities {
  contextTokens: number; // usable context window
  supportsJsonSchema: boolean; // constrained structured output
  supportsToolCalls: boolean; // native tool/function calling
  supportsStreaming: boolean;
  costPer1kInput?: number; // undefined for local
  costPer1kOutput?: number;
}

/**
 * Refined in M6, when the agent loop exists. WebLLM's native `tools` support is
 * upstream WIP, so the JSON action protocol is the only tool-calling path
 * (docs/01) and this is carried for completeness rather than used.
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

export interface CompletionRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** If set, the response must be JSON matching this schema. */
  schema?: z.ZodType;
  tools?: ToolSpec[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface CompletionResponse {
  text?: string;
  /** Parsed and validated against `schema` when one was given. */
  json?: unknown;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
  /** The provider's own response, kept for the trace. */
  raw?: unknown;
}

export interface ModelProvider {
  id: string; // "webllm:Llama-3.1-8B-Instruct-q4f32_1-MLC"
  capabilities(): Promise<ModelCapabilities>;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  /** Approximate is fine; used for chunk sizing and budgets. */
  countTokens(text: string): number;
}
