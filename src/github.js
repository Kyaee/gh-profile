const API_ROOT = 'https://api.github.com';
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

async function requestJson(path, username) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gh-profile-tui',
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

  try {
    return await response.json();
  } catch {
    throw new Error('GitHub returned an unreadable response. Try again later.');
  }
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
