import { spawnOwned, stopOwned } from '../process-supervisor';

const [cwd, command, ...args] = process.argv.slice(2);
const child = spawnOwned(command, args, { cwd, env: process.env });
process.stdin.pipe(child.stdin!);
child.stdout!.pipe(process.stdout);
child.stderr!.pipe(process.stderr);
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
  process.stdin.destroy();
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void stopOwned(child, 1500).finally(() => process.exit(1));
  });
}
