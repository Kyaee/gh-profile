import { load } from 'cheerio';
import { fetchAvatar } from './avatar.js';

const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function imageLabel(element) {
  const source = element.attribs?.['data-canonical-src'] || element.attribs?.src || '';
  try {
    const url = new URL(source);
    if (url.hostname === 'skillicons.dev') {
      return (url.searchParams.get('i') || '').split(',').filter(Boolean).join(' · ');
    }
  } catch { /* Relative images can still have useful alt text. */ }
  return compact(element.attribs?.alt);
}

// Convert the rendered profile README, including HTML tables and icon alt text,
// into terminal blocks. No GitHub navigation or HTML controls enter the README.
export function readmeBlocks(nodes) {
  const blocks = [];
  let text = '';
  const flush = (heading = false) => {
    const value = compact(text).replace(/\s*\(Click to expand\)/gi, '');
    if (value) blocks.push({ text: value, heading });
    text = '';
  };
  const visit = (node) => {
    if (node.type === 'text') { text += node.data; return; }
    const tag = node.name;
    if (!tag || ['svg', 'script', 'style', 'tool-tip'].includes(tag)
      || (node.attribs?.class || '').split(' ').includes('anchor')) return;
    if (tag === 'img') { text += ` ${imageLabel(node)} `; return; }
    if (tag === 'br' || tag === 'hr') { flush(); return; }
    if (tag === 'details') {
      flush();
      const summary = (node.children || []).find((child) => child.name === 'summary');
      blocks.push({
        summary: summary ? readmeBlocks(summary.children).map((block) => block.text || '').join(' ') : 'Details',
        details: readmeBlocks((node.children || []).filter((child) => child !== summary)),
      });
      return;
    }
    const standaloneBold = ['b', 'strong'].includes(tag) && !compact(text)
      && node.next?.name === 'br';
    if (standaloneBold) {
      for (const child of node.children || []) visit(child);
      flush(true);
      return;
    }
    if (tag === 'table') {
      flush();
      const $ = load(node);
      const rows = $('tr').filter((_, row) => $(row).closest('table')[0] === node).toArray();
      if (rows.length === 1 && $(rows[0]).children('td,th').length === 2) {
        blocks.push({ columns: $(rows[0]).children('td,th').toArray().map((cell) => readmeBlocks(cell.children)) });
      } else {
        for (const row of rows) {
          blocks.push({ text: $(row).children('td,th').toArray().map((cell) => readmeBlocks(cell.children).map((block) => block.text || '').join(' ')).join(' | ') });
        }
      }
      return;
    }
    const heading = /^h[1-6]$/.test(tag);
    const block = heading || ['p', 'div', 'li', 'pre', 'summary', 'details', 'blockquote'].includes(tag);
    if (block) flush();
    if (tag === 'li') text += '• ';
    for (const child of node.children || []) visit(child);
    if (block) flush(heading || tag === 'summary');
  };
  for (const node of nodes) visit(node);
  flush();
  return blocks;
}

export function githubUrl(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f-\u009f]/u.test(value)) return null;
  try {
    const url = new URL(value, 'https://github.com');
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || !['github.com', 'gist.github.com'].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function parseProfilePage(html) {
  const $ = load(html);
  const article = $('article.markdown-body').first();
  const pinned = $('.js-pinned-item-list-item').toArray().flatMap((item) => {
    const node = $(item);
    const anchor = node.find('a').filter((_, link) => $(link).find('.repo').length > 0).first();
    const html_url = githubUrl(anchor.attr('href'));
    if (!html_url) return [];
    const url = new URL(html_url);
    const gist = url.hostname === 'gist.github.com';
    const name = compact(anchor.find('.repo').text());
    const full_name = gist ? name : decodeURIComponent(url.pathname.slice(1));
    const count = (icon) => Number(node.find(`.octicon-${icon}`).closest('a').text().trim().replaceAll(',', '')) || 0;
    return [{
      name, full_name, html_url, gist,
      visibility: compact(node.find('.Label').first().text()) || (gist ? 'Gist' : 'Public'),
      description: compact(node.find('.pinned-item-desc').text()) || compact(node.find('pre').text()),
      language: compact(node.find('[itemprop=programmingLanguage]').text()) || null,
      stargazers_count: count('star'), forks_count: count('repo-forked'),
    }];
  });
  const achievements = [...new Map($('img.achievement-badge-sidebar').toArray().map((image) => {
    const name = compact($(image).attr('alt')).replace(/^Achievement:\s*/i, '');
    const tier = compact($(image).parent().find('.achievement-tier-label').text());
    return [name, { name, tier }];
  })).values()].filter((badge) => badge.name);
  const section = (name) => $('h2,h3').filter((_, heading) => compact($(heading).text()) === name).first().parent();
  const organizations = section('Organizations').find('a').toArray().flatMap((anchor) => {
    const node = $(anchor);
    const href = githubUrl(node.attr('href'));
    if (!href || !node.find('img').length) return [];
    return [{ login: new URL(href).pathname.slice(1), html_url: href }];
  });
  const highlights = section('Highlights').find('.Label').map((_, element) => compact($(element).text())).get();
  const headingText = compact($('.js-pinned-items-reorder-container h2').first().text());
  return {
    available: true,
    readme: article.length ? readmeBlocks(article.contents().toArray()) : null,
    pinned, repositoryHeading: headingText.startsWith('Pinned') ? 'Pinned' : 'Popular repositories',
    achievements, organizations, highlights,
  };
}

export async function fetchProfileOverview(profile, signal) {
  const unavailable = { available: false, readme: null, pinned: [], achievements: [], organizations: [], highlights: [] };
  const page = async () => {
    try {
      const response = await fetch(`https://github.com/${encodeURIComponent(profile.login)}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'gh-profile' },
        redirect: 'error',
        signal,
      });
      if (!response.ok) return unavailable;
      return parseProfilePage(await response.text());
    } catch { return unavailable; }
  };
  const [overview, avatar] = await Promise.all([page(), fetchAvatar(profile.avatar_url, signal)]);
  return { ...overview, avatar };
}
