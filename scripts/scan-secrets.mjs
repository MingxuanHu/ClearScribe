import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const binary = process.env.GITLEAKS_BIN || 'gitleaks';
if (spawnSync(binary, ['version'], { stdio: 'ignore' }).status !== 0) {
  console.error('gitleaks is required. Install the official tool or set GITLEAKS_BIN. Scan NOT performed.'); process.exit(2);
}
const base = ['--redact', '--no-banner', '--no-color', '--log-level', 'warn', '--ignore-gitleaks-allow'];
function scan(args) {
  const result = spawnSync(binary, [...args, ...base], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Secret scan failed. Do not publish; inspect redacted locations locally.');
}
const stage = mkdtempSync(path.join(tmpdir(), 'clearscribe-public-scan-'));
try {
  // Inventory current tracked + untracked deliverables without copying ignored runtime data.
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const privateFiles = files.filter(f => /\.(webm|wav|mp3|m4a|ogg|part|pem|key|p12)$/i.test(f) || /(^|\/)(recordings|exports|private-samples|runtime-data)\//.test(f) || /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
  const historyFiles = execFileSync('git', ['log', '--all', '--format=', '--name-only'], { encoding: 'utf8' }).split('\n');
  if (privateFiles.length || historyFiles.some(f => /\.(webm|wav|mp3|m4a|ogg|part|pem|key|p12)$/i.test(f) || /(^|\/)\.env$/.test(f))) throw new Error('Private media or configuration found in deliverables/history. Review file locations before publishing.');
  for (const file of files) {
    if (!existsSync(file)) continue;
    const destination = path.join(stage, file); mkdirSync(path.dirname(destination), { recursive: true }); copyFileSync(file, destination);
  }
  scan(['dir', stage]);
  for (const directory of ['dist', 'server-dist']) if (existsSync(directory)) scan(['dir', directory]);
  for (const file of readdirSync('.').filter(f => /^\.env(?:\.|$)/.test(f) && f !== '.env.example')) scan(['dir', file]);
  scan(['git', '--log-opts=--all', '.']);
  // Index contents can differ from working files; scan the complete staged patch as well.
  const diff = execFileSync('git', ['diff', '--cached', '--no-ext-diff'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const result = spawnSync(binary, ['stdin', ...base], { input: diff, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error('Staged diff scan failed.');
  console.log('Secret scan passed: deliverables, built assets, local environment files if present, all Git history, and staged diff. Private-media filename inventory passed.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rmSync(stage, { recursive: true, force: true }); }
