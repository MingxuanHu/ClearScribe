import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);

/** Launch the native file manager without a shell or a folder-selection dialog. */
export async function openFolder(folder: string): Promise<void> {
  if (process.platform === 'darwin') {
    await exec('/usr/bin/open', ['-a', 'Finder', folder], { timeout: 10000, maxBuffer: 8192 });
    return;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const explorer = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
      const child = spawn(explorer, [folder], { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      // Explorer can hand off to an existing process; do not depend on its exit code.
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    return;
  }
  throw new Error('Opening the save folder requires macOS or Windows.');
}
