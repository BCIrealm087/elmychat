import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { discover } from '../../packages/browser-control/cdp.js';
import { runNativeProof } from './run-native-proof.js';

const args = process.argv.slice(2);
const mode = args.shift();
let active;
try {
  if (mode === 'targets') {
    const endpoint = args[0] ?? 'http://127.0.0.1:9222';
    const data = await discover(endpoint);
    console.log(JSON.stringify({ browser: data.version.Browser, targets: data.targets.map(({ id, title, url }) => ({ id, title, url })) }, null, 2));
  } else if (mode === 'pair' && args.length === 1) {
    const config = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
    active = await runNativeProof(config);
    const path = resolve('.runtime/proof/native-report.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(active.report, null, 2) + '\n');
    console.log(`Native geometry passed. Report: ${path}`);
    console.log('Check the two original native messages and transparent gap in OBS. Press Ctrl+C to restore styles and disconnect.');
    let stopping = false;
    async function stop() {
      if (stopping) return;
      stopping = true;
      const cleanup = await active.restore();
      console.log(JSON.stringify({ cleanup }));
    }
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } else throw new Error('Usage: npm run proof:targets -- [loopback-endpoint] OR npm run proof:native -- path-to-config.json');
} catch (error) {
  console.error(error.message);
  if (error.proofReport) {
    const path = resolve('.runtime/proof/native-report.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(error.proofReport, null, 2) + '\n');
    console.error(`Blocked proof report: ${path}`);
  }
  process.exitCode = 1;
}
