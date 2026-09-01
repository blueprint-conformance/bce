import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'bce-package-proof-'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], { cwd: root, encoding: 'utf8' }),
);
const tarball = join(scratch, packed[0].filename);
execFileSync('npm', ['init', '-y'], { cwd: scratch, stdio: 'ignore' });
execFileSync('npm', ['install', '--ignore-scripts', tarball], { cwd: scratch, stdio: 'inherit' });
const bin = join(scratch, 'node_modules', '.bin', 'bce');
const output = execFileSync(bin, ['demo'], { cwd: scratch, encoding: 'utf8' });

for (const marker of [
  'GREEN conformant: score 100, exit 0',
  'RED drift-forbidden-import:',
  'violation no-direct-provider-sdk',
  'package fixtures discriminate GREEN from RED',
]) {
  if (!output.includes(marker)) throw new Error(`packed consumer proof missing marker: ${marker}`);
}

const installed = JSON.parse(readFileSync(join(scratch, 'node_modules', 'bce-engine', 'package.json'), 'utf8'));
if (installed.engines?.node !== '>=22') throw new Error('packed package does not enforce Node >=22');
process.stdout.write(output);
process.stdout.write(`packed consumer proof: PASS (${packed[0].filename})\n`);
