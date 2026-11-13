/**
 * Runs the self-hosted web app test twice: once with no model (template path),
 * once against a fake OpenAI-compatible server (the full model path, no key, no
 * spend). Each run starts its own Next.js server on its own port so nothing
 * depends on what is already running.
 *
 *   node tests/run-web.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockLlm } from './mock-llm.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function waitFor(url, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

/** Production build, once. `next dev` allows one instance per directory;
 *  `next start` allows as many as we like, and is what actually deploys. */
async function buildOnce() {
  await new Promise((resolve, reject) => {
    const c = spawn('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    c.stdout.on('data', (d) => { log += d; });
    c.stderr.on('data', (d) => { log += d; });
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`build failed\n${log.slice(-1200)}`))));
  });
}

async function startNext(port, env) {
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const ok = await waitFor(`http://localhost:${port}/api/llm`);
  if (!ok) { child.kill(); throw new Error(`next dev did not come up on ${port}\n${log.slice(-800)}`); }
  return child;
}

async function runSuite(appUrl) {
  return new Promise((resolve) => {
    let out = '';
    const c = spawn(process.execPath, [path.join(root, 'tests', '20-web-app.mjs')], {
      cwd: root, env: { ...process.env, APP_URL: appUrl },
    });
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ out, code }));
  });
}

function report(label, { out, code }) {
  const p = (out.match(/^✓/gm) ?? []).length;
  const f = (out.match(/^✗/gm) ?? []).length;
  const crashed = code !== 0;
  console.log(`\n${f || crashed ? '✗' : '✓'} ${label}: ${p} passed${f ? `, ${f} failed` : ''}${crashed ? ` — CRASHED (exit ${code})` : ''}`);
  out.split('\n').filter((l) => /^(✓|✗|===)/.test(l) || /Error/.test(l)).forEach((l) => console.log('   ' + l));
  return !f && !crashed;
}

let allOk = true;
console.log('building once…');
await buildOnce();

// Run 1 — no provider: the deterministic template must carry the whole flow.
{
  const next = await startNext(3101, { LLM_PROVIDER: 'none', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '' });
  try { allOk = report('no model configured', await runSuite('http://localhost:3101')) && allOk; }
  finally { next.kill(); }
}

// Run 2 — a fake OpenAI-compatible model: proves the whole wiring the real one uses.
{
  const mock = await mockLlm(4390);
  const next = await startNext(3102, {
    LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', LLM_BASE_URL: mock.url, LLM_MODEL: 'mock-model',
  });
  try {
    const ok = report('fake OpenAI-compatible model', await runSuite('http://localhost:3102'));
    const jsonCalls = mock.calls.filter((c) => c.json).length;
    const authed = mock.calls.every((c) => c.auth === 'Bearer test-key');
    console.log(`   ${mock.calls.length} model calls reached the fake server (${jsonCalls} asking for JSON); key sent as a bearer: ${authed}`);
    allOk = ok && authed && mock.calls.length >= 2 && allOk;
  } finally { next.kill(); mock.server.close(); }
}

process.exit(allOk ? 0 : 1);
