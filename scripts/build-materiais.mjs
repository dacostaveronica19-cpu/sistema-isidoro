// Gera uma página estática para cada material publicado no blog Academia Isidoro,
// mais a lista /materiais/, o sitemap.xml e o robots.txt.
//
// Uso:
//   node scripts/build-materiais.mjs                 (busca os posts na API do WordPress.com)
//   FIXTURE=posts.json node scripts/build-materiais.mjs   (usa um arquivo local, para testes)
//
// O cabeçalho, o rodapé, o aviso de cookies e o GTM são copiados do index.html,
// então uma mudança ali chega às páginas dos materiais na próxima execução.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import he from 'he';
import sanitizeHtml from 'sanitize-html';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sistemaisidoro.com.br';
const API = 'https://public-api.wordpress.com/rest/v1.1/sites/academiaisidoro.wordpress.com/posts';
const CATEGORIES = { recursos: 'loja-recursos-especiais', planos: 'planos-de-aula', downloads: 'materiais-didaticos' };
const TYPES = {
  recursos: { label: 'Recurso especial', paid: true },
  planos: { label: 'Plano de aula', paid: false },
  downloads: { label: 'Material gratuito', paid: false },
};
const DEFAULT_IMAGE = 'https://academiaisidoro.wordpress.com/wp-content/uploads/2026/05/academia-isidoro-6a036c94490d0.png';
const AUTHOR = 'Verônica Silveira';

// ---------- utilidades ----------
const esc = (s) => he.escape(String(s ?? ''));
const decode = (s) => he.decode(String(s ?? ''));
const plain = (html) => decode(sanitizeHtml(String(html ?? ''), { allowedTags: [], allowedAttributes: {} })).replace(/\s+/g, ' ').trim();
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,;:.\-–—]+$/, '') + '…';
}
const httpsUrl = (value) => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function between(src, start, end, what) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`index.html: marcador inicial não encontrado (${what}).`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`index.html: marcador final não encontrado (${what}).`);
  return src.slice(a, b + end.length);
}

// ---------- posts ----------
async function loadPosts() {
  if (process.env.FIXTURE) {
    const data = JSON.parse(readFileSync(process.env.FIXTURE, 'utf8'));
    return Array.isArray(data) ? data : data.posts;
  }
  const posts = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${API}?number=100&page=${page}&status=publish&order_by=date&order=DESC`;
    const res = await fetch(url, { headers: { 'User-Agent': 'sistema-isidoro-build' } });
    if (!res.ok) throw new Error(`API do WordPress respondeu ${res.status} na página ${page}.`);
    const data = await res.json();
    const batch = Array.isArray(data.posts) ? data.posts : [];
    posts.push(...batch);
    if (batch.length < 100) break;
  }
  return posts;
}

function classify(post) {
  const slugs = Object.values(post.categories || {}).map((c) => c.slug);
  return ['recursos', 'planos', 'downloads'].find((k) => slugs.includes(CATEGORIES[k])) || null;
}
const priceTag = (post) => {
  const tag = Object.values(post.tags || {}).find((t) => /^R\$\s?\d/.test(decode(t.name)));
  return tag ? decode(tag.name) : '';
};
const priceNumber = (price) => {
  const m = price.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/);
  return m ? `${m[1].replace(/\./g, '')}.${m[2] || '00'}` : '';
};
function buyUrl(rawHtml) {
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(rawHtml))) {
    const href = httpsUrl(decode(m[1]));
    if (href && /(^|\.)hotmart\.[a-z.]+$/.test(new URL(href).hostname)) return href;
  }
  return '';
}
function labelsOf(post) {
  const section = Object.values(CATEGORIES);
  const names = [];
  Object.values(post.categories || {}).forEach((c) => { if (!section.includes(c.slug)) names.push(decode(c.name)); });
  Object.values(post.tags || {}).forEach((t) => { const n = decode(t.name); if (!/^R\$\s?\d/.test(n)) names.push(n); });
  const seen = new Set();
  return names.filter((n) => { const k = n.toLowerCase(); if (!n || ['uncategorized', 'sem categoria', 'sem-categoria'].includes(k) || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2);
}

const SANITIZE = {
  allowedTags: ['p', 'br', 'hr', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'a', 'img', 'figure', 'figcaption', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'sup', 'sub'],
  allowedAttributes: {
    '*': ['class', 'title', 'lang', 'dir'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'referrerpolicy'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: ['https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    h1: 'h2',
    // Link sem endereço http(s) vira texto simples; os demais abrem em nova aba.
    a: (tagName, attribs) => /^https?:\/\//i.test(attribs.href || '')
      ? { tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }
      : { tagName: 'span', attribs: {} },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy', referrerpolicy: 'no-referrer' } }),
  },
  // Imagem sem endereço https (relativo, http ou inexistente) é descartada.
  exclusiveFilter: (frame) => frame.tag === 'img' && !/^https:\/\//i.test(frame.attribs.src || ''),
};

// ---------- pedaços copiados do index.html ----------
const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
const consentAndGtm = between(index, '<!-- Consentimento de cookies', '<!-- End Google Tag Manager -->', 'consentimento e GTM');
const headResources = between(index, '<!-- Tailwind CSS CDN -->', '</style>', 'Tailwind, fontes e CSS');
const bodyOpen = (index.match(/<body[^>]*>/) || [])[0];
if (!bodyOpen) throw new Error('index.html: tag <body> não encontrada.');
const noscriptGtm = between(index, '<noscript><iframe src="https://www.googletagmanager.com', '</noscript>', 'noscript do GTM');
let header = between(index, '<header class="bg-white border-b', '</header>', 'cabeçalho');
header = header.replace(/href="#([^"]*)"/g, 'href="/#$1"').replace('href="./"', 'href="/"');
const footer = between(index, '<footer', '</footer>', 'rodapé').replace('href="privacidade.html"', 'href="/privacidade.html"');
const cookieBanner = between(index, '<!-- Aviso de cookies -->', '</div>\n</div>\n</div>', 'aviso de cookies').replace('href="privacidade.html"', 'href="/privacidade.html"');

const PAGE_SCRIPT = `<script>
const mobileMenu = document.getElementById('mobile-menu');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const menuIcon = document.getElementById('menu-icon');
function toggleMobileMenu() {
mobileMenu.classList.toggle('hidden');
mobileMenuBtn.setAttribute('aria-expanded', String(!mobileMenu.classList.contains('hidden')));
menuIcon.setAttribute('d', mobileMenu.classList.contains('hidden') ? 'M4 6h16M4 12h16M4 18h16' : 'M6 18L18 6M6 6l12 12');
}
mobileMenuBtn.addEventListener('click', toggleMobileMenu);
const cookieBanner = document.getElementById('cookie-banner');
function setCookieBanner(visible) {
cookieBanner.classList.toggle('hidden', !visible);
cookieBanner.hidden = !visible;
}
function saveConsent(value) {
try { localStorage.setItem('isidoro-consent', value); } catch (_) {}
gtag('consent', 'update', { analytics_storage: value === 'granted' ? 'granted' : 'denied' });
setCookieBanner(false);
}
document.getElementById('cookie-aceitar').addEventListener('click', () => saveConsent('granted'));
document.getElementById('cookie-recusar').addEventListener('click', () => saveConsent('denied'));
document.getElementById('gerenciar-cookies').addEventListener('click', () => setCookieBanner(true));
try { if (!localStorage.getItem('isidoro-consent')) setCookieBanner(true); } catch (_) { setCookieBanner(true); }
</script>`;

function pageShell({ title, description, canonical, ogType, ogImage, extraHead = '', main }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${consentAndGtm}
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%235a7c6f'/%3E%3Ctext x='32' y='45' font-family='Georgia,serif' font-size='40' font-weight='700' text-anchor='middle' fill='%23ffffff'%3EI%3C/text%3E%3C/svg%3E">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Sistema Isidoro">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary">
${extraHead}
${headResources}
</head>
${bodyOpen}
${noscriptGtm}
${header}
${main}
${footer}
${cookieBanner}
${PAGE_SCRIPT}
</body>
</html>
`;
}

// ---------- páginas ----------
function materialPage(m) {
  const { post, key, title, slug, url, description, image, labels, price, buy, modified } = m;
  const typeInfo = TYPES[key];
  const body = sanitizeHtml(String(post.content || ''), SANITIZE);
  const date = post.date ? new Date(post.date) : null;
  const dateText = date && !isNaN(date) ? date.toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Sao_Paulo' }) : '';
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: title,
    description,
    url,
    inLanguage: 'pt-BR',
    learningResourceType: typeInfo.label,
    isAccessibleForFree: !typeInfo.paid,
    author: { '@type': 'Person', name: AUTHOR },
    publisher: { '@type': 'Organization', name: 'Sistema Isidoro', url: SITE + '/' },
    image,
  };
  if (date && !isNaN(date)) schema.datePublished = date.toISOString();
  if (modified) schema.dateModified = modified;
  if (labels.length) schema.keywords = labels.join(', ');
  if (typeInfo.paid && price && buy) schema.offers = { '@type': 'Offer', price: priceNumber(price), priceCurrency: 'BRL', url: buy };

  const buyBox = typeInfo.paid && (price || buy) ? `
<div class="mb-8 rounded-xl border border-black/10 bg-white p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
<div>${price ? `<p class="text-2xl font-bold font-serif text-[#34322d]">${esc(price)}</p>` : ''}<p class="text-sm text-[#5e5e5b]">Material pago, vendido pela Hotmart.</p></div>
${buy ? `<a href="${esc(buy)}" target="_blank" rel="noopener noreferrer" class="inline-flex justify-center items-center px-6 py-3 bg-sage text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">Comprar na Hotmart<span class="sr-only"> (abre em nova aba)</span></a>` : ''}
</div>` : '';
  const featured = httpsUrl(post.featured_image) ? `<div class="mb-8"><img src="${esc(httpsUrl(post.featured_image))}" alt="" loading="lazy" class="w-full max-h-[32rem] object-cover rounded-xl"></div>` : '';
  const chips = labels.map((n) => `<span class="inline-block px-2 py-0.5 rounded-full bg-[#f1f1ef] text-xs text-[#5e5e5b]">${esc(n)}</span>`).join(' ');

  const main = `<main class="flex-grow w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
<div class="max-w-3xl mx-auto">
<nav aria-label="Navegação" class="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
<a href="/" class="inline-flex items-center gap-2 text-sage hover:underline">← Voltar ao portal</a>
<a href="/materiais/" class="text-sage hover:underline">Todos os materiais</a>
</nav>
<article>
<header class="mb-8 border-b border-black/10 pb-6">
<p class="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sage mb-3">${esc(typeInfo.label)} ${chips}</p>
<h1 class="text-4xl sm:text-5xl font-bold font-serif leading-tight text-[#34322d]">${esc(title)}</h1>
${dateText ? `<p class="mt-4 text-sm text-[#6b6a66]">${esc(dateText)}</p>` : ''}
</header>${buyBox}
${featured}
<div class="article-prose text-base leading-8 text-[#34322d]">
${body}
</div>
</article>
</div>
</main>`;
  return pageShell({
    title: `${title} | Sistema Isidoro`,
    description,
    canonical: url,
    ogType: 'article',
    ogImage: image,
    extraHead: `<script type="application/ld+json">${jsonLd(schema)}</script>`,
    main,
  });
}

function hubPage(items) {
  const groups = [['planos', 'Planos de aula'], ['downloads', 'Materiais gratuitos'], ['recursos', 'Loja de recursos']];
  const sections = groups.map(([key, heading]) => {
    const list = items.filter((i) => i.key === key);
    if (!list.length) return '';
    return `<section class="mt-12">
<h2 class="text-2xl font-bold font-serif text-[#34322d] border-b border-black/10 pb-3">${heading}</h2>
<ul class="mt-6 space-y-6">
${list.map((i) => `<li><a href="/materiais/${encodeURIComponent(i.slug)}/" class="text-xl font-bold font-serif text-sage hover:underline">${esc(i.title)}</a><p class="mt-1 text-sm text-[#5e5e5b]">${esc(i.description)}</p></li>`).join('\n')}
</ul>
</section>`;
  }).join('\n');
  const main = `<main class="flex-grow w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
<div class="max-w-3xl mx-auto">
<nav aria-label="Navegação" class="mb-8 text-sm font-medium"><a href="/" class="text-sage hover:underline">← Voltar ao portal</a></nav>
<h1 class="text-4xl sm:text-5xl font-bold font-serif leading-tight text-[#34322d]">Todos os materiais</h1>
<p class="mt-4 text-base text-[#5e5e5b]">Planos de aula, materiais gratuitos e recursos especiais do Sistema Isidoro.</p>
${sections}
</div>
</main>`;
  return pageShell({
    title: 'Todos os materiais | Sistema Isidoro',
    description: 'Lista de planos de aula, materiais gratuitos e recursos especiais de História do Sistema Isidoro.',
    canonical: SITE + '/materiais/',
    ogType: 'website',
    ogImage: DEFAULT_IMAGE,
    main,
  });
}

// ---------- execução ----------
const rawPosts = await loadPosts();
const items = [];
const usedSlugs = new Set();
for (const post of rawPosts) {
  const key = classify(post);
  if (!key) continue;
  const slug = safeDecode(String(post.slug || ''));
  if (!slug || !/^[\p{L}\p{N}_-]+$/u.test(slug) || usedSlugs.has(slug)) { console.warn(`Ignorado (slug inválido ou repetido): ${post.slug}`); continue; }
  usedSlugs.add(slug);
  const title = decode(post.title || 'Sem título');
  const description = truncate(plain(post.excerpt) || plain(post.content), 155) || title;
  const modified = post.modified ? new Date(post.modified) : null;
  items.push({
    post, key, slug, title, description,
    url: `${SITE}/materiais/${encodeURIComponent(slug)}/`,
    image: httpsUrl(post.featured_image) || DEFAULT_IMAGE,
    labels: labelsOf(post),
    price: TYPES[key].paid ? priceTag(post) : '',
    buy: TYPES[key].paid ? buyUrl(String(post.content || '')) : '',
    modified: modified && !isNaN(modified) ? modified.toISOString() : '',
  });
}
if (items.length === 0) {
  console.error('Nenhum material encontrado nas categorias do portal. Nada foi alterado (para evitar apagar o site por uma falha da API).');
  process.exit(1);
}

const outDir = join(ROOT, 'materiais');
rmSync(outDir, { recursive: true, force: true });
for (const m of items) {
  const dir = join(outDir, m.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), materialPage(m));
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), hubPage(items));

const urls = [
  `<url><loc>${SITE}/</loc></url>`,
  `<url><loc>${SITE}/materiais/</loc></url>`,
  `<url><loc>${SITE}/privacidade.html</loc></url>`,
  ...items.map((m) => `<url><loc>${esc(m.url)}</loc>${m.modified ? `<lastmod>${m.modified.slice(0, 10)}</lastmod>` : ''}</url>`),
];
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`${items.length} materiais gerados (${items.filter((i) => i.key === 'planos').length} planos, ${items.filter((i) => i.key === 'downloads').length} gratuitos, ${items.filter((i) => i.key === 'recursos').length} da loja).`);
