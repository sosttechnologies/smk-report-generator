/**
 * A fake OpenAI-compatible chat server. Enough to prove the whole model path —
 * UI → runtime shim → /api/llm → provider → back — without spending a token or
 * holding a real key. Returns a plausible report in the shape the app asks for.
 */
import http from 'node:http';

export function mockLlm(port = 4390) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      calls.push({ url: req.url, auth: req.headers.authorization, model: parsed.model, json: !!parsed.response_format });
      const user = parsed.messages?.find((m) => m.role === 'user');
      const text = typeof user?.content === 'string' ? user.content : (user?.content ?? []).map((c) => c.text ?? '').join('');
      const subjects = [...text.matchAll(/^SUBJECT: ([^(]+)\(/gm)].map((m) => m[1].trim());
      let content;
      if (parsed.response_format) {
        const per = Object.fromEntries(subjects.map((s) => [s, { curriculumStrengths: `MOCK strengths in ${s}`, areasForDevelopment: `MOCK areas in ${s}` }]));
        const lists = (w) => Object.fromEntries(subjects.map((s) => [s, [`MOCK ${w} one in ${s}`, `MOCK ${w} two in ${s}`]]));
        content = JSON.stringify({
          overview: 'MOCK overview written by the fake model.',
          subjects: per,
          attendanceNarrative: 'MOCK attendance narrative.',
          cognitionAndLearning: 'MOCK cognition paragraph one.\n\nMOCK cognition paragraph two.',
          successes: lists('success'), challenges: lists('challenge'),
          targets: ['MOCK target one', 'MOCK target two', 'MOCK target three'],
          communicationAndInteraction: 'MOCK communication.',
          socialEmotionalMentalHealth: 'MOCK semh.',
          sensoryPhysical: 'MOCK sensory.',
        });
      } else {
        content = 'MOCK rewritten section.\n• MOCK bullet';
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, calls, url: `http://localhost:${port}/v1` })));
}

if (process.argv[1] && process.argv[1].endsWith('mock-llm.mjs')) {
  mockLlm(Number(process.argv[2] ?? 4390)).then(({ url }) => console.log('mock llm at', url));
}
