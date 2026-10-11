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

- Profile overview with bio, location, company, website, public email, social
  handle, join date, and follower/repository counts.
- Overview contribution calendar with the last year's daily activity levels.
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
| Up / Down or `j` / `k` | Move through repositories |
| Enter | Go to repositories, or open the selected repository |
| Tab or `1` / `2` / `3` | Switch between Overview, Repositories, and Stars |
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

The viewer reads public profile and repository data from GitHub's REST API and
the contribution calendar from the public profile page. It does not require a
token and cannot show private repositories. GitHub's public API rate limit
applies. If GitHub does not return calendar markup, the rest of the profile
still opens normally. The only saved setting is the selected theme, stored
under the operating system's normal user config directory (`$XDG_CONFIG_HOME`
on Linux when set).

## Development

Requires Node.js 18.18 or newer. The package has no runtime dependencies.
