/**
 * Open-weight models through any OpenAI-compatible endpoint.
 *
 * Works with Ollama (`ollama serve`, default http://localhost:11434/v1), LM Studio,
 * vLLM and llama.cpp's server. No SDK: the chat-completions shape is stable enough
 * across all of them that a fetch is more robust than a client library.
 *
 * Open-weight models follow "use only these facts" less reliably than frontier
 * models, so the prompt repeats the constraint and the response is validated the
 * same way Claude's is. A model that cannot return the schema is treated as a
 * failure, not patched up — see validateContent.
 */

import type { GeneratedContent, StudentTerm } from '../../types';
import { buildReportPrompt, SYSTEM_PROMPT, validateContent } from '../prompt';
import type { Provider } from './types';

const DEFAULT_BASE = 'http://localhost:11434/v1';
const DEFAULT_MODEL = 'llama3.3:70b';

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export function localProvider(): Provider {
  const base = (process.env.LOCAL_MODEL_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
  const model = process.env.LOCAL_MODEL ?? DEFAULT_MODEL;

  return {
    name: 'local',
    model,
    available: () => Boolean(process.env.LOCAL_MODEL_BASE_URL || process.env.LOCAL_MODEL),

    async generate(term: StudentTerm): Promise<GeneratedContent> {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Most local servers ignore this; vLLM behind a proxy may not.
          ...(process.env.LOCAL_MODEL_API_KEY
            ? { Authorization: `Bearer ${process.env.LOCAL_MODEL_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildReportPrompt(term) },
          ],
          // Low temperature: this is reportage, not creative writing.
          temperature: 0.3,
          max_tokens: 8000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(Number(process.env.LOCAL_MODEL_TIMEOUT_MS ?? 300_000)),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Local model returned ${response.status}. ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as ChatResponse;
      if (data.error?.message) throw new Error(`Local model error: ${data.error.message}`);

      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Local model returned an empty response');

      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end <= start) throw new Error('Local model did not return JSON');

      return validateContent(JSON.parse(text.slice(start, end + 1)), term);
    },
  };
}
