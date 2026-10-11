import { spawn } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { fetchProfile, fetchStarredPage } from './github.js';
import { saveConfig } from './config.js';
import { getPalette, nextTheme, supportsColor } from './theme.js';

const CSI = '\u001b[';
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const CLEAR_SCREEN = `${CSI}2J${CSI}H`;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function clean(value) {
  return String(value ?? '')
    .replace(ANSI_PATTERN, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayWidth(value) {
  return [...clean(value)].reduce((width, character) => {
    const point = character.codePointAt(0);
    if (point === 0x200d || (point >= 0xfe00 && point <= 0xfe0f)) return width;
    if (/\p{Mark}/u.test(character)) return width;
    return width + (
      point >= 0x1100 && (
        point <= 0x115f
        || point === 0x2329
        || point === 0x232a
        || (point >= 0x2e80 && point <= 0xa4cf)
        || (point >= 0xac00 && point <= 0xd7a3)
        || (point >= 0xf900 && point <= 0xfaff)
        || (point >= 0xfe10 && point <= 0xfe19)
        || (point >= 0xfe30 && point <= 0xfe6f)
        || (point >= 0xff00 && point <= 0xff60)
        || (point >= 0xffe0 && point <= 0xffe6)
        || (point >= 0x1f300 && point <= 0x1faff)
      ) ? 2 : 1
    );
  }, 0);
}

function truncate(value, width) {
  const text = clean(value);
  if (displayWidth(text) <= width) return text;
  if (width <= 1) return '…'.slice(0, width);

  let output = '';
  let used = 0;
  for (const character of text) {
    const nextWidth = displayWidth(character);
    if (used + nextWidth > width - 1) break;
    output += character;
    used += nextWidth;
  }
  return `${output}…`;
}

function wrap(value, width, maxLines = Infinity) {
  const words = clean(value).split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (displayWidth(candidate) <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = truncate(word, width);
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function style(text, palette, color, foreground = 'text', background) {
  if (!color) return text;
  const codes = [];
  const fg = palette[foreground];
  const bg = background ? palette[background] : null;
  if (fg) codes.push(`38;2;${fg.join(';')}`);
  if (bg) codes.push(`48;2;${bg.join(';')}`);
  if (background === 'selected') codes.push('1');
  if (codes.length === 0) return text;
  return `${CSI}${codes.join(';')}m${text}${CSI}0m`;
}

function line(text, width, palette, color, foreground = 'text', background = 'background') {
  const clipped = truncate(text, width);
  const padding = Math.max(0, width - displayWidth(clipped));
  return style(`${clipped}${' '.repeat(padding)}`, palette, color, foreground, background);
}

function compactNumber(value) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function relativeDate(value) {
  if (!value) return 'unknown';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const days = Math.floor(elapsed / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function profileFields(profile) {
  return [
    profile.company && `Company  ${clean(profile.company)}`,
    profile.location && `Location ${clean(profile.location)}`,
    profile.blog && `Website  ${clean(profile.blog)}`,
    profile.email && `Email    ${clean(profile.email)}`,
    profile.twitter_username && `Social   @${clean(profile.twitter_username)}`,
    profile.created_at && `Joined   ${new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`,
  ].filter(Boolean);
}

function profilePane(profile, width, height, palette, color) {
  const inner = Math.max(8, width - 4);
  const result = [
    { text: `[ ${clean(profile.login).slice(0, 1).toUpperCase()} ]`, foreground: 'accent' },
    { text: clean(profile.name) || clean(profile.login), foreground: 'text' },
    { text: `@${clean(profile.login)}`, foreground: 'muted' },
    { text: '' },
    ...wrap(profile.bio || 'No bio provided.', inner, 4).map((text) => ({ text, foreground: 'text' })),
    { text: '' },
    ...profileFields(profile).flatMap((field) => wrap(field, inner, 2).map((text) => ({ text, foreground: 'muted' }))),
    { text: '' },
    { text: `${compactNumber(profile.followers)} followers`, foreground: 'accent' },
    { text: `${compactNumber(profile.following)} following`, foreground: 'accent' },
    { text: `${compactNumber(profile.public_repos)} repositories`, foreground: 'accent' },
    { text: '' },
    { text: `github.com/${clean(profile.login)}`, foreground: 'link' },
  ];
  return result.slice(0, height).map((item) => line(item.text, width, palette, color, item.foreground || 'text', 'panel'));
}

function repoLabel(repository, width) {
  const parts = [
    clean(repository.name),
    repository.language && clean(repository.language),
    `★ ${compactNumber(repository.stargazers_count)}`,
    repository.fork && 'fork',
  ].filter(Boolean);
  const meta = parts.slice(1).join(' · ');
  const available = Math.max(1, width - (displayWidth(meta) ? displayWidth(meta) + 3 : 0));
  return `${truncate(parts[0], available)}${meta ? `  ${meta}` : ''}`;
}

function filteredRepositories(repositories, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return repositories;
  return repositories.filter((repository) => [
    repository.name,
    repository.description,
    repository.language,
  ].some((field) => String(field || '').toLowerCase().includes(normalized)));
}

function activeRepositories(data, state) {
  return state.tab === 'stars' ? state.starredRepositories : data.repositories;
}

function renderContent(repositories, state, width, height, palette, color) {
  const result = [];
  const visibleRepositories = state.tab === 'stars' ? state.starredRepositories : repositories;
  const matches = filteredRepositories(visibleRepositories, state.search);
  const selected = matches[state.cursor];
  const inner = Math.max(8, width - 4);

  if (state.tab === 'overview') {
    result.push({ text: 'Overview', foreground: 'accent' });
    result.push({ text: 'Public repositories', foreground: 'muted' });
    const count = Math.max(0, Math.min(8, height - 5));
    const recent = repositories.slice(0, count);
    recent.forEach((repository, index) => {
      result.push({
        text: repoLabel(repository, inner),
        foreground: 'link',
        background: index === state.cursor ? 'selected' : 'panel',
      });
    });
    if (repositories.length === 0) result.push({ text: 'No public repositories.', foreground: 'muted' });
    if (repositories.length > recent.length) {
      result.push({ text: `Open Repositories to browse all ${repositories.length}.`, foreground: 'muted' });
    }
    result.push({ text: '' });
    if (selected) {
      result.push({ text: `Selected: ${clean(selected.full_name)}`, foreground: 'accent' });
      wrap(selected.description || 'No description provided.', inner, Math.max(1, height - result.length - 1))
        .forEach((text) => result.push({ text, foreground: 'text' }));
      result.push({ text: `Updated ${relativeDate(selected.pushed_at)} · ${selected.html_url}`, foreground: 'muted' });
    }
  } else {
    const isStars = state.tab === 'stars';
    const title = isStars
      ? `Stars (${state.starredRepositories.length}${state.starsHasMore ? '+' : ''})`
      : `Repositories (${repositories.length})`;
    result.push({ text: state.search ? `${title} / filter: ${state.search}` : title, foreground: 'accent' });
    if (state.searchMode) result.push({ text: 'Type to search · Enter to apply · Esc to clear', foreground: 'muted' });
    else if (isStars && state.starsLoading) result.push({ text: 'Loading starred repositories…', foreground: 'muted' });
    else if (isStars && state.starsError) result.push({ text: state.starsError, foreground: 'muted' });
    else if (isStars && state.starsHasMore) result.push({ text: 'Press n to load the next page of stars', foreground: 'muted' });
    else result.push({ text: 'Sorted by most recently updated', foreground: 'muted' });
    if (selected) {
      result.push({ text: `${clean(selected.full_name)}  ·  ${compactNumber(selected.stargazers_count)} stars`, foreground: 'link' });
      const descriptionLines = wrap(selected.description || 'No description provided.', inner, 2);
      descriptionLines.forEach((text) => result.push({ text, foreground: 'text' }));
      result.push({ text: `Updated ${relativeDate(selected.pushed_at)} · Press o to open`, foreground: 'muted' });
    }
    result.push({ text: '' });

    const listStart = result.length;
    const visibleCount = Math.max(0, height - listStart);
    const maxOffset = Math.max(0, matches.length - visibleCount);
    state.offset = Math.min(Math.max(0, state.cursor - visibleCount + 1), maxOffset);
    const visible = matches.slice(state.offset, state.offset + visibleCount);
    visible.forEach((repository, index) => {
      const absolute = state.offset + index;
      result.push({
        text: repoLabel(repository, inner),
        foreground: absolute === state.cursor ? 'text' : 'link',
        background: absolute === state.cursor ? 'selected' : 'panel',
      });
    });
    if (matches.length === 0 && !(isStars && (state.starsLoading || state.starsError))) {
      const emptyMessage = state.search
        ? 'No repositories match this filter.'
        : isStars && !state.starsLoaded
          ? 'Loading starred repositories…'
          : isStars
            ? 'No starred repositories.'
            : 'No public repositories.';
      result.push({ text: emptyMessage, foreground: 'muted' });
    }
    else if (matches.length > visible.length) result.push({ text: `${state.cursor + 1} of ${matches.length} repositories`, foreground: 'muted' });
  }

  return result.slice(0, height).map((item) => line(
    item.text,
    width,
    palette,
    color,
    item.foreground || 'text',
    item.background || 'panel',
  ));
}

function renderScreen(data, state, options) {
  const width = Math.max(24, stdout.columns || 80);
  const height = Math.max(8, stdout.rows || 24);
  const palette = getPalette(state.theme);
  const color = supportsColor(options);
  const contentHeight = Math.max(1, height - 3);
  const header = line(
    `GitHub Profile  /  @${clean(data.profile.login)}${data.profile.name ? `  ·  ${clean(data.profile.name)}` : ''}`,
    width,
    palette,
    color,
    'text',
    'background',
  );
  const tabs = line(
    `${state.tab === 'overview' ? '[ Overview ]' : '  Overview  '}   ${state.tab === 'repositories' ? '[ Repositories ]' : '  Repositories  '}   ${state.tab === 'stars' ? '[ Stars ]' : '  Stars  '}   theme: ${state.theme}`,
    width,
    palette,
    color,
    'muted',
    'background',
  );

  let contentLines;
  if (width >= 96) {
    const sidebarWidth = Math.min(34, Math.max(27, Math.floor(width * 0.28)));
    const gapWidth = 1;
    const mainWidth = Math.max(8, width - sidebarWidth - gapWidth);
    const sidebar = profilePane(data.profile, sidebarWidth, contentHeight, palette, color);
    const main = renderContent(data.repositories, state, mainWidth, contentHeight, palette, color);
    contentLines = Array.from({ length: contentHeight }, (_, index) => (
      `${sidebar[index] || line('', sidebarWidth, palette, color, 'text', 'panel')}`
      + `${line('', gapWidth, palette, color, 'text', 'background')}`
      + `${main[index] || line('', mainWidth, palette, color, 'text', 'panel')}`
    ));
  } else {
    const summaryHeight = state.tab === 'overview' ? Math.min(7, contentHeight) : Math.min(1, contentHeight);
    const summary = state.tab === 'overview'
      ? [
        { text: `${clean(data.profile.name) || clean(data.profile.login)}  ·  @${clean(data.profile.login)}`, foreground: 'text' },
        ...wrap(data.profile.bio || 'No bio provided.', width - 4, 2).map((text) => ({ text, foreground: 'muted' })),
        { text: `${compactNumber(data.profile.followers)} followers  ·  ${compactNumber(data.profile.following)} following  ·  ${compactNumber(data.profile.public_repos)} repos`, foreground: 'accent' },
        ...profileFields(data.profile).slice(0, 2).map((text) => ({ text, foreground: 'muted' })),
      ]
      : [{ text: `@${clean(data.profile.login)}  ·  ${clean(data.profile.name)}`, foreground: 'muted' }];
    const summaryLines = summary.slice(0, summaryHeight).map((item) => line(item.text, width, palette, color, item.foreground, 'panel'));
    const mainLines = renderContent(
      data.repositories,
      state,
      width,
      Math.max(0, contentHeight - summaryLines.length),
      palette,
      color,
    );
    contentLines = [...summaryLines, ...mainLines];
  }

  while (contentLines.length < contentHeight) contentLines.push(line('', width, palette, color, 'text', 'background'));
  const footerText = state.searchMode
    ? 'Type to filter  ·  Enter apply  ·  Esc clear  ·  Ctrl+C quit'
    : width < 90
      ? '↑↓ move · Enter open · / find · n next · t theme · r refresh · q quit'
      : '↑/↓ move · Enter open · o browser · / search · Tab views · n next stars · t theme · r refresh · q quit';
  const footer = line(state.message || footerText, width, palette, color, state.message ? 'accent' : 'muted', 'background');
  return [header, tabs, ...contentLines.slice(0, contentHeight), footer].join('\n');
}

function openUrl(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export function startTui(initialData, options = {}) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('The interactive profile view needs a terminal.'));
  }

  return new Promise((resolve) => {
    let data = initialData;
    const state = {
      theme: options.theme,
      tab: 'overview',
      cursor: 0,
      offset: 0,
      search: '',
      searchMode: false,
      starredRepositories: [],
      starsPage: 0,
      starsHasMore: false,
      starsLoaded: false,
      starsLoading: false,
      starsError: '',
      message: '',
      busy: false,
    };
    const colorOptions = { noColor: options.noColor };
    let closed = false;
    let messageTimer;

    const draw = () => {
      if (closed) return;
      stdout.write(`${CSI}H${renderScreen(data, state, colorOptions)}`);
    };

    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(messageTimer);
      stdin.off('data', onData);
      stdout.off('resize', draw);
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      stdin.setRawMode(false);
      stdout.write(`${SHOW_CURSOR}${CSI}0m\n`);
      stdin.pause();
      resolve();
    };

    const status = (message) => {
      state.message = message;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => {
        state.message = '';
        draw();
      }, 2400);
      draw();
    };

    const reload = async () => {
      if (state.busy) return;
      state.busy = true;
      state.message = 'Refreshing profile…';
      draw();
      try {
        data = await fetchProfile(data.profile.login);
        state.cursor = Math.min(state.cursor, Math.max(0, filteredRepositories(data.repositories, state.search).length - 1));
        state.message = 'Profile refreshed';
      } catch (error) {
        state.message = error.message;
      } finally {
        state.busy = false;
        draw();
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => {
          state.message = '';
          draw();
        }, 2400);
      }
    };

    const loadStars = async (nextPage = false) => {
      if (state.starsLoading || (nextPage && !state.starsHasMore)) return;
      const page = nextPage ? state.starsPage + 1 : 1;
      state.starsLoading = true;
      state.starsError = '';
      state.message = `Loading starred repositories (page ${page})…`;
      draw();
      try {
        const result = await fetchStarredPage(data.profile.login, page);
        state.starredRepositories.push(...result.repositories);
        state.starsPage = page;
        state.starsHasMore = result.hasNextPage;
        state.starsLoaded = true;
      } catch (error) {
        state.starsError = error.message;
      } finally {
        state.starsLoading = false;
        state.message = '';
        draw();
      }
    };

    const selectTab = (tab) => {
      state.tab = tab;
      state.cursor = 0;
      state.offset = 0;
      state.search = '';
      state.searchMode = false;
      draw();
      if (tab === 'stars' && !state.starsLoaded && !state.starsLoading) void loadStars();
    };

    const onData = (buffer) => {
      const key = buffer.toString('utf8');
      if (key === '\u0003' || (key === 'q' && !state.searchMode)) return finish();
      if (state.busy) return;

      if (state.searchMode) {
        if (key === '\u001b') {
          state.search = '';
          state.searchMode = false;
          state.cursor = 0;
        } else if (key === '\r' || key === '\n') {
          state.searchMode = false;
        } else if (key === '\u007f' || key === '\b') {
          state.search = [...state.search].slice(0, -1).join('');
          state.cursor = 0;
        } else if (key.length === 1 && key >= ' ') {
          state.search += key;
          state.cursor = 0;
        }
        draw();
        return;
      }

      if (key === 't') {
        state.theme = nextTheme(state.theme);
        saveConfig({ theme: state.theme })
          .then(() => status(`Saved theme: ${state.theme}`))
          .catch((error) => status(`Could not save theme: ${error.message}`));
      } else if (key === 'r') {
        void reload();
      } else if (key === 'n' && state.tab === 'stars' && state.starsHasMore) {
        void loadStars(true);
      } else if (key === '/' && state.tab === 'repositories') {
        state.searchMode = true;
        state.search = '';
        state.cursor = 0;
        draw();
      } else if (key === '/' && state.tab === 'stars') {
        state.searchMode = true;
        state.search = '';
        state.cursor = 0;
        draw();
      } else if (key === '\t' || key === '1' || key === '2' || key === '3') {
        const tab = key === '1'
          ? 'overview'
          : key === '2'
            ? 'repositories'
            : key === '3'
              ? 'stars'
              : state.tab === 'overview'
                ? 'repositories'
                : state.tab === 'repositories'
                  ? 'stars'
                  : 'overview';
        selectTab(tab);
      } else if (key === 'ArrowUp' || key === 'k' || key === '\u001b[A') {
        state.cursor = Math.max(0, state.cursor - 1);
        draw();
      } else if (key === 'ArrowDown' || key === 'j' || key === '\u001b[B') {
        state.cursor = Math.min(Math.max(0, filteredRepositories(activeRepositories(data, state), state.search).length - 1), state.cursor + 1);
        draw();
      } else if (key === '\u001b[5~') {
        state.cursor = Math.max(0, state.cursor - 8);
        draw();
      } else if (key === '\u001b[6~') {
        state.cursor = Math.min(Math.max(0, filteredRepositories(activeRepositories(data, state), state.search).length - 1), state.cursor + 8);
        draw();
      } else if (key === 'Home' || key === '\u001b[H') {
        state.cursor = 0;
        draw();
      } else if (key === 'End' || key === '\u001b[F') {
        state.cursor = Math.max(0, filteredRepositories(activeRepositories(data, state), state.search).length - 1);
        draw();
      } else if (key === 'o') {
        const repository = filteredRepositories(activeRepositories(data, state), state.search)[state.cursor];
        const url = state.tab === 'overview' || !repository
          ? `https://github.com/${encodeURIComponent(data.profile.login)}`
          : `https://github.com/${encodeURIComponent(data.profile.login)}/${encodeURIComponent(repository.name)}`;
        openUrl(url);
        status('Opened GitHub in your browser');
      } else if (key === '\r' || key === '\n') {
        if (state.tab === 'overview') {
          state.cursor = Math.min(state.cursor, Math.max(0, data.repositories.length - 1));
          selectTab('repositories');
        } else {
          const repository = filteredRepositories(activeRepositories(data, state), state.search)[state.cursor];
          if (repository) openUrl(`https://github.com/${encodeURIComponent(data.profile.login)}/${encodeURIComponent(repository.name)}`);
          status(repository ? 'Opened repository in your browser' : 'No repository selected');
        }
      } else if (key === '?') {
        status('Use 1/2/3 or Tab for views · / search · n more stars · t theme · r refresh · o open · q quit');
      }
    };

    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdout.on('resize', draw);
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
    stdout.write(`${HIDE_CURSOR}${CLEAR_SCREEN}`);
    draw();
  });
}
