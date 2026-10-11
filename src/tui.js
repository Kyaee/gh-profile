import { spawn } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { fetchContributionCalendar, fetchProfile, fetchStarredPage } from './github.js';
import { fetchProfileOverview, githubUrl } from './profile-page.js';
import { saveConfig } from './config.js';
import { nextTheme, supportsColor } from './theme.js';
import { renderScreen, repositoryMatches as filteredRepositories } from './screen.js';

const CSI = '\u001b[';
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const CLEAR_SCREEN = `${CSI}2J${CSI}H`;

function activeRepositories(data, state) {
  return state.tab === 'stars' ? state.starredRepositories : data.repositories;
}

function openUrl(url) {
  url = githubUrl(url);
  if (!url) return;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
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
      scroll: 0,
      maxScroll: 0,
      bodyHeight: 0,
      overviewLoading: true,
      search: '',
      searchMode: false,
      starredRepositories: [],
      calendar: null,
      calendarLoading: true,
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
    let contributionController;
    let overviewController;
    let settingsQueue = Promise.resolve();

    const draw = () => {
      if (closed) return;
      const frame = renderScreen(data, state, {
        width: stdout.columns || 80,
        height: stdout.rows || 24,
        color: supportsColor(colorOptions),
      });
      state.scroll = frame.scroll;
      state.maxScroll = frame.maxScroll;
      state.bodyHeight = frame.bodyHeight;
      stdout.write(`${CSI}H${frame.text}`);
    };

    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(messageTimer);
      stdin.off('keypress', onKeypress);
      stdout.off('resize', draw);
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      contributionController?.abort();
      overviewController?.abort();
      stdin.setRawMode(false);
      stdout.write(`${SHOW_CURSOR}${CSI}0m${CSI}?7h${CSI}?1049l`);
      stdin.pause();
      resolve();
    };

    const status = (message) => {
      if (closed) return;
      state.message = message;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => {
        state.message = '';
        draw();
      }, 2400);
      draw();
    };

    const refreshContributions = () => {
      contributionController?.abort();
      contributionController = new AbortController();
      state.calendar = null;
      state.calendarLoading = true;
      const controller = contributionController;
      void fetchContributionCalendar(data.profile.login, controller.signal).then((calendar) => {
        if (closed || contributionController !== controller) return;
        state.calendar = calendar;
        state.calendarLoading = false;
        draw();
      });
    };

    const refreshOverview = () => {
      overviewController?.abort();
      const controller = new AbortController();
      overviewController = controller;
      state.overviewLoading = true;
      const timer = setTimeout(() => controller.abort(), 10000);
      void fetchProfileOverview(data.profile, controller.signal).then((overview) => {
        if (closed || overviewController !== controller) return;
        data.overview = overview;
        state.overviewLoading = false;
        draw();
      }).finally(() => clearTimeout(timer));
    };

    const reload = async () => {
      if (state.busy) return;
      state.busy = true;
      state.message = 'Refreshing profile…';
      draw();
      try {
        const updated = await fetchProfile(data.profile.login);
        if (closed) return;
        data = { ...updated, overview: data.overview };
        state.cursor = Math.min(state.cursor, Math.max(0, filteredRepositories(activeRepositories(data, state), state.search).length - 1));
        state.message = 'Profile refreshed';
        refreshContributions();
        refreshOverview();
      } catch (error) {
        state.message = error.message;
      } finally {
        state.busy = false;
        if (closed) return;
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
        if (closed) return;
        state.starredRepositories.push(...result.repositories);
        state.starsPage = page;
        state.starsHasMore = result.hasNextPage;
        state.starsLoaded = true;
      } catch (error) {
        state.starsError = error.message;
      } finally {
        state.starsLoading = false;
        if (closed) return;
        state.message = '';
        draw();
      }
    };

    const selectTab = (tab) => {
      state.tab = tab;
      state.cursor = 0;
      state.offset = 0;
      state.scroll = 0;
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
        } else if (key && !/[\u0000-\u001f\u007f-\u009f]/u.test(key)) {
          state.search += key;
          state.cursor = 0;
        }
        draw();
        return;
      }

      if (key === 't') {
        state.theme = nextTheme(state.theme);
        const theme = state.theme;
        draw();
        settingsQueue = settingsQueue.catch(() => {}).then(() => saveConfig({ theme }))
          .then(() => status(`Saved theme: ${theme}`))
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
      } else if (key === 'v' || key === '4') {
        if (data.overview?.readme) selectTab('readme');
        else status(state.overviewLoading ? 'Profile README is loading…' : 'No public profile README found.');
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
                  : state.tab === 'stars' && data.overview?.readme
                    ? 'readme'
                    : 'overview';
        selectTab(tab);
      } else if (key === 'ArrowUp' || key === 'k' || key === '\u001b[A') {
        if (state.tab === 'overview' || state.tab === 'readme') state.scroll = Math.max(0, state.scroll - 1);
        else state.cursor = Math.max(0, state.cursor - 1);
        draw();
      } else if (key === 'ArrowDown' || key === 'j' || key === '\u001b[B') {
        if (state.tab === 'overview' || state.tab === 'readme') state.scroll = Math.min(state.maxScroll, state.scroll + 1);
        else state.cursor = Math.min(Math.max(0, filteredRepositories(activeRepositories(data, state), state.search).length - 1), state.cursor + 1);
        draw();
      } else if (key === '\u001b[5~') {
        if (state.tab === 'overview' || state.tab === 'readme') state.scroll = Math.max(0, state.scroll - state.bodyHeight + 2);
        else state.cursor = Math.max(0, state.cursor - 8);
        draw();
      } else if (key === '\u001b[6~') {
        if (state.tab === 'overview' || state.tab === 'readme') state.scroll = Math.min(state.maxScroll, state.scroll + state.bodyHeight - 2);
        else state.cursor = Math.min(Math.max(0, filteredRepositories(activeRepositories(data, state), state.search).length - 1), state.cursor + 8);
        draw();
      } else if (key === 'Home' || key === '\u001b[H') {
        state.cursor = 0;
        state.scroll = 0;
        draw();
      } else if (key === 'End' || key === '\u001b[F') {
        state.cursor = Math.max(0, filteredRepositories(activeRepositories(data, state), state.search).length - 1);
        state.scroll = state.maxScroll;
        draw();
      } else if (key === 'o') {
        const repository = filteredRepositories(activeRepositories(data, state), state.search)[state.cursor];
        const url = state.tab === 'overview' || state.tab === 'readme' || !repository
          ? `https://github.com/${encodeURIComponent(data.profile.login)}`
          : repository.html_url;
        openUrl(url);
        status('Opened GitHub in your browser');
      } else if (key === '\r' || key === '\n') {
        if (state.tab === 'overview') {
          state.cursor = Math.min(state.cursor, Math.max(0, data.repositories.length - 1));
          selectTab('repositories');
        } else if (state.tab === 'readme') {
          openUrl(`https://github.com/${encodeURIComponent(data.profile.login)}/${encodeURIComponent(data.profile.login)}#readme`);
        } else {
          const repository = filteredRepositories(activeRepositories(data, state), state.search)[state.cursor];
          if (repository) openUrl(repository.html_url);
          status(repository ? 'Opened repository in your browser' : 'No repository selected');
        }
      } else if (key === '?') {
        status('1/2/3 views · v README · ↑↓ scroll/select · / search · n more stars · t theme · r refresh · q quit');
      }
    };

    const navigationKeys = {
      up: '\u001b[A', down: '\u001b[B', pageup: '\u001b[5~', pagedown: '\u001b[6~',
      home: 'Home', end: 'End', backspace: '\u007f', escape: '\u001b',
      return: '\r', enter: '\n', tab: '\t',
    };
    const onKeypress = (text, key) => onData(Buffer.from(navigationKeys[key?.name] || key?.sequence || text || ''));
    stdin.setEncoding('utf8');
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', onKeypress);
    stdout.on('resize', draw);
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
    stdout.write(`${CSI}?1049h${CSI}?7l${HIDE_CURSOR}${CLEAR_SCREEN}`);
    draw();
    refreshContributions();
    refreshOverview();
  });
}
