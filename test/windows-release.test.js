import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { windowsReleaseVersion } from '../.github/scripts/windows-release-version.mjs';

test('Windows versions follow selected releases rather than main commit count, and retries reuse their original tag', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'oclr-release-version-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'CI', GIT_AUTHOR_EMAIL: 'ci@example.invalid', GIT_COMMITTER_NAME: 'CI', GIT_COMMITTER_EMAIL: 'ci@example.invalid' },
  }).trim();
  const commit = () => { git('commit', '--allow-empty', '-m', 'Selected source'); return git('rev-parse', 'HEAD'); };
  const setVersion = async version => {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ version }));
    git('add', 'package.json');
  };
  git('init', '--quiet');
  await setVersion('0.1.0');
  const first = commit();
  assert.equal(windowsReleaseVersion(first, cwd), '0.1.0');
  git('tag', 'v0.0.9', first);
  git('tag', 'unrelated-tag', first);
  assert.equal(windowsReleaseVersion(first, cwd), '0.1.0');
  commit(); commit();
  const selected = commit();
  assert.equal(windowsReleaseVersion(selected, cwd), '0.1.0');
  git('tag', 'v0.1.0', selected);
  assert.equal(windowsReleaseVersion(selected, cwd), '0.1.0');
  const next = commit();
  assert.equal(windowsReleaseVersion(next, cwd), '0.1.1');
  git('tag', 'v0.1.1', next);
  assert.equal(windowsReleaseVersion(commit(), cwd), '0.1.2');
  assert.equal(windowsReleaseVersion(selected, cwd), '0.1.0');

  git('tag', 'v0.1.9', commit());
  await setVersion('0.2.0');
  const newSeries = commit();
  assert.equal(windowsReleaseVersion(newSeries, cwd), '0.2.0');
  git('tag', 'v0.2.0', newSeries);
  git('tag', 'v0.2.9-rc.1', newSeries);
  assert.equal(windowsReleaseVersion(commit(), cwd), '0.2.1');
  assert.equal(windowsReleaseVersion(newSeries, cwd), '0.2.0');
  assert.equal(windowsReleaseVersion(selected, cwd), '0.1.0');

  await setVersion('0.3.2');
  assert.equal(windowsReleaseVersion(commit(), cwd), '0.3.2');
});
