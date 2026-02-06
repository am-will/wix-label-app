const { spawn } = require('child_process');
const electronBinary = require('electron');

const userArgs = process.argv.slice(2);
const electronArgs = ['.', ...userArgs];
const shouldDisableSandbox =
  process.platform === 'linux' && process.env.ELECTRON_ENABLE_SANDBOX !== '1';

if (shouldDisableSandbox) {
  electronArgs.push('--no-sandbox');
  electronArgs.push('--in-process-gpu');
  console.log(
    '[start] Linux sandbox helper is often unavailable in local dev; starting with --no-sandbox and --in-process-gpu. Set ELECTRON_ENABLE_SANDBOX=1 to keep sandbox enabled.'
  );
}

const child = spawn(electronBinary, electronArgs, { stdio: 'inherit' });

child.on('error', (error) => {
  console.error('[start] Failed to launch Electron:', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
