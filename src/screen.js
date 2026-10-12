import { getPalette } from './theme.js';
import { plainText } from './text.js';

export { plainText } from './text.js';

const CSI = '\u001b[';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function characterWidth(character) {
  const point = character.codePointAt(0);
  if (/^\p{Mark}+$/u.test(character)) return 0;
  if (/\p{Extended_Pictographic}/u.test(character) || /\p{Regional_Indicator}/u.test(character)) return 2;
  return point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a
    || (point >= 0x2e80 && point <= 0xa4cf) || (point >= 0xac00 && point <= 0xd7a3)
    || (point >= 0xf900 && point <= 0xfaff) || (point >= 0xfe10 && point <= 0xfe19)
    || (point >= 0xfe30 && point <= 0xfe6f) || (point >= 0xff00 && point <= 0xff60)
    || (point >= 0xffe0 && point <= 0xffe6)) ? 2 : 1;
}

export function textWidth(value) {
  return [...graphemes.segment(value)].reduce((sum, { segment }) => sum + characterWidth(segment), 0);
}

export function clipText(value, width) {
  const text = plainText(value);
  if (width <= 0) return '';
  if (textWidth(text) <= width) return text;
  let result = '';
  for (const { segment } of graphemes.segment(text)) {
    if (textWidth(result) + characterWidth(segment) > width - 1) break;
    result += segment;
  }
  return `${result}…`;
}

export function wrapText(value, width) {
  if (width < 1) return [];
  const words = plainText(value).split(' ').filter(Boolean);
  const rows = [];
  let current = '';
  for (const word of words) {
    if (textWidth(current ? `${current} ${word}` : word) <= width) {
      current = current ? `${current} ${word}` : word;
      continue;
    }
    if (current) rows.push(current);
    current = '';
    for (const { segment } of graphemes.segment(word)) {
      if (textWidth(current) + characterWidth(segment) > width) { rows.push(current); current = ''; }
      current += characterWidth(segment) > width ? '…' : segment;
    }
  }
  if (current) rows.push(current);
  return rows;
}

export function repositoryMatches(repositories, query = '') {
  const search = query.trim().toLowerCase();
  return (repositories || []).filter((repo) => !search || [repo.full_name, repo.name, repo.description, repo.language].some((value) => String(value || '').toLowerCase().includes(search)));
}

const number = (value) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
const LANGUAGE_COLORS = { JavaScript: [241,224,90], TypeScript: [49,120,198], Python: [53,114,165], 'Jupyter Notebook': [218,91,11], HTML: [227,76,38], CSS: [86,61,124], Dart: [0,180,171], Vue: [65,184,131], Go: [0,173,216], Rust: [222,165,132], Shell: [137,224,81], PHP: [79,93,149] };

function canvas(width, height, palette) {
  const blank = { char: ' ', fg: palette.text, bg: palette.background, bold: false };
  const rows = Array.from({ length: height }, () => Array(width).fill(blank));
  const write = (x, y, text, foreground = 'text', bold = false, background) => {
    if (y < 0 || y >= height) return;
    const fg = Array.isArray(foreground) ? foreground : palette[foreground];
    const bg = background === undefined ? palette.background : (Array.isArray(background) || background === null ? background : palette[background]);
    for (const { segment } of graphemes.segment(String(text))) {
      const size = characterWidth(segment);
      if (x >= 0 && x + size <= width && size) {
        if (x > 0 && rows[y][x].char === '') rows[y][x - 1] = blank;
        rows[y][x] = { char: segment, fg, bg, bold };
        if (size === 2) rows[y][x + 1] = { char: '', fg, bg, bold };
      }
      x += size;
    }
  };
  const box = (x, y, w, h, selected = false) => {
    if (w < 2 || h < 2) return;
    const border = selected ? 'link' : 'border';
    write(x, y, `╭${'─'.repeat(w - 2)}╮`, border);
    for (let row = 1; row < h - 1; row++) { write(x, y + row, '│', border); write(x + w - 1, y + row, '│', border); }
    write(x, y + h - 1, `╰${'─'.repeat(w - 2)}╯`, border);
  };
  return { rows, write, box };
}

function avatar(page, image, x, y, width, color, transparent) {
  const size = Math.min(24, width - 2);
  const height = Math.ceil(size / 2);
  const left = x + Math.floor((width - size) / 2);
  if (!image || !color) {
    page.box(left, y, size, height);
    page.write(left + 2, y + Math.floor(height / 2), clipText(image ? 'GitHub profile' : 'Avatar', size - 4), 'muted');
    return height;
  }
  const pixel = (column, row) => {
    const px = Math.min(image.width - 1, Math.floor((column + 0.5) / size * image.width));
    const py = Math.min(image.height - 1, Math.floor((row + 0.5) / (height * 2) * image.height));
    const offset = (py * image.width + px) * 4;
    return image.data[offset + 3] < 128 ? null : [...image.data.slice(offset, offset + 3)];
  };
  const inside = (column, row) => ((column + 0.5 - size / 2) / (size / 2)) ** 2 + ((row + 0.5 - height) / height) ** 2 <= 1;
  for (let row = 0; row < height; row++) for (let column = 0; column < size; column++) {
    const top = inside(column, row * 2) ? pixel(column, row * 2) : null;
    const bottom = inside(column, row * 2 + 1) ? pixel(column, row * 2 + 1) : null;
    if (!top && !bottom) continue;
    if (transparent) page.write(left + column, y + row, top && bottom ? '█' : top ? '▀' : '▄', top || bottom, false, null);
    else if (top) page.write(left + column, y + row, '▀', top, false, bottom || undefined);
    else page.write(left + column, y + row, '▄', bottom);
  }
  return height;
}

function sidebar(page, data, x, width, color, transparent, compact = false) {
  const profile = data.profile;
  let y = 0;
  if (!compact) y += avatar(page, data.overview?.avatar, x, y, width, color, transparent) + 1;
  page.write(x, y++, clipText(profile.name || profile.login, width), 'text', true);
  page.write(x, y++, clipText(profile.login, width), 'muted');
  y++;
  for (const row of wrapText(profile.bio || '', width)) page.write(x, y++, row);
  if (profile.bio) y++;
  page.write(x, y++, clipText(`${number(profile.followers)} followers · ${number(profile.following)} following`, width), 'muted');
  y++;
  const fields = [profile.company && `▣ ${profile.company}`, profile.location && `⌖ ${profile.location}`, profile.blog && `↗ ${profile.blog}`, profile.email && `✉ ${profile.email}`, profile.twitter_username && `@ ${profile.twitter_username}`].filter(Boolean);
  for (const field of fields) for (const row of wrapText(field, width)) page.write(x, y++, row, 'muted');
  if (compact) return y + 1;
  y++;
  page.box(x, y, width, 3);
  page.write(x + Math.max(1, Math.floor((width - 16) / 2)), y + 1, 'Open profile [o]', 'text');
  y += 4;
  const section = (title, entries, foreground = 'muted') => {
    if (!entries.length) return;
    page.write(x, y++, '─'.repeat(width), 'border');
    page.write(x, y++, title, 'text', true);
    for (const entry of entries) for (const row of wrapText(entry, width)) page.write(x, y++, row, foreground);
    y++;
  };
  section('Achievements', (data.overview?.achievements || []).map((badge) => `◇ ${badge.name}${badge.tier ? ` ${badge.tier}` : ''}`), 'link');
  section('Highlights', (data.overview?.highlights || []).map((label) => `☆ ${label}`), 'accent');
  section('Organizations', (data.overview?.organizations || []).map((org) => `▣ ${org.login}`), 'link');
  return y;
}

function readmeRows(blocks, width, expanded = true) {
  const rows = [];
  for (const block of blocks || []) {
    if (block.details) {
      rows.push([{ x: 0, text: clipText(`${expanded ? '▾' : '▸'} ${block.summary}`, width), fg: 'muted' }]);
      if (expanded) rows.push(...readmeRows(block.details, width, expanded));
      continue;
    }
    if (block.columns) {
      if (width >= 54) {
        const leftWidth = Math.floor((width - 3) / 2);
        const columns = block.columns.map((column, index) => readmeRows(column, index ? width - leftWidth - 3 : leftWidth, expanded));
        for (let row = 0; row < Math.max(...columns.map((column) => column.length)); row++) {
          rows.push([...(columns[0][row] || []), { x: leftWidth + 1, text: '│', fg: 'border' }, ...(columns[1][row] || []).map((span) => ({ ...span, x: span.x + leftWidth + 3 }))]);
        }
      } else for (const column of block.columns) rows.push(...readmeRows(column, width, expanded));
      continue;
    }
    if (block.heading && rows.length && rows.at(-1).length) rows.push([]);
    for (const text of wrapText(block.text, width)) rows.push([{ x: 0, text, fg: 'text', bold: Boolean(block.heading) }]);
    if (!block.heading) rows.push([]);
  }
  while (rows.length && !rows.at(-1).length) rows.pop();
  return rows;
}

function readmePanel(page, data, x, y, width, full = false, loading = false) {
  const rows = readmeRows(data.overview?.readme, width - 4, full);
  if (!rows.length && !loading && !full) return y;
  const visible = full ? rows : rows.slice(0, 16);
  const extra = !full && rows.length > visible.length ? 1 : 0;
  const height = Math.max(3, visible.length) + 4 + extra;
  page.box(x, y, width, height);
  page.write(x + 2, y + 1, clipText(`${data.profile.login} / README.md`, width - 4), 'muted');
  page.write(x + 1, y + 2, '─'.repeat(width - 2), 'border');
  if (!visible.length) page.write(x + 2, y + 4, clipText(loading ? 'Loading profile README…' : 'No public profile README.', width - 4), 'muted');
  visible.forEach((row, index) => row.forEach((span) => page.write(x + 2 + span.x, y + 3 + index, span.text, span.fg, span.bold)));
  if (extra) page.write(x + 2, y + height - 2, 'v  Read full README', 'link');
  return y + height + 1;
}

function repoCard(page, repository, x, y, width, selected = false, showUpdated = false) {
  const height = showUpdated ? 8 : 7;
  page.box(x, y, width, height, selected);
  const inner = width - 4;
  const badge = clipText(`[${repository.visibility || 'Public'}]`, Math.max(0, inner - 5));
  const titleWidth = Math.max(1, inner - badge.length - 1);
  const titleRows = wrapText(repository.name, Math.max(1, titleWidth - 2));
  titleRows.slice(0, 2).forEach((row, index) => {
    const prefix = index === 0 ? `${repository.gist ? '◇' : '▣'} ` : '  ';
    page.write(x + 2, y + 1 + index, clipText(`${prefix}${row}${index === 1 && titleRows.length > 2 ? '…' : ''}`, titleWidth), 'link', true);
  });
  page.write(x + width - badge.length - 2, y + 1, badge, 'muted');
  const description = wrapText(repository.description || '', inner).slice(0, 2);
  description.forEach((row, index) => page.write(x + 2, y + 3 + index, row, 'muted'));
  let offset = x + 2;
  if (repository.language) {
    page.write(offset, y + height - 2, '●', LANGUAGE_COLORS[repository.language] || 'accent');
    const language = clipText(repository.language, Math.max(1, inner - 2));
    page.write(offset + 2, y + height - 2, language, 'muted');
    offset += textWidth(language) + 4;
  }
  const counts = [repository.stargazers_count > 0 && `☆ ${number(repository.stargazers_count)}`, repository.forks_count > 0 && `⑂ ${number(repository.forks_count)}`].filter(Boolean).join('  ');
  page.write(offset, y + height - 2, clipText(counts, x + width - 2 - offset), 'muted');
  if (showUpdated && repository.pushed_at) {
    const date = new Date(repository.pushed_at);
    if (!Number.isNaN(date.getTime())) page.write(x + 2, y + 5, clipText(`Updated ${date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}${repository.fork ? ' · Fork' : ''}`, inner), 'muted');
  }
  return height;
}

function contributions(page, calendar, loading, x, y, width, palette, color) {
  const period = calendar?.period || 'in the last year';
  const title = calendar?.total == null ? `Contributions ${period}` : `${new Intl.NumberFormat('en').format(calendar.total)} contributions ${period}`;
  page.write(x, y++, clipText(title, width), 'text');
  if (!calendar?.days?.length) {
    page.box(x, y, width, 4);
    page.write(x + 2, y + 1, clipText(loading ? 'Loading contribution activity…' : 'Contribution calendar unavailable.', width - 4), 'muted');
    return y + 5;
  }
  const start = new Date(`${calendar.days[0].date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(`${calendar.days.at(-1).date}T00:00:00Z`);
  const weeks = Math.floor((end - start) / 604800000) + 1;
  const step = width >= 114 ? 2 : 1;
  const shown = Math.min(weeks, Math.max(1, Math.floor((width - 9) / step)));
  const offset = weeks - shown;
  page.box(x, y, width, 12);
  let month = -1;
  let labelEnd = -1;
  for (let week = 0; week < shown; week++) {
    const date = new Date(start.getTime() + (week + offset) * 604800000);
    if (date.getUTCMonth() !== month) {
      month = date.getUTCMonth();
      const labelStart = Math.max(week * step, labelEnd + 1);
      if (labelStart + 3 <= shown * step) {
        page.write(x + 6 + labelStart, y + 1, date.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' }), 'muted');
        labelEnd = labelStart + 3;
      }
    }
  }
  [' ', 'Mon', ' ', 'Wed', ' ', 'Fri', ' '].forEach((label, row) => page.write(x + 2, y + 2 + row, label, 'muted'));
  const greens = palette.background?.[0] > 200 ? [[235,237,240],[155,233,168],[64,196,99],[48,161,78],[33,110,57]] : [palette.border,[14,68,41],[0,109,50],[38,166,65],[57,211,83]];
  for (const day of calendar.days) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const week = Math.floor((date - start) / 604800000) - offset;
    if (week >= 0 && week < shown) page.write(x + 6 + week * step, y + 2 + date.getUTCDay(), color ? '■' : ['·','░','▒','▓','█'][day.level], greens[day.level]);
  }
  page.write(x + 2, y + 10, clipText(offset ? `Latest ${shown} weeks` : 'Each square represents a day', Math.max(0, width - 26)), 'muted');
  const legend = x + Math.max(2, width - 23);
  page.write(legend, y + 10, 'Less', 'muted');
  for (let level = 0; level < 5; level++) page.write(legend + 5 + level * 2, y + 10, color ? '■' : ['·','░','▒','▓','█'][level], greens[level]);
  page.write(legend + 15, y + 10, 'More', 'muted');
  y += 13;

  const recentDays = calendar.days.slice(-14).reverse();
  page.write(x, y++, 'Daily contributions (latest 14 days)', 'text', true);
  let row = '';
  for (const day of recentDays) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const label = `${date.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })}: ${day.count == null ? '—' : new Intl.NumberFormat('en').format(day.count)}`;
    const next = row ? `${row}  ·  ${label}` : label;
    if (textWidth(next) > width) {
      page.write(x + 2, y++, row, 'muted');
      row = label;
    } else row = next;
  }
  if (row) page.write(x + 2, y++, row, 'muted');
  return y + 1;
}

function overviewPage(data, state, width, palette, color) {
  const wide = width >= 90;
  const margin = width >= 50 ? 2 : 1;
  const sidebarWidth = wide ? Math.min(30, Math.floor(width * 0.24)) : width - margin * 2;
  const x = wide ? margin + sidebarWidth + 3 : margin;
  const mainWidth = width - x - margin;
  const readmeHeight = state.tab === 'readme' ? readmeRows(data.overview?.readme, mainWidth - 4).length : 16;
  const page = canvas(width, Math.max(600, readmeHeight + 150), palette);
  const sidebarHeight = sidebar(page, data, margin, sidebarWidth, color, state.theme === 'transparent', !wide);
  let y = wide ? 0 : sidebarHeight + 1;
  y = readmePanel(page, data, x, y, mainWidth, state.tab === 'readme', state.overviewLoading);
  if (state.tab !== 'readme') {
    const pinned = data.overview?.pinned?.length ? data.overview.pinned : [...data.repositories].sort((a,b) => b.stargazers_count - a.stargazers_count).slice(0, 6);
    page.write(x, y, data.overview?.pinned?.length ? data.overview.repositoryHeading : 'Popular repositories', 'text', true);
    y += 2;
    const columns = mainWidth >= 60 ? 2 : 1;
    const cardWidth = Math.floor((mainWidth - (columns - 1) * 2) / columns);
    for (let index = 0; index < pinned.length; index++) {
      const repo = pinned[index];
      const name = !repo.gist && repo.full_name?.split('/')[0].toLowerCase() !== data.profile.login.toLowerCase() ? repo.full_name || repo.name : repo.name;
      repoCard(page, { ...repo, name }, x + (index % columns) * (cardWidth + 2), y + Math.floor(index / columns) * 8, cardWidth);
    }
    if (!pinned.length) { page.write(x, y++, 'No public repositories.', 'muted'); }
    y += Math.ceil(pinned.length / columns) * 8 + 1;
    y = contributions(page, state.calendar, state.calendarLoading, x, y, mainWidth, palette, color);
    page.write(x, y++, clipText(`2  Browse all ${data.repositories.length} repositories · o  Open GitHub profile`, mainWidth), 'muted');
    if (data.overview?.available === false) page.write(x, y++, clipText('Profile README and pinned details unavailable from GitHub.', mainWidth), 'muted');
  }
  return page.rows.slice(0, Math.max(y + 1, wide ? sidebarHeight : 0));
}

function repositoryPage(data, state, width, height, palette) {
  const page = canvas(width, height, palette);
  const margin = width >= 50 ? 2 : 1;
  const inner = width - margin * 2;
  const all = state.tab === 'stars' ? state.starredRepositories : data.repositories;
  const repos = repositoryMatches(all, state.search);
  page.box(margin, 0, inner, 3, state.searchMode);
  page.write(margin + 2, 1, clipText(state.searchMode || state.search ? `Find a repository: ${state.search}${state.searchMode ? '▏' : ''}` : '/  Find a repository…', inner - 4), state.searchMode ? 'text' : 'muted');
  let hint = state.tab === 'stars' ? 'Recently starred' : 'Most recently updated';
  if (state.starsLoading && state.tab === 'stars') hint = 'Loading starred repositories…';
  else if (state.starsError && state.tab === 'stars') hint = state.starsError;
  else if (state.starsHasMore && state.tab === 'stars') hint += ' · n Load more';
  page.write(margin, 4, clipText(`${repos.length} ${state.search ? 'matching ' : ''}repositories · ${hint}`, inner), 'muted');
  const visible = Math.max(1, Math.floor((height - 6) / 9));
  const start = Math.max(0, Math.min(state.cursor - visible + 1, repos.length - visible));
  repos.slice(start, start + visible).forEach((repo, index) => {
    repoCard(page, { ...repo, name: state.tab === 'stars' ? repo.full_name : repo.name }, margin, 6 + index * 9, inner, start + index === state.cursor, true);
  });
  if (!repos.length) page.write(margin + 2, 7, clipText(state.starsLoading && state.tab === 'stars' ? 'Loading…' : state.search ? 'No repositories match this filter.' : 'No repositories to show.', inner - 4), 'muted');
  return page.rows;
}

function encodeRows(rows, color) {
  return rows.map((row) => {
    if (!color) return row.map((cell) => cell.char).join('');
    let previous = '';
    let output = '';
    for (const cell of row) {
      if (!cell.char) continue;
      const codes = ['0', cell.bold && '1', cell.fg && `38;2;${cell.fg.join(';')}`, cell.bg && `48;2;${cell.bg.join(';')}`].filter(Boolean).join(';');
      if (codes !== previous) { output += `${CSI}${codes}m`; previous = codes; }
      output += cell.char;
    }
    return `${output}${CSI}0m`;
  }).join('\n');
}

export function renderScreen(data, state, { width = 80, height = 24, color = true } = {}) {
  width = Math.max(1, Math.floor(width)); height = Math.max(1, Math.floor(height));
  const palette = getPalette(state.theme);
  const frame = canvas(width, height, palette);
  if (width < 24 || height < 10) {
    frame.write(0, 0, clipText('Resize terminal to 24×10', width), 'muted');
    return { text: encodeRows(frame.rows, color), scroll: 0, maxScroll: 0, bodyHeight: 0 };
  }
  frame.write(0, 0, ' '.repeat(width), 'text', false, 'panel');
  frame.write(2, 0, clipText(`◉ GitHub  /  ${data.profile.login}`, width - 4), 'text', true, 'panel');
  const theme = `${state.theme} · t`;
  if (width > 55) frame.write(width - theme.length - 2, 0, theme, 'muted', false, 'panel');
  const tabs = [['overview','Overview'],['repositories',`Repositories ${data.repositories.length}`],['stars','Stars'],...(data.overview?.readme ? [['readme','README']] : [])];
  let tabX = 2;
  if (width < 42) {
    const title = tabs.find(([tab]) => state.tab === tab)?.[1] || 'Overview';
    frame.write(2, 2, clipText(`${title} · Tab views`, width - 4), 'text', true);
    frame.write(2, 3, '━'.repeat(Math.min(textWidth(title), width - 4)), state.theme === 'dracula' ? 'accent' : [253,140,115]);
  } else for (const [tab, title] of tabs) {
    const label = width < 60 ? title.split(' ')[0].replace('Repositories', 'Repos') : title;
    frame.write(tabX, 2, label, state.tab === tab ? 'text' : 'muted', state.tab === tab);
    if (state.tab === tab) frame.write(tabX, 3, '━'.repeat(textWidth(label)), state.theme === 'dracula' ? 'accent' : [253,140,115]);
    tabX += textWidth(label) + 4;
  }
  const bodyHeight = height - 6;
  const scrollable = state.tab === 'overview' || state.tab === 'readme';
  const body = scrollable ? overviewPage(data, state, width, palette, color) : repositoryPage(data, state, width, bodyHeight, palette);
  const maxScroll = scrollable ? Math.max(0, body.length - bodyHeight) : 0;
  const scroll = Math.min(maxScroll, Math.max(0, state.scroll || 0));
  for (let y = 0; y < bodyHeight; y++) if (body[y + scroll]) frame.rows[y + 4] = body[y + scroll];
  frame.write(0, height - 2, '─'.repeat(width), 'border');
  const hint = width < 42 ? (state.searchMode ? 'Enter apply · Esc clear' : '↑↓ · Tab · t · q quit') : state.searchMode ? 'Type to filter · Enter apply · Esc clear' : scrollable ? '↑↓ scroll · Tab views · v README · t theme · o profile · q quit' : '↑↓ select · Enter open · / find · Tab views · t theme · q quit';
  frame.write(1, height - 1, clipText(state.message || hint, width - 2), state.message ? 'accent' : 'muted');
  if (scrollable && maxScroll && width >= 100 && !state.message) frame.write(width - 12, height - 1, `${scroll + 1}/${maxScroll + 1} rows`, 'muted');
  return { text: encodeRows(frame.rows, color), scroll, maxScroll, bodyHeight };
}
