/**
 * Which model should write SMK's reports?
 *
 * Runs the REAL prompt — extracted from artifact2/app.js so this cannot drift from what
 * the app actually sends — over invented sample data, against several OpenRouter models,
 * and scores what matters for reports about children:
 *
 *   grounded     did it invent a fact, or contradict the computed attendance figures?
 *   pseudonyms   did it keep "Student A" / "Tutor 1", or leak a name back in?
 *   british      organise not organize, behaviour not behavior
 *   complete     every requested section present and non-empty
 *   honest       says "nothing recorded" rather than padding, where nothing was recorded
 *
 * Cost and latency come from the provider's own usage figures, not an estimate.
 *
 *   node scripts/eval-models.mjs                  # the default shortlist
 *   node scripts/eval-models.mjs modelA modelB    # specific ones
 *
 * Uses invented students only (engine.js sampleSubmissions). Never point this at real
 * data — see CLAUDE.md hard rule 4.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY (it is in .env.local).'); process.exit(1); }

/* --- the real prompt, lifted out of app.js so this test cannot drift from the app --- */
const appSrc = fs.readFileSync(path.join(root, 'artifact2', 'app.js'), 'utf8');
function lift(name) {
  const start = appSrc.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in app.js`);
  let depth = 0, i = appSrc.indexOf('{', start);
  for (let j = i; j < appSrc.length; j++) {
    if (appSrc[j] === '{') depth++;
    else if (appSrc[j] === '}' && --depth === 0) return appSrc.slice(start, j + 1);
  }
  throw new Error(`could not read ${name}`);
}
const shim = path.join(root, 'scripts', '.eval-prompt.tmp.mjs');
fs.writeFileSync(shim, `export ${lift('defaultTemplate')}\nexport ${lift('promptFor')}\n`);
const { defaultTemplate, promptFor } = await import(`file://${shim}`);
fs.unlinkSync(shim);

const E = await import(`file://${path.join(root, 'artifact2', 'engine.js')}`);

/* --- one invented student's term, pseudonymised exactly as the app does it --- */
const term = E.aggregateSubmissions(E.sampleSubmissions())[0];
const { term: masked } = E.pseudonymise(term);
const tpl = defaultTemplate();
const prompt = promptFor(masked, tpl, tpl.sections);

const SECTIONS = ['overview', 'attendanceNarrative', 'cognitionAndLearning',
  'communicationAndInteraction', 'socialEmotionalMentalHealth', 'sensoryPhysical'];

/* --- scoring ------------------------------------------------------------------ */
const AMERICAN = /\b(organiz|recogniz|behavior|program(?!me)|favorit|color|analyz|practiced|prioritiz|summariz|apologiz|criticiz|emphasiz|utiliz)\w*/gi;
// Names that must never come back: the model is given pseudonyms only.
const REAL_NAMES = /\b(Alex|Sample|Robin|Example|Sam|Placeholder)\b/g;

function score(text) {
  let parsed = null;
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? fence[1] : text;
    const a = body.indexOf('{'), b = body.lastIndexOf('}');
    parsed = JSON.parse(body.slice(a, b + 1));
  } catch { /* stays null */ }
  if (!parsed) return { ok: false, note: 'did not return usable JSON' };

  const all = JSON.stringify(parsed);
  // "None identified." is a correct, honest answer and is only 16 characters — a
  // length threshold would punish exactly the behaviour we want.
  const present = SECTIONS.filter((s) => typeof parsed[s] === 'string' && parsed[s].trim().length > 3);
  const american = [...new Set((all.match(AMERICAN) ?? []).map((w) => w.toLowerCase()))];
  const leaked = [...new Set(all.match(REAL_NAMES) ?? [])];
  const usesPseudonyms = /Student A/.test(all);

  // The attendance figures are computed, not written by the model; contradicting them
  // would put a wrong fact in front of a family.
  const a = masked.attendance;
  const nums = (parsed.attendanceNarrative ?? '').match(/\b\d+\b/g) ?? [];
  const allowed = new Set([a.fullWeeks, a.partialWeeks, a.absentWeeks, a.distinctWeeks,
    a.recordedWeeks, a.unrecordedWeeks].filter((n) => n != null).map(String));
  const invented = nums.filter((n) => !allowed.has(n));

  const words = all.replace(/[^a-z ]/gi, ' ').split(/\s+/).filter(Boolean).length;
  return {
    ok: true,
    sections: `${present.length}/${SECTIONS.length}`,
    complete: present.length === SECTIONS.length,
    american, leaked, usesPseudonyms, invented,
    words,
    sample: (parsed.overview ?? '').slice(0, 210),
    semh: (parsed.socialEmotionalMentalHealth ?? '').slice(0, 150),
    attendance: (parsed.attendanceNarrative ?? '').slice(0, 260),
    targets: Array.isArray(parsed.targets) ? parsed.targets.length : 0,
  };
}

/* --- run ----------------------------------------------------------------------- */
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'mistralai/mistral-small-24b-instruct-2501',
  'openai/gpt-4o-mini',
  'qwen/qwen-2.5-72b-instruct',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat',
];

console.log(`prompt: ${prompt.length} chars, one invented student, ${masked.subjects.length} subjects\n`);

const results = [];
for (const model of MODELS) {
  process.stdout.write(`${model.padEnd(44)} `);
  const started = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://smk-reports.fly.dev',
        'X-Title': 'SMK report model evaluation',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        provider: { sort: 'price' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? 'provider error');
    const text = data.choices?.[0]?.message?.content ?? '';
    const u = data.usage ?? {};
    const s = score(text);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ model, ...s, secs, in: u.prompt_tokens ?? 0, out: u.completion_tokens ?? 0, cost: u.cost ?? null });
    console.log(s.ok ? `${s.sections} sections, ${secs}s` : `FAILED — ${s.note}`);
  } catch (e) {
    results.push({ model, ok: false, note: e.message.slice(0, 80) });
    console.log(`ERROR — ${e.message.slice(0, 70)}`);
  }
}

/* --- report -------------------------------------------------------------------- */
console.log(`\n${'model'.padEnd(44)}${'ok'.padEnd(4)}${'secs'.padEnd(7)}${'tokens'.padEnd(14)}${'$/report'.padEnd(11)}issues`);
console.log('-'.repeat(118));
for (const r of results) {
  if (!r.ok) { console.log(`${r.model.padEnd(44)}${'no'.padEnd(4)}${''.padEnd(32)}${r.note}`); continue; }
  const issues = [];
  if (!r.complete) issues.push(`only ${r.sections} sections`);
  if (r.american.length) issues.push(`US spelling: ${r.american.join(', ')}`);
  if (r.leaked.length) issues.push(`LEAKED NAME: ${r.leaked.join(', ')}`);
  if (!r.usesPseudonyms) issues.push('did not use Student A');
  if (r.invented.length) issues.push(`unsupported numbers: ${r.invented.join(', ')}`);
  console.log(
    r.model.padEnd(44) + 'yes'.padEnd(4) + String(r.secs).padEnd(7) +
    `${r.in}→${r.out}`.padEnd(14) +
    (r.cost != null ? `$${Number(r.cost).toFixed(5)}` : '—').padEnd(11) +
    (issues.length ? issues.join('; ') : 'none'));
}

console.log('\n--- overview, for tone ---');
for (const r of results) {
  if (!r.ok) continue;
  console.log(`\n[${r.model}]\n${r.sample}…`);
}
console.log('\n--- attendance, where a wrong number would reach a family ---');
console.log(`  computed: ${masked.attendance.fullWeeks} of ${masked.attendance.distinctWeeks} weeks full, ${masked.attendance.partialWeeks} partial, ${masked.attendance.absentWeeks} absent`);
for (const r of results) { if (r.ok) console.log(`\n[${r.model}]\n${r.attendance}`); }

console.log('\n--- "nothing recorded" handling (SEMH section) ---');
for (const r of results) {
  if (!r.ok) continue;
  console.log(`\n[${r.model}]\n${r.semh}…`);
}
