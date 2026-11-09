import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The release workflow serializes allocation through publication. Re-running
// an older commit reuses its tag, even after newer versions have shipped.
export function windowsReleaseVersion(commit, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected an exact release commit SHA');
  const tags = args => execFileSync('git', ['tag', ...args], { cwd, encoding: 'utf8' }).trim().split(/\r?\n/);
  const highest = values => values.reduce((max, tag) => {
    const match = /^v0\.1\.(0|[1-9][0-9]*)$/.exec(tag);
    if (!match) return max;
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number)) throw new Error('Windows release version exceeds the supported range');
    return Math.max(max, number);
  }, -1);
  const existing = highest(tags(['--points-at', commit]));
  const number = existing >= 0 ? existing : highest(tags(['--list', 'v0.1.*'])) + 1;
  if (!Number.isSafeInteger(number)) throw new Error('Windows release version exceeds the supported range');
  return `0.1.${number}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = windowsReleaseVersion(process.env.GITHUB_SHA);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  process.stdout.write(`${version}\n`);
}
