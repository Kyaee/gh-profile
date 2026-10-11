# gh-profile

Browse a public GitHub profile and its repositories from your terminal. The
package name is `gh-profile-tui`; its executable is `gh-profile`.

```sh
npx gh-profile-tui torvalds
```

The original npm package name `gh-profile` is already registered, so this
project uses the available `gh-profile-tui` name. Once installed, the command
is still `gh-profile`.

## Development

Requires Node.js 18.18 or newer. This project uses the GitHub REST API and does
not need a token to view public profiles. Unauthenticated API requests follow
GitHub's public rate limit.
