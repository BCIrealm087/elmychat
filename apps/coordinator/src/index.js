import { createCoordinatorServer } from './server.js';

const host = '127.0.0.1';
const port = 3210;
const server = createCoordinatorServer();

server.on('error', (error) => {
  console.error(`Elmychat could not start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Elmychat starter overlay: http://${host}:${port}/`);
  console.log('Scaffold only; native chat adapters are not connected.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close());
}
