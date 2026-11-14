import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (process.argv[2]) {
  env.OMEGA_RENDERER_URL = process.argv[2];
}

const child = spawn(electronPath, ['.'], {
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

