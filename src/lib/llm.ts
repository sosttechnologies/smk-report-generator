/**
 * One completion function, many providers.
 *
 * The UI never sees a key or a provider name. It posts a prompt to /api/llm and gets
 * text back. Which model answers is a deployment setting:
 *
 *   LLM_PROVIDER=anthropic    Claude via Anthropic's API            (ANTHROPIC_API_KEY)
 *   LLM_PROVIDER=openrouter   Any model OpenRouter lists, open-weight included
 *                             (OPENROUTER_API_KEY, LLM_MODEL e.g. meta-llama/llama-3.3-70b-instruct)
 *   LLM_PROVIDER=openai       OpenAI, or anything speaking its chat API (OPENAI_API_KEY, LLM_BASE_URL)
 *   LLM_PROVIDER=ollama       A model on this machine or inside SMK's network (LLM_BASE_URL)
 *   LLM_PROVIDER=none         No model. The app still works on the deterministic template.
 *
 * OpenRouter, OpenAI and Ollama all speak the same chat-completions shape, so they share
 * one code path. Anthropic has its own SDK and its own image block format.
 */

import Anthropic from '@anthropic-ai/sdk';

export type Provider = 'anthropic' | 'openrouter' | 'openai' | 'ollama' | 'none';

export interface CompletionRequest {
  prompt: string;
  system?: string;
  /** Ask for a JSON object. Providers that support a JSON mode get it switched on. */
  json?: boolean;
  /** data: URLs. Only forwarded when the provider can take images. */
  images?: string[];
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  provider: Provider;
  model: string;
}

export function provider(): Provider {
  const raw = (process.env.LLM_PROVIDER ?? '').toLowerCase().trim() as Provider;
  if (['anthropic', 'openrouter', 'openai', 'ollama', 'none'].includes(raw)) return raw;
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-opus-5',
  openrouter: 'anthropic/claude-sonnet-4.5',
  openai: 'gpt-4o',
  ollama: 'llama3.3:70b',
  none: 'template',
};

export function model(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL[provider()];
}

/** Can this configuration read images? Ollama vision depends on the model; assume not. */
export function acceptsImages(): boolean {
  const p = provider();
  return p === 'anthropic' || p === 'openrouter' || p === 'openai';
}

export function available(): boolean {
  return provider() !== 'none';
}

function openAiStyle(): { base: string; key: string } {
  const p = provider();
  if (p === 'openrouter') {
    return { base: 'https://openrouter.ai/api/v1', key: process.env.OPENROUTER_API_KEY ?? '' };
  }
  if (p === 'ollama') {
    return { base: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1', key: process.env.LLM_API_KEY ?? 'ollama' };
  }
  return { base: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1', key: process.env.OPENAI_API_KEY ?? '' };
}

function dataUrlParts(url: string): { mediaType: string; data: string } | null {
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  return m ? { mediaType: m[1], data: m[2] } : null;
}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const p = provider();
  const m = model();
  const maxTokens = req.maxTokens ?? 8000;

  if (p === 'none') {
    throw new Error('No model is configured. Set LLM_PROVIDER and a key on the server.');
  }

  if (p === 'anthropic') {
    const client = new Anthropic();
    const content: Anthropic.ContentBlockParam[] = [];
    for (const url of req.images ?? []) {
      const parts = dataUrlParts(url);
      if (!parts) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: parts.mediaType as 'image/png', data: parts.data },
      });
    }
    content.push({ type: 'text', text: req.prompt });

    const res = await client.messages.create({
      model: m,
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') {
      throw new Error(res.stop_details?.explanation ?? 'The model declined this request.');
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, provider: p, model: m };
  }

  // OpenRouter, OpenAI and Ollama: one chat-completions shape.
  const { base, key } = openAiStyle();
  if (!key && p !== 'ollama') throw new Error(`No API key set for ${p}.`);

  const userContent: unknown[] = [];
  for (const url of req.images ?? []) userContent.push({ type: 'image_url', image_url: { url } });
  userContent.push({ type: 'text', text: req.prompt });

  const body: Record<string, unknown> = {
    model: m,
    max_tokens: maxTokens,
    temperature: 0.3,
    messages: [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: req.images?.length ? userContent : req.prompt },
    ],
  };
  if (req.json) body.response_format = { type: 'json_object' };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
  if (p === 'openrouter') {
    // OpenRouter asks for these so usage shows up against the app, not the key.
    headers['HTTP-Referer'] = process.env.APP_URL ?? 'http://localhost:3000';
    headers['X-Title'] = 'SMK Gateway Report Generator';
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 180_000)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${p} returned ${res.status}: ${detail.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(`${p}: ${data.error.message}`);
  const raw = data.choices?.[0]?.message?.content;
  const text = typeof raw === 'string' ? raw : (raw ?? []).map((c) => c.text ?? '').join('');
  if (!text) throw new Error(`${p} returned an empty answer`);
  return { text, provider: p, model: m };
}
