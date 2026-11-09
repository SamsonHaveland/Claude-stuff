/**
 * LOCAL DEV / DEMO ONLY — a stand-in for the Hermes API server so the UI can be
 * exercised without touching a real Hermes installation. Every reply it produces is
 * prefixed "[FAKE HERMES]" so it can never be mistaken for real agent output.
 *
 *   HC_FAKE_KEY=dev-key npx tsx scripts/fake-hermes.ts   # listens on 127.0.0.1:18642
 */
import { FakeHermes, sleep } from '../server/test/fakeHermes.js';

const fake = new FakeHermes({
  key: process.env.HC_FAKE_KEY ?? 'dev-key',
  script: async (run, f) => {
    f.emit(run, 'run.started');
    if (/approve|delete|send/i.test(run.input)) {
      run.status = 'waiting_for_approval';
      f.emit(run, 'approval.request', { request_id: `p-${run.id}`, command: 'send_email --to client@example.com', description: '[FAKE HERMES] Send an external email', choices: ['once', 'session', 'deny'] });
      return;
    }
    f.emit(run, 'tool.started', { tool: 'read_file', preview: 'notes.md' });
    await sleep(300);
    f.emit(run, 'tool.completed', { tool: 'read_file', duration: 0.3, error: false });
    const text = `[FAKE HERMES] Received: "${run.input}". This is a test double, not a real agent reply.`;
    for (const w of text.split(/(?<= )/)) { f.emit(run, 'message.delta', { delta: w }); await sleep(40); }
    f.finish(run, 'completed', text);
  },
});
await fake.start(Number(process.env.HC_FAKE_PORT ?? 18642));
const port = new URL(fake.url).port;
fake.addTelegram('tg-demo', [{ role: 'user', content: '[FAKE HERMES] Morning Jeff, what is on today?' }, { role: 'assistant', content: '[FAKE HERMES] Two calls and the budget review.' }]);
console.log(`FAKE Hermes API listening on ${fake.url} (port ${port})`);
