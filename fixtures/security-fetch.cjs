// Offline adversarial data for the security regression suite. Not published.
const controls = '\u001b]52;c;SGFybWxlc3M=\u0007\u001b[2J\u001b]8;;https://example.invalid\u001b\\';
const tainted = (text) => `${text}${controls}`;
globalThis.fetch = async (value, options) => {
  const url = new URL(value);
  if (url.origin !== 'https://api.github.com' || options.redirect !== 'error') {
    throw new Error('Unexpected outbound request in offline security fixture.');
  }
  if (url.pathname === '/users/safe') {
    return new Response(JSON.stringify({
      login: 'safe', name: tainted('Safe name'), bio: tainted('Safe bio'),
      company: tainted('Safe company'), location: tainted('Safe location'),
      blog: tainted('https://example.invalid'), followers: 1, following: 2,
      public_repos: 1, created_at: '2020-01-01T00:00:00Z',
    }));
  }
  if (url.pathname === '/users/safe/repos') {
    return new Response(JSON.stringify([{
      name: tainted('Safe repo'), description: tainted('Safe description'),
      language: tainted('JavaScript'), stargazers_count: 3,
    }]));
  }
  throw new Error('Unexpected API route in offline security fixture.');
};
