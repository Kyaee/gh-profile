import { load } from 'cheerio';

const API_ROOT = 'https://api.github.com';
const WEB_ROOT = 'https://github.com';
const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function isValidUsername(username) {
  return USERNAME_PATTERN.test(username);
}

function githubError(response, username) {
  if (response.status === 404) {
    return new Error(`GitHub user "${username}" was not found.`);
  }

  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const resetText = Number.isFinite(reset)
      ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.`
      : '';
    return new Error(`GitHub's public API rate limit has been reached.${resetText}`);
  }

  if (response.status === 403) {
    return new Error('GitHub denied the request. Try again in a moment.');
  }

  return new Error(`GitHub returned HTTP ${response.status} ${response.statusText}.`);
}

async function request(path, username) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gh-profile',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('The GitHub request timed out. Check your connection and try again.');
    }

    throw new Error(`Could not reach GitHub: ${error.message}`);
  }

  if (!response.ok) throw githubError(response, username);
  return response;
}

async function requestJson(path, username) {
  const response = await request(path, username);
  try {
    return await response.json();
  } catch {
    throw new Error('GitHub returned an unreadable response. Try again later.');
  }
}

function attribute(element, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = element.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1];
}

export function parseContributionCalendar(html) {
  const $ = load(html);
  const counts = new Map($('tool-tip[for]').toArray().map((tip) => {
    const text = $(tip).text().trim();
    const match = text.match(/^([\d,]+) contributions?\b/i);
    return [$(tip).attr('for'), /^No contributions\b/i.test(text) ? 0 : match ? Number(match[1].replaceAll(',', '')) : null];
  }));
  const days = [];
  for (const match of html.matchAll(/<(?:rect|td)\b[^>]*>/gi)) {
    const date = attribute(match[0], 'data-date');
    const level = Number(attribute(match[0], 'data-level'));
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(level) || level < 0 || level > 4) continue;
    const rawCount = attribute(match[0], 'data-count');
    const count = rawCount !== undefined && /^\d+$/.test(rawCount) ? Number(rawCount) : counts.get(attribute(match[0], 'id')) ?? null;
    days.push({ date, level, count });
  }

  if (days.length === 0) return null;
  days.sort((left, right) => left.date.localeCompare(right.date));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const totalMatch = text.match(/([\d,]+)\s+contributions?\s+in\s+(the\s+last\s+year|\d{4})/i);

  return {
    total: totalMatch ? Number(totalMatch[1].replaceAll(',', '')) : null,
    period: totalMatch ? `in ${totalMatch[2]}` : `${days[0].date} – ${days.at(-1).date}`,
    days,
  };
}

export async function fetchContributionCalendar(username, signal) {
  if (!isValidUsername(username)) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 5000);
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const year = today.getUTCFullYear();
  const fromDate = new Date(Date.UTC(year - 1, today.getUTCMonth(), today.getUTCDate() + 1));
  const from = fromDate.toISOString().slice(0, 10);

  try {
    const calendars = await Promise.all([year - 1, year].map(async (calendarYear) => {
      try {
        const response = await fetch(
          `${WEB_ROOT}/users/${encodeURIComponent(username)}/contributions?from=${calendarYear}-01-01&to=${calendarYear}-12-31`,
          {
            headers: { Accept: 'text/html', 'User-Agent': 'gh-profile' },
            signal: controller.signal,
            redirect: 'error',
          },
        );
        if (!response.ok) return null;
        return parseContributionCalendar(await response.text());
      } catch { return null; }
    }));
    const days = [...new Map(calendars.flatMap((calendar) => calendar?.days || []).map((day) => [day.date, day])).values()]
      .filter((day) => day.date >= from && day.date <= to)
      .sort((left, right) => left.date.localeCompare(right.date));
    const expectedDays = Math.round((new Date(`${to}T00:00:00Z`) - fromDate) / 86400000) + 1;
    if (days.length !== expectedDays) return calendars[1] || calendars[0];
    return {
      days,
      total: days.every((day) => day.count !== null) ? days.reduce((sum, day) => sum + day.count, 0) : null,
      period: 'in the last year',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function fetchStarredPage(username, page = 1) {
  if (!isValidUsername(username)) {
    throw new Error('GitHub usernames must be 1–39 letters, numbers, or single hyphens.');
  }

  const response = await request(
    `/users/${encodeURIComponent(username)}/starred?per_page=100&page=${page}`,
    username,
  );
  let repositories;
  try {
    repositories = await response.json();
  } catch {
    throw new Error('GitHub returned an unreadable starred repository list.');
  }
  if (!Array.isArray(repositories)) throw new Error('GitHub returned an invalid starred repository list.');

  return {
    repositories,
    hasNextPage: /rel="?next"?/.test(response.headers.get('link') || ''),
  };
}

async function fetchRepositories(username) {
  const repositories = [];
  let page = 1;

  while (page <= 100) {
    const batch = await requestJson(
      `/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&page=${page}`,
      username,
    );
    if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid repository list.');
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
    page += 1;
  }

  throw new Error('This profile has more repositories than the viewer can load in one session.');
}

export async function fetchProfile(username) {
  if (!isValidUsername(username)) {
    throw new Error('GitHub usernames must be 1–39 letters, numbers, or single hyphens.');
  }

  const profilePath = `/users/${encodeURIComponent(username)}`;
  const [profile, repositories] = await Promise.all([
    requestJson(profilePath, username),
    fetchRepositories(username),
  ]);

  return { profile, repositories };
}
