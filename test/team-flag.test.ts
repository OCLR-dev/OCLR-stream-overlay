import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { teamFlagUrl, teamMonogram } from '../ui/teamFlag.ts';
import { createTeamArtHandler } from '../server/team-art.js';
import { SessionStore } from '../server/session/store.js';
import { catalogue } from '../server/session/data.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const teams = () => ({ a: { id: id(1), name: '真实红队', avatarKey: id(11), roster: [] }, b: { id: id(2), name: '真实蓝队', avatarKey: null, roster: [] } });

test('team image URL requires stable ID and version; names never select another image', () => {
  const a = teams().a;
  assert.equal(teamFlagUrl(a), `/api/teams/${a.id}/avatar?v=${a.avatarKey}`);
  assert.equal(teamFlagUrl({ ...a, name: 'Renamed by room' }), teamFlagUrl(a));
  assert.notEqual(teamFlagUrl({ ...a, id: id(2) }), teamFlagUrl(a));
  assert.notEqual(teamFlagUrl({ ...a, avatarKey: id(12) }), teamFlagUrl(a));
  for (const value of [null, undefined, teams().b, { ...a, id: 'archive:1' }, { ...a, avatarKey: undefined }, { ...a, avatarKey: 'https://bad.invalid' }]) assert.equal(teamFlagUrl(value), null);
  assert.equal(teamMonogram('  中国队  '), '中国');
  assert.equal(teamMonogram('ab'), 'AB');
  assert.equal(teamMonogram('😀队名'), '😀队');
  assert.equal(teamMonogram(''), '?');
});

test('image redirects use only the configured public website and reject arbitrary destinations or queries', () => {
  const handler = createTeamArtHandler({ backend: 'https://website.example', key: 'must-not-leak' });
  const path = `/api/teams/${id(1)}/avatar?v=${id(11)}`;
  for (const [method, suffix, expected] of [
    ['GET', path, 302], ['POST', path, 405], ['GET', `/api/teams/no/avatar?v=${id(11)}`, 404],
    ['GET', `/api/teams/${id(1)}/avatar`, 404], ['GET', path + '&v=' + id(12), 404],
    ['GET', path + '&url=https://bad.invalid', 404], ['GET', `/api/teams/${id(1)}/avatar?v=../secret`, 404],
  ] as const) {
    let status: number | undefined; let headers: Record<string, string> = {};
    const res = { writeHead(s: number, h: Record<string, string>) { status = s; headers = h; }, end() {} };
    assert.equal(handler({ method }, res, new URL('http://localhost' + suffix)), true);
    assert.equal(status, expected);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(headers).includes('must-not-leak'));
    if (expected === 302) assert.equal(headers.Location, 'https://website.example' + path);
    else assert.equal(headers.Location, undefined);
  }
});

test('image versions persist through setup, rename, save, restore, swap, replacement and undo; old sessions remain usable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-team-flags-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const store = await SessionStore.open(file);
  const command = (type: string, payload: unknown) => store.command({ id: crypto.randomUUID(), version: store.state.version, type, payload });
  await command('setup', { title: 'Flags', stage: 'group', mode: '4v4', source: '4x3', teams: teams(), pool: [] });
  await command('setting', { field: 'team-name', team: 'a', value: 'Room Red' });
  assert.equal(store.state.match.teams.a.avatarKey, id(11));
  const restored = await SessionStore.open(file);
  assert.deepEqual(restored.snapshot().session.match.teams, store.snapshot().session.match.teams);
  restored.close();
  const before = structuredClone(store.state.match.teams);
  await command('update-setup', { ...store.state.match, teams: { a: before.b, b: { ...before.a, avatarKey: id(12) } }, pool: [] });
  assert.equal(store.state.match.teams.b.avatarKey, id(12));
  assert.equal(store.state.match.teams.a.avatarKey, null);
  await command('undo', {});
  assert.deepEqual(store.state.match.teams, before);
  await assert.rejects(command('update-setup', { ...store.state.match, teams: { ...before, a: { ...before.a, avatarKey: '../image' } }, pool: [] }), /图片标识/);
  const legacy = structuredClone(store.state);
  delete legacy.match.teams.a.avatarKey; delete legacy.match.teams.b.avatarKey;
  const old = new SessionStore({ state: legacy });
  assert.equal(teamFlagUrl(old.snapshot().session.match.teams.a), null);
  store.close(); old.close();
});

test('published catalogue preserves team image versions and missing values', () => {
  const source = { status: 'ready', data: { teams: Object.values(teams()) } };
  assert.deepEqual(catalogue(source).teams.map((team: { avatarKey: string | null }) => team.avatarKey), [id(11), null]);
});
