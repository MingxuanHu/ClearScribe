import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scanner = fileURLToPath(new URL('../scripts/scan-secrets.mjs', import.meta.url));
function fixture(run: (directory: string, git: (...args: string[]) => void, scan: () => ReturnType<typeof spawnSync>) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), 'clearscribe-scan-test-'));
  const binary = path.join(directory, 'scanner-stub.mjs');
  // Test scan orchestration with a synthetic marker, never a real credential.
  writeFileSync(binary, `#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
function contains(file) {
  return statSync(file).isDirectory()
    ? readdirSync(file).some(name => contains(path.join(file, name)))
    : readFileSync(file, 'utf8').includes('SYNTHETIC_' + 'SECRET_MARKER');
}
if (args[0] === 'dir' && contains(args[1])) process.exit(1);
if (args[0] === 'stdin' && readFileSync(0, 'utf8').includes('SYNTHETIC_' + 'SECRET_MARKER')) process.exit(1);
`, { mode: 0o700 });
  const git = (...args: string[]) => { execFileSync('git', args, { cwd: directory, stdio: 'pipe' }); };
  try {
    git('init', '-q');
    writeFileSync(path.join(directory, '.gitignore'), '.env\ndist/\nserver-dist/\nscanner-stub.mjs\n');
    git('add', '.gitignore');
    git('-c', 'user.name=Scan Test', '-c', 'user.email=scan@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic fixture');
    run(directory, git, () => spawnSync(process.execPath, [scanner], {
      cwd: directory, encoding: 'utf8', env: { ...process.env, GITLEAKS_BIN: binary },
    }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('publication scan excludes ignored untracked environment but rejects force-added or unignored environment', () => {
  fixture((directory, git, scan) => {
    writeFileSync(path.join(directory, '.env'), 'SYNTHETIC_SECRET_MARKER');
    assert.equal(scan().status, 0);
    git('add', '-f', '.env');
    assert.equal(scan().status, 1);
    git('rm', '--cached', '-f', '.env');
    writeFileSync(path.join(directory, '.env.production'), 'SYNTHETIC_SECRET_MARKER');
    assert.equal(scan().status, 1);
  });
});

test('publication scan still checks ignored built assets and staged content differing from working files', () => {
  fixture((directory, git, scan) => {
    const file = path.join(directory, 'example.txt');
    writeFileSync(file, 'SYNTHETIC_SECRET_MARKER'); git('add', 'example.txt');
    writeFileSync(file, 'Clean working copy');
    const staged = scan();
    assert.equal(staged.status, 1);
    assert.match(String(staged.stderr), /Staged diff scan failed/);
    git('add', 'example.txt');
    assert.equal(scan().status, 0);
    mkdirSync(path.join(directory, 'dist'));
    writeFileSync(path.join(directory, 'dist', 'bundle.js'), 'SYNTHETIC_SECRET_MARKER');
    assert.equal(scan().status, 1);
  });
});
