import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCoordinatorServer } from './server.js';
import { OperatorController } from './operator.js';

let operator;
let server;
let timer;
let stopping = false;
let stopWork;
let reportWork = Promise.resolve();
const reportPath = resolve('.runtime/proof/coordinator-report.json');

function saveReport() {
  const report = operator?.health();
  if (!report) return Promise.resolve();
  reportWork = reportWork.catch(() => {}).then(async () => {
    await mkdir(resolve('.runtime/proof'), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  });
  return reportWork;
}
function stop() {
  if (stopWork) return stopWork;
  stopping = true; clearTimeout(timer);
  stopWork = (async () => {
    const closing = server ? new Promise((done) => server.close(done)) : Promise.resolve();
    await operator?.close(); await closing; await saveReport();
    if (operator) console.log(`Coordinator stopped. Cleanup evidence: ${reportPath}`);
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
  return stopWork;
}
try {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: npm start -- [path-to-coordinator-config.json]');
  operator = new OperatorController({ statePath: resolve('.runtime/operator.json') });
  await operator.load(args[0] ? JSON.parse(await readFile(resolve(args[0]), 'utf8')) : undefined);
  server = createCoordinatorServer({ operator, health: () => operator.health() });
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; void stop(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
  server.listen(3210, '127.0.0.1', () => {
    console.log('Elmychat controls: http://127.0.0.1:3210/');
    console.log('OBS Browser Source: http://127.0.0.1:3210/overlay');
    let previous; let lastReport = 0;
    async function tick() {
      if (stopping) return;
      await operator.tick();
      const state = operator.state();
      const status = JSON.stringify({ status: state.status, lastError: state.lastError, sources: state.sources });
      if (status !== previous) { console.log(status); previous = status; }
      try { if (!stopping && Date.now() - lastReport >= 2000) { await saveReport(); lastReport = Date.now(); } }
      catch (error) { console.error(`Report could not be saved: ${error.message}`); }
      if (!stopping) timer = setTimeout(tick, 100);
    }
    void tick();
  });
} catch (error) { console.error(error.message); process.exitCode = 1; await stop(); }
