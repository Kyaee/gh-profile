import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const THEMES = ['github', 'light', 'dracula', 'transparent'];

function configDirectory() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'gh-profile');
  }

  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'gh-profile');
}

export function configPath() {
  return join(configDirectory(), 'config.json');
}

export async function loadConfig() {
  try {
    const parsed = JSON.parse(await readFile(configPath(), 'utf8'));
    return {
      theme: THEMES.includes(parsed.theme) ? parsed.theme : undefined,
    };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw new Error(`Could not read settings at ${configPath()}: ${error.message}`);
    }

    return {};
  }
}

export async function saveConfig(config) {
  if (!THEMES.includes(config.theme)) {
    throw new Error(`Unknown theme "${config.theme}". Choose one of: ${THEMES.join(', ')}.`);
  }

  const directory = configDirectory();
  const destination = configPath();
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify({ theme: config.theme }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, destination);
}
