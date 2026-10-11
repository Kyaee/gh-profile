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
  const days = [];
  for (const match of html.matchAll(/<(?:rect|td)\b[^>]*>/gi)) {
    const date = attribute(match[0], 'data-date');
    const level = Number(attribute(match[0], 'data-level'));
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(level) || level < 0 || level > 4) continue;
    days.push({ date, level });
  }

  if (days.length === 0) return null;
  days.sort((left, right) => left.date.localeCompare(right.date));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const totalMatch = text.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i);

  return {
    total: totalMatch ? Number(totalMatch[1].replaceAll(',', '')) : null,
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
  const to = new Date().toISOString().slice(0, 10);

  try {
    const response = await fetch(
      `${WEB_ROOT}/users/${encodeURIComponent(username)}/contributions?to=${to}`,
      {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'gh-profile',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    return parseContributionCalendar(await response.text());
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
