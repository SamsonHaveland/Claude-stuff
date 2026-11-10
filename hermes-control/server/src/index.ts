import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { buildApp } from './app.js';
import { discoverProfiles } from './hermes/discovery.js';
import { bootstrap } from './services/bootstrap.js';

const cfg = loadConfig();
const db = openDb(join(cfg.dataDir, 'hermes-control.db'));
const discovered = discoverProfiles(cfg.hermes.home);
bootstrap(db, cfg, discovered);

const { app, ctx } = await buildApp({ cfg, db, logger: true });
app.log.info({ hermesMode: cfg.hermes.mode, profiles: discovered.map((p) => p.id) }, 'profile discovery (read-only)');

const resumed = ctx.runs.resumeOpenRuns();
if (resumed) app.log.info({ resumed }, 'resuming unfinished Hermes runs');
if (cfg.hermes.mode === 'live') ctx.mirror.start(cfg.telegramMirror.filter((t) => t.enabled));
if (cfg.hermes.mode === 'live') ctx.taskFeed.start(30); // Kanban work shown in the agents' chats

await app.listen({ host: cfg.server.host, port: cfg.server.port });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} received, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  });
}
