/**
 * Generation providers.
 *
 * The report generator does not care which model writes the prose, so the choice is
 * a deployment decision rather than a code change. Three exist:
 *
 *   anthropic  — Claude via the commercial API. Best prose, strongest instruction
 *                following, data leaves the building (pseudonymised).
 *   local      — any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, llama.cpp.
 *                Open-weight models on hardware SIEVEMK controls. Nothing leaves.
 *   template   — no model at all. Deterministic assembly from the tutors' own words.
 *
 * Selected with REPORT_PROVIDER. Every provider receives the PSEUDONYMISED term —
 * see src/lib/pseudonymise.ts — because a local model is still a system that can be
 * breached, logged or backed up.
 */

import type { GeneratedContent, StudentTerm } from '../../types';

export type ProviderName = 'anthropic' | 'local' | 'template';

export interface GenerationResult {
  content: GeneratedContent;
  /** What actually produced this, shown to staff and recorded in the audit trail. */
  provider: ProviderName;
  model: string;
  /** Set when the requested provider failed and another one answered. */
  note?: string;
}

export interface Provider {
  name: ProviderName;
  model: string;
  available(): boolean;
  generate(term: StudentTerm): Promise<GeneratedContent>;
}

export function selectedProvider(): ProviderName {
  const raw = (process.env.REPORT_PROVIDER ?? '').toLowerCase().trim();
  if (raw === 'anthropic' || raw === 'local' || raw === 'template') return raw;
  // Unset: use Claude if a key is present, otherwise degrade to the template.
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'template';
}
