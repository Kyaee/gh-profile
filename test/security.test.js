import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import test from 'node:test';
import { plainText } from '../src/text.js';
import { renderScreen } from '../src/screen.js';
import { githubUrl, fetchProfileOverview } from '../src/profile-page.js';
import { decodeAvatar, fetchAvatar } from '../src/avatar.js';
import { fetchProfile, fetchContributionCalendar, isValidUsername } from '../src/github.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const hostile = '\u001b]52;c;SGFybWxlc3M=\u0007\u001b[2J\u001b]8;;https://example.invalid\u001b\\';
const forbidden = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

test('terminal text strips clipboard, hyperlink, title, and color controls', () => {
  for (const controls of [hostile, '\u001b]0;untrusted title\u0007', '\u001b[31m', '\u009b31m', '\u001bPcommands\u001b\\']) {
    const text = plainText(`before${controls}after`);
    assert.ok(text.startsWith('before'));
    assert.ok(text.endsWith('after'));
    assert.equal(forbidden.test(text), false);
  }
  assert.equal(plainText(`safe${hostile}`), 'safe');
});

test('terminal text strips raw controls and direction overrides', () => {
  assert.equal(forbidden.test(plainText('hello\u0000\u0007\u007f\u009d\u202e\u2066world')), false);
  assert.equal(plainText('hello\n\tworld'), 'hello world');
});

test('terminal text preserves ordinary Unicode and emoji joiners', () => {
  const text = '👨‍💻 Café 日本語 مرحبا';
  assert.equal(plainText(text), text);
  assert.equal(plainText(null), '');
});

test('TUI metadata cannot introduce terminal controls', () => {
  const data = {
    profile: { login: 'safe', name: `Name${hostile}`, bio: `Bio${hostile}`, company: `Company${hostile}`, followers: 1, following: 2 },
    repositories: [{ name: `Repo${hostile}`, description: `Description${hostile}`, language: `JavaScript${hostile}`, stargazers_count: 1 }],
    overview: { readme: [{ text: `README${hostile}` }], pinned: [], achievements: [{ name: `Badge${hostile}` }], highlights: [], organizations: [] },
  };
  for (const tab of ['overview', 'repositories', 'readme']) {
    for (const theme of ['github', 'transparent']) {
      const frame = renderScreen(data, { tab, theme, search: '', cursor: 0, scroll: 0, calendarLoading: false }, { width: 100, height: 40 });
      assert.equal(forbidden.test(stripVTControlCharacters(frame.text)), false);
      assert.equal(frame.text.includes('\u001b]'), false);
      if (theme === 'transparent') assert.equal(frame.text.includes('48;2;'), false);
    }
  }
});

test('browser URLs accept only ordinary HTTPS GitHub and gist links', () => {
  assert.equal(githubUrl('/owner/repository'), 'https://github.com/owner/repository');
  assert.equal(githubUrl('https://gist.github.com/owner/id'), 'https://gist.github.com/owner/id');
  for (const value of [undefined, '', 'javascript:alert(1)', 'file:///etc/passwd', 'http://github.com/owner', 'https://github.com.evil.invalid/', '//evil.invalid/', 'https://user:password@github.com/', 'https://github.com:444/', 'https://github.com/\u001b[2J']) {
    assert.equal(githubUrl(value), null);
  }
});

test('usernames cannot introduce paths, query strings, or terminal controls', () => {
  for (const value of ['../admin', 'safe?tab=stars', 'safe/other', 'safe\u001b[2J', '-safe', 'safe--name']) assert.equal(isValidUsername(value), false);
  assert.equal(isValidUsername('safe-name'), true);
});

test('avatar decoding rejects oversized and invalid image data', () => {
  assert.throws(() => decodeAvatar(Buffer.alloc(1024 * 1024 + 1)), /too large/);
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(10000, 16);
  png.writeUInt32BE(10000, 20);
  assert.throws(() => decodeAvatar(png), /dimensions/);
  assert.throws(() => decodeAvatar(Buffer.from('not an image')));
});

test('all outbound fetches stay on GitHub hosts and reject redirects', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (value, options) => {
    const url = new URL(value);
    requests.push(url);
    assert.ok(['api.github.com', 'github.com', 'avatars.githubusercontent.com'].includes(url.hostname));
    assert.equal(options.redirect, 'error');
    return new Response(url.hostname === 'api.github.com' ? (url.pathname.endsWith('/repos') ? '[]' : '{"login":"safe"}') : '', { status: 200 });
  };
  try {
    for (const url of ['https://evil.invalid/image', 'http://avatars.githubusercontent.com/u/1', 'https://user:password@avatars.githubusercontent.com/u/1', 'https://avatars.githubusercontent.com:444/u/1']) {
      assert.equal(await fetchAvatar(url), null);
    }
    assert.equal(requests.length, 0);
    await fetchProfile('safe');
    await fetchProfileOverview({ login: 'safe', avatar_url: 'https://avatars.githubusercontent.com/u/1' });
    await fetchContributionCalendar('safe');
    assert.equal(requests.length, 6);
  } finally {
    globalThis.fetch = original;
  }
});

test('actual CLI fallback strips hostile data from offline API responses', () => {
  mkdirSync(resolve(root, '.local'), { recursive: true });
  const directory = mkdtempSync(resolve(root, '.local/security-test-'));
  try {
    const result = spawnSync(process.execPath, ['--require', resolve(root, 'fixtures/security-fetch.cjs'), resolve(root, 'bin/gh-profile.js'), 'safe', '--no-color'], {
      env: { ...process.env, XDG_CONFIG_HOME: directory, APPDATA: directory, NO_COLOR: '1' },
      encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Safe bio'));
    assert.ok(result.stdout.includes('Safe description'));
    assert.equal(forbidden.test(result.stdout), false);
    assert.equal(result.stdout.includes('SGFybWxlc3M='), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
