#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig, saveConfig, THEMES } from '../src/config.js';
import { fetchProfile, isValidUsername } from '../src/github.js';
import { getPalette, paint, supportsColor } from '../src/theme.js';
import { startTui } from '../src/tui.js';
import { plainText } from '../src/text.js';

function parseArguments(args) {
  const parsed = { username: undefined, theme: undefined, noColor: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--no-color') parsed.noColor = true;
    else if (argument === '--theme') {
      const theme = args[++index];
      if (!theme || theme.startsWith('-')) throw new Error('--theme requires a theme name.');
      parsed.theme = theme;
    }
    else if (argument.startsWith('--theme=')) parsed.theme = argument.slice('--theme='.length);
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else if (!parsed.username) parsed.username = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`gh-profile — browse public GitHub profiles in your terminal

Usage:
  npx gh-profile [username] [options]

Options:
  --theme <name>  github, light, dracula, or transparent
  --no-color      Disable terminal colors
  -h, --help      Show this help

When username is omitted, gh-profile asks for one interactively.`);
}

async function ask(question, fallback = '') {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    return (await terminal.question(question)).trim() || fallback;
  } finally {
    terminal.close();
  }
}

async function chooseUsername(username) {
  let value = username;
  while (!value) {
    if (!stdin.isTTY) {
      throw new Error('Pass a GitHub username when running without an interactive terminal.');
    }
    value = await ask('GitHub username: ');
  }
  if (!isValidUsername(value)) {
    throw new Error('GitHub usernames must be 1–39 letters, numbers, or single hyphens.');
  }
  return value;
}

async function chooseTheme(theme, config) {
  if (theme) {
    if (!THEMES.includes(theme)) {
      throw new Error(`Unknown theme "${theme}". Choose one of: ${THEMES.join(', ')}.`);
    }
    await saveConfig({ theme });
    return theme;
  }
  if (config.theme) return config.theme;
  if (!stdin.isTTY) return 'github';

  const answer = await ask(`Theme (${THEMES.join('/')}) [github]: `, 'github');
  const selected = THEMES.includes(answer.toLowerCase()) ? answer.toLowerCase() : 'github';
  await saveConfig({ theme: selected });
  return selected;
}

function oneLine(value) {
  return plainText(value);
}

function compactNumber(value) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function renderProfile({ profile, repositories }, theme, noColor) {
  const palette = getPalette(theme);
  const color = supportsColor({ noColor });
  const accent = (value) => paint(plainText(value), palette.accent, color);
  const muted = (value) => paint(plainText(value), palette.muted, color);
  const link = (value) => paint(plainText(value), palette.link, color);
  const plain = (value) => paint(plainText(value), palette.text, color);
  const lines = [
    `${accent(`@${profile.login}`)}${profile.name ? `  ${plain(profile.name)}` : ''}`,
    profile.bio ? oneLine(profile.bio) : muted('No bio provided'),
    '',
    `${accent(compactNumber(profile.followers))} followers   ${accent(compactNumber(profile.following))} following   ${accent(compactNumber(profile.public_repos))} repositories`,
  ];

  if (profile.company) lines.push(muted(`Company  ${oneLine(profile.company)}`));
  if (profile.location) lines.push(muted(`Location ${oneLine(profile.location)}`));
  if (profile.blog) lines.push(link(profile.blog));
  if (profile.created_at) {
    lines.push(muted(`Joined ${new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`));
  }

  lines.push('', accent(`Repositories (${repositories.length})`));
  if (repositories.length === 0) lines.push(muted('No public repositories.'));
  for (const repository of repositories) {
    const description = oneLine(repository.description);
    const metadata = [
      repository.language,
      `★ ${compactNumber(repository.stargazers_count)}`,
      repository.fork ? 'fork' : undefined,
    ].filter(Boolean).join(' · ');
    lines.push(`${link(repository.name)}${metadata ? muted(`  ${metadata}`) : ''}`);
    if (description) lines.push(`  ${description}`);
  }
  lines.push('', muted(`github.com/${profile.login}  ·  Theme: ${theme}`));
  return lines.join('\n');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) return printHelp();

  const config = await loadConfig();
  const username = await chooseUsername(args.username);
  const theme = await chooseTheme(args.theme, config);
  if (stdout.isTTY) stdout.write(`Loading @${username} from GitHub…\n`);

  const data = await fetchProfile(username);
  if (stdin.isTTY && stdout.isTTY && typeof stdin.setRawMode === 'function') {
    await startTui(data, { theme, noColor: args.noColor });
  } else {
    console.log(renderProfile(data, theme, args.noColor));
  }
}

try {
  await main();
} catch (error) {
  console.error(`gh-profile: ${plainText(error.message)}`);
  process.exitCode = 1;
}
