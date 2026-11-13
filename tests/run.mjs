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
  .filter((f) => /^\d\d-.*\.mjs$/.test(f))
  .filter((f) => !only || f.includes(only))
  .sort();

const server = await serve(4312);
let pass = 0, fail = 0;
const failures = [];

for (const suite of suites) {
  const out = await new Promise((resolve) => {
    let buf = '';
    const child = spawn(process.execPath, [path.join(here, suite)], { cwd: path.join(here, '..') });
    child.stdout.on('data', (d) => { buf += d; });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('close', () => resolve(buf));
  });
  const p = (out.match(/^✓/gm) ?? []).length;
  const f = (out.match(/^✗/gm) ?? []).length;
  pass += p; fail += f;
  const crashed = /Error|Timeout/.test(out) && !p;
  console.log(`${f || crashed ? '✗' : '✓'} ${suite.padEnd(34)} ${p} passed${f ? `, ${f} failed` : ''}`);
  if (f || crashed) {
    failures.push(suite);
    out.split('\n').filter((l) => l.startsWith('✗') || /Error/.test(l)).slice(0, 6)
      .forEach((l) => console.log('    ' + l));
  }
}

server.close();
console.log(`\n${pass} assertions passed, ${fail} failed across ${suites.length} suites`);
process.exit(failures.length ? 1 : 0);
