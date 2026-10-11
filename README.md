# gh-profile (currently publishing)

Browse a public GitHub profile and its repositories from a terminal UI. The npm
package is `gh-profile`.

```sh
npx gh-profile torvalds
npx gh-profile
```

With no username, the command asks for one.

### Install from a local checkout

To install the command into this project without changing your global npm
installation, run:

```sh
npm run install:local
./.local/node_modules/.bin/gh-profile torvalds
```

The local install is stored in the ignored `.local/` directory. Replace
`torvalds` with any public GitHub username.

## In the terminal

- GitHub-style overview with a circular avatar, profile sidebar, README panel,
  pinned repository cards, achievements, highlights, and public organizations.
- Profile README with headings, text, image labels, and two-column tables.
  The README tab expands details and shows the full text.
- Contribution calendar with the last year's daily activity levels and total.
  If only a calendar year is available, its heading names that year.
- Narrow terminals stack the sidebar and repository cards. Scroll the overview
  to reach content below the viewport.
- Browse every public repository, including description, language, stars,
  forks, and last update time.
- Browse starred repositories in pages of 100, matching GitHub's Stars view.
- Search repositories by name, description, or language.
- Open the profile or selected repository in your browser.
- Switch between GitHub dark, light, Dracula, and transparent themes. The
  selected theme is saved for the next run. Transparent leaves the terminal's
  own background visible.

| Key | Action |
| --- | --- |
| Up / Down or `j` / `k` | Scroll Overview/README, or select a repository |
| Page Up / Page Down | Scroll a page, or move eight repositories |
| Home / End | Jump to the first or last row/repository |
| Enter | Go to repositories, or open the selected repository/README |
| Tab | Cycle through Overview, Repositories, Stars, and README |
| `1` / `2` / `3` | Open Overview, Repositories, or Stars |
| `v` or `4` | Read the full profile README |
| `/` | Search repositories |
| `n` | Load the next page in Stars |
| `t` | Cycle and save the theme |
| `r` | Refresh profile data |
| `o` | Open the profile or current repository |
| `q` | Quit |

Options:

```sh
npx gh-profile --help
npx gh-profile torvalds --theme transparent
npx gh-profile torvalds --no-color
```

## Data and privacy

The viewer reads public profile and repository data from GitHub's REST API,
README and pinned details from the public profile page, avatars from GitHub's
avatar service, and daily activity from GitHub's contribution calendars.
It does not require a
token and cannot show private repositories. GitHub's public API rate limit
applies. README images are represented by text labels; PNG/JPEG avatars are
rendered with terminal block characters. The viewer only shows information
available when logged out of GitHub. If additional profile markup or an avatar
is unavailable, the profile and repository views still open. Profiles without
pinned items show popular repositories ordered by stars.

The only saved setting is the selected theme, stored
under the operating system's normal user config directory (`$XDG_CONFIG_HOME`
on Linux when set).

## Development

Requires Node.js 18.18 or newer. Run `npm install` in the checkout to install
Cheerio for public profile markup and pngjs/jpeg-js for terminal avatars.

## Security checks

Run `npm test` for the offline security regression suite. It checks terminal
control stripping, URL validation, redirect rejection, avatar decoding limits,
and the CLI fallback with hostile API data. Run `npm audit --omit=dev` to check
the installed dependency versions for known advisories.

Profile text is displayed as text, including when output is piped. Outbound
requests use HTTPS GitHub endpoints and reject redirects. Browser actions
accept only HTTPS GitHub/gist URLs and launch without a shell. Credentials,
environment files, and local caches are ignored by Git; the npm package includes
only its source, package manifest, license, and README.
