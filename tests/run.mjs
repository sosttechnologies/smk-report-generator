/**
 * Runs every browser test against a freshly served build.
 *
 * Each suite prints "✓"/"✗" lines; this collects them and fails the process on
 * any "✗", so `npm test` is usable as a gate in CI.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const suites = fs.readdirSync(here)
  // 0x and 1x suites run against the static build here; 2x suites need the
  // full backend and are driven by run-web.mjs instead.
  .filter((f) => /^[01]\d-.*\.mjs$/.test(f))
  .filter((f) => !only || f.includes(only))
  .sort();

// A plain `node --check` parses as CommonJS and silently accepts an unbalanced
// brace in an ES module. Importing would parse it correctly but also RUN it,
// which fails on `window`. Piping through --input-type=module --check does
// neither: it parses as a module without executing a line.
for (const file of ['app.js', 'engine.js']) {
  const src = fs.readFileSync(path.join(here, '..', 'artifact2', file));
  const bad = await new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '--check', '-']);
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve(code === 0 ? null : err));
    c.stdin.end(src);
  });
  if (bad) {
    console.log(`✗ artifact2/${file} — ${(bad.match(/SyntaxError.*/) ?? ['syntax error'])[0]}`);
    process.exit(1);
  }
}

const server = await serve(4312);
let pass = 0, fail = 0;
const failures = [];

for (const suite of suites) {
  const { out, code } = await new Promise((resolve) => {
    let buf = '';
    const child = spawn(process.execPath, [path.join(here, suite)], { cwd: path.join(here, '..') });
    child.stdout.on('data', (d) => { buf += d; });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('close', (c) => resolve({ out: buf, code: c }));
  });
  const p = (out.match(/^✓/gm) ?? []).length;
  const f = (out.match(/^✗/gm) ?? []).length;
  pass += p; fail += f;
  // A suite that throws part-way through still prints the ✓ lines it managed,
  // and used to be reported as passing. Trust the exit code.
  const crashed = code !== 0;
  console.log(`${f || crashed ? '✗' : '✓'} ${suite.padEnd(34)} ${p} passed${f ? `, ${f} failed` : ''}${crashed ? ` — CRASHED (exit ${code})` : ''}`);
  if (f || crashed) {
    failures.push(suite);
    out.split('\n').filter((l) => l.startsWith('✗') || /Error/.test(l)).slice(0, 6)
      .forEach((l) => console.log('    ' + l));
  }
}

server.close();
console.log(`\n${pass} assertions passed, ${fail} failed across ${suites.length} suites`);
process.exit(failures.length ? 1 : 0);
