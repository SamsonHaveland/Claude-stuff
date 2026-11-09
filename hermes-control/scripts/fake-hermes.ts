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
    if (/design how you appear in Hermes Control/.test(run.input) && process.env.HC_FAKE_CHARACTER_IMG) {
      await sleep(1500);
      f.finish(run, 'completed', `[FAKE HERMES] Here is my look.\n\nCHARACTER\nname: Test Character\nrole: [FAKE] Example Role\nbio: [FAKE HERMES] This card came from the test double, not a real agent.\nimage: ${process.env.HC_FAKE_CHARACTER_IMG}`);
      return;
    }
    if (/approve|delete|send/i.test(run.input)) {
      run.status = 'waiting_for_approval';
      f.emit(run, 'approval.request', { request_id: `p-${run.id}`, command: 'send_email --to client@example.com', description: '[FAKE HERMES] Send an external email', choices: ['once', 'session', 'deny'] });
      return;
    }
    f.emit(run, 'tool.started', { tool: 'read_file', preview: 'notes.md' });
    await sleep(300);
    f.emit(run, 'tool.completed', { tool: 'read_file', duration: 0.3, error: false });
    const text = /hostile/i.test(run.input)
      ? '[FAKE HERMES] <img src=x onerror="document.title=\'pwned\'"> <script>document.title="pwned"</script> [click me](javascript:document.title="pwned") **bold still works**'
      : `[FAKE HERMES] **Here's today**, based on what you asked: "${run.input}"

## Priorities
1. **Budget review** with Debra, 10:00
2. Send the *FilmLV* deck to Roxy
3. Follow up on 3 unanswered emails

| Item | Owner | Status |
|---|---|---|
| Budget v4 | Debra | Waiting |
| Deck | Roxy | In progress |

- [x] Calendar checked
- [ ] Confirm call time

Run \`hermes kanban list\` to see tasks, or read [the docs](https://hermes-agent.nousresearch.com).

> This is a test double, not a real agent reply.`;
    for (const w of text.split(/(?<= )/)) { f.emit(run, 'message.delta', { delta: w }); await sleep(40); }
    f.finish(run, 'completed', text);
  },
});
fake.runIdPrefix = `run_${Date.now().toString(36)}_`;
await fake.start(Number(process.env.HC_FAKE_PORT ?? 18642));
const port = new URL(fake.url).port;
fake.addTelegram('tg-demo', [{ role: 'user', content: '[FAKE HERMES] Morning Jeff, what is on today?' }, { role: 'assistant', content: '[FAKE HERMES] Two calls and the budget review.' }]);
console.log(`FAKE Hermes API listening on ${fake.url} (port ${port})`);
