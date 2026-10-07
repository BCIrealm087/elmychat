import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCoordinatorServer } from './server.js';
import { NativeCoordinator } from './runtime.js';

let runtime;
let server;
let timer;
let stopping = false;
let stopWork;
const reportPath = resolve('.runtime/proof/coordinator-report.json');

async function saveReport() {
  if (!runtime) return;
  await mkdir(resolve('.runtime/proof'), { recursive: true });
  await writeFile(reportPath, JSON.stringify(runtime.diagnostics(), null, 2) + '\n');
}

function stop() {
  if (stopWork) return stopWork;
  stopping = true;
  clearTimeout(timer);
  stopWork = (async () => {
    const closing = server ? new Promise((done) => server.close(done)) : Promise.resolve();
    await runtime?.stop();
    await closing;
    await saveReport();
    if (runtime) console.log(`Coordinator stopped. Cleanup evidence: ${reportPath}`);
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
  return stopWork;
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: npm start -- [path-to-coordinator-config.json]');
  if (args[0]) runtime = new NativeCoordinator(JSON.parse(await readFile(resolve(args[0]), 'utf8')));
  server = createCoordinatorServer(runtime ? { health: () => runtime.diagnostics() } : {});
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; void stop(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
  server.listen(3210, '127.0.0.1', () => {
    console.log('Elmychat: http://127.0.0.1:3210/');
    if (!runtime) { console.log('No coordinator config supplied. Native shell: /native?twitch=CHANNEL&youtube=VIDEO_ID'); return; }
    let previous;
    let lastReport = 0;
    async function tick() {
      if (stopping) return;
      const state = await runtime.step();
      const status = JSON.stringify({ status: state.status, lastError: state.lastError, sources: state.sources });
      if (status !== previous) { console.log(status); previous = status; }
      try {
        if (!stopping && Date.now() - lastReport >= 2000) { await saveReport(); lastReport = Date.now(); }
      } catch (error) { console.error(`Report could not be saved: ${error.message}`); }
      if (!stopping) timer = setTimeout(tick, runtime.config.intervalMs);
    }
    void tick();
  });
} catch (error) { console.error(error.message); process.exitCode = 1; await stop(); }
