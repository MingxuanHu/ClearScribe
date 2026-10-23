import { readFile, readdir } from 'node:fs/promises';
const root = JSON.parse(await readFile('package.json', 'utf8'));
for (const name of Object.keys(root.dependencies)) {
  const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  const files = await readdir(`node_modules/${name}`);
  console.log(`${name}@${pkg.version}: ${pkg.license}; ${files.filter(f => /^(license|notice)/i.test(f)).join(', ')}`);
  if (!pkg.license || !files.some(f => /^license/i.test(f))) process.exitCode = 1;
}
