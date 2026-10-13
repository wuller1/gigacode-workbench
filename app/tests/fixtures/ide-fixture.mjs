// Protocol/process fixture only. This does not simulate real language or IDE functionality.
import http from 'node:http';
import path from 'node:path';
const root = process.argv[2];
if (path.basename(root) === 'exit-before-ready') process.exit(7);
const server = http.createServer((req, res) => {
  if (req.headers['x-workbench-ide-token'] !== process.env.WORKBENCH_IDE_TOKEN) { res.writeHead(401).end(); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ root, config: process.env.THEIA_CONFIG_DIR, pid: process.pid }));
});
server.listen(0, '127.0.0.1', () => {
  console.log('Fixture secret must be redacted:', process.env.WORKBENCH_IDE_TOKEN);
  if (path.basename(root) === 'never-ready') return;
  const ready = `WORKBENCH_IDE_READY ${JSON.stringify({ port: server.address().port, version: 'fixture' })}\n`;
  process.stdout.write(ready.slice(0, 12));
  setTimeout(() => process.stdout.write(ready.slice(12)), 20);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
