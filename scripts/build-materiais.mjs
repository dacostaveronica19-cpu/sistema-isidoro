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
const FILTROS = JSON.parse(readFileSync(join(ROOT, 'config', 'filtros.json'), 'utf8'));
const RESERVED_SLUGS = new Set(FILTROS.grupos.map((g) => g.id));
const TIPO_GRUPO = { id: 'tipo', titulo: 'Tipo de material' };

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

// Compara sem acento, sem maiúsculas e só com palavras inteiras ("eja" não casa com "bandeja").
const norm = (s) => decode(String(s ?? '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, term) => new RegExp(`(^|[^a-z0-9])${reEsc(term)}([^a-z0-9]|$)`).test(text);

function between(src, start, end, what) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`index.html: marcador inicial não encontrado (${what}).`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`index.html: marcador final não encontrado (${what}).`);
  return src.slice(a, b + end.length);
}

// ---------- posts ----------
// Mapa slug -> slug da categoria-mãe, para que um post marcado só numa subcategoria
// (por exemplo, "Anos Iniciais" dentro de "Materiais Didáticos") entre na seção certa.
const PARENT_OF = new Map();
function registerCategories(list) {
  const byId = new Map(list.map((c) => [c.ID, c]));
  for (const c of list) {
    const parent = c.parent ? byId.get(c.parent) : null;
    if (parent && parent.slug) PARENT_OF.set(c.slug, parent.slug);
  }
}
async function loadCategories() {
  const url = API.replace(/\/posts$/, '/categories') + '?number=1000';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sistema-isidoro-build' } });
    if (!res.ok) throw new Error(`API respondeu ${res.status}`);
    const data = await res.json();
    registerCategories(Array.isArray(data.categories) ? data.categories : []);
  } catch (err) {
    console.warn(`Não foi possível ler a hierarquia de categorias (${err.message}). Posts marcados só numa subcategoria podem ficar de fora.`);
  }
}
function ancestorsOf(slug) {
  const chain = [slug];
  while (PARENT_OF.has(chain[chain.length - 1]) && chain.length < 10) chain.push(PARENT_OF.get(chain[chain.length - 1]));
  return chain;
}

async function loadPosts() {
  if (process.env.FIXTURE) {
    const data = JSON.parse(readFileSync(process.env.FIXTURE, 'utf8'));
    if (!Array.isArray(data) && Array.isArray(data.categorias)) registerCategories(data.categorias);
    return Array.isArray(data) ? data : data.posts;
  }
  await loadCategories();
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
  const slugs = Object.values(post.categories || {}).flatMap((c) => ancestorsOf(c.slug));
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
function labelsOf(post, limit = 2) {
  const section = Object.values(CATEGORIES);
  const names = [];
  Object.values(post.categories || {}).forEach((c) => { if (!section.includes(c.slug)) names.push(decode(c.name)); });
  Object.values(post.tags || {}).forEach((t) => { const n = decode(t.name); if (!/^R\$\s?\d/.test(n)) names.push(n); });
  const seen = new Set();
  return names.filter((n) => { const k = n.toLowerCase(); if (!n || ['uncategorized', 'sem categoria', 'sem-categoria'].includes(k) || seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
}

function classifyFacets(item) {
  const hay = item.allLabels.map(norm);
  const title = norm(item.title);
  const facets = {};
  for (const g of FILTROS.grupos) {
    facets[g.id] = g.valores
      .filter((v) => v.aliases.some((a) => { const t = norm(a); return hay.some((h) => hasWord(h, t)) || hasWord(title, t); }))
      .map((v) => v.slug);
  }
  return facets;
}
const grupoPorId = (id) => FILTROS.grupos.find((g) => g.id === id);
const valorPorSlug = (grupoId, slug) => grupoPorId(grupoId).valores.find((v) => v.slug === slug);

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
  const facetLinks = FILTROS.grupos.flatMap((g) => (m.facets[g.id] || []).map((v) => `<a href="/materiais/${g.id}/${v}/" class="inline-block px-2 py-0.5 rounded-full bg-[#f1f1ef] text-xs text-[#5e5e5b] hover:bg-sage hover:text-white normal-case tracking-normal">${esc(valorPorSlug(g.id, v).nome)}</a>`));
  const chips = (facetLinks.length ? facetLinks : labels.map((n) => `<span class="inline-block px-2 py-0.5 rounded-full bg-[#f1f1ef] text-xs text-[#5e5e5b] normal-case tracking-normal">${esc(n)}</span>`)).join(' ');

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

const TIPO_ORDEM = ['planos', 'downloads', 'recursos'];
const chipBase = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors';

function itemCard(i, { showChips = true } = {}) {
  const tags = [TYPES[i.key].label, ...FILTROS.grupos.flatMap((g) => (i.facets[g.id] || []).map((v) => valorPorSlug(g.id, v).nome))];
  return `<li class="rounded-xl bg-white border border-black/5 p-5" data-tipo="${i.key}"${FILTROS.grupos.map((g) => ` data-${g.id}="${(i.facets[g.id] || []).join(' ')}"`).join('')}>
${showChips ? `<p class="text-xs text-[#6b6a66]">${tags.map(esc).join(' · ')}</p>` : ''}
<a href="/materiais/${encodeURIComponent(i.slug)}/" class="mt-1 block text-xl font-bold font-serif text-sage hover:underline">${esc(i.title)}</a>
<p class="mt-1 text-sm text-[#5e5e5b]">${esc(i.description)}</p>
</li>`;
}

// Totais por valor, usados nos filtros e na página inicial.
function facetas(items) {
  const grupos = FILTROS.grupos.map((g) => ({
    id: g.id, titulo: g.titulo,
    valores: g.valores.map((v) => ({ slug: v.slug, nome: v.nome, total: items.filter((i) => (i.facets[g.id] || []).includes(v.slug)).length })).filter((v) => v.total > 0),
  }));
  grupos.push({ id: TIPO_GRUPO.id, titulo: TIPO_GRUPO.titulo, valores: TIPO_ORDEM.map((k) => ({ slug: k, nome: TYPES[k].label, total: items.filter((i) => i.key === k).length })).filter((v) => v.total > 0) });
  return grupos.filter((g) => g.valores.length);
}

const HUB_SCRIPT = `<script>
(function () {
  var items = Array.prototype.slice.call(document.querySelectorAll('#lista-materiais > li'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-chip]'));
  var contagem = document.getElementById('contagem');
  var vazio = document.getElementById('sem-resultado');
  var limpar = document.getElementById('limpar-filtros');
  var grupos = {};
  chips.forEach(function (c) { grupos[c.dataset.grupo] = grupos[c.dataset.grupo] || []; });
  var sel = {};
  Object.keys(grupos).forEach(function (g) { sel[g] = []; });
  var params = new URLSearchParams(location.search);
  Object.keys(sel).forEach(function (g) { (params.get(g) || '').split(',').forEach(function (v) { if (v && chips.some(function (c) { return c.dataset.grupo === g && c.dataset.valor === v; })) sel[g].push(v); }); });
  function visivel(li) {
    return Object.keys(sel).every(function (g) {
      if (!sel[g].length) return true;
      var vals = (li.getAttribute('data-' + g) || '').split(' ');
      return sel[g].some(function (v) { return vals.indexOf(v) !== -1; });
    });
  }
  function render() {
    var n = 0;
    items.forEach(function (li) { var ok = visivel(li); li.hidden = !ok; li.classList.toggle('hidden', !ok); if (ok) n++; });
    chips.forEach(function (c) {
      var on = sel[c.dataset.grupo].indexOf(c.dataset.valor) !== -1;
      c.setAttribute('aria-pressed', String(on));
      c.classList.toggle('bg-sage', on); c.classList.toggle('text-white', on); c.classList.toggle('border-sage', on);
      c.classList.toggle('bg-white', !on); c.classList.toggle('text-[#34322d]', !on); c.classList.toggle('border-black/15', !on);
    });
    contagem.textContent = n + (n === 1 ? ' material' : ' materiais');
    vazio.hidden = n !== 0; vazio.classList.toggle('hidden', n !== 0);
    var temFiltro = Object.keys(sel).some(function (g) { return sel[g].length; });
    limpar.hidden = !temFiltro; limpar.classList.toggle('hidden', !temFiltro);
    var q = new URLSearchParams();
    Object.keys(sel).forEach(function (g) { if (sel[g].length) q.set(g, sel[g].join(',')); });
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : ''));
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      var list = sel[c.dataset.grupo], i = list.indexOf(c.dataset.valor);
      if (i === -1) list.push(c.dataset.valor); else list.splice(i, 1);
      render();
    });
  });
  limpar.addEventListener('click', function () { Object.keys(sel).forEach(function (g) { sel[g] = []; }); render(); });
  render();
})();
</script>`;

function hubPage(items) {
  const grupos = facetas(items);
  const painel = grupos.map((g) => `<fieldset class="mt-5">
<legend class="text-xs font-semibold uppercase tracking-wider text-[#6b6a66]">${esc(g.titulo)}</legend>
<div class="mt-2 flex flex-wrap gap-2">
${g.valores.map((v) => `<button type="button" data-chip data-grupo="${g.id}" data-valor="${esc(v.slug)}" aria-pressed="false" class="${chipBase} bg-white text-[#34322d] border-black/15 hover:border-sage">${esc(v.nome)} <span class="text-xs opacity-70">${v.total}</span></button>`).join('\n')}
</div>
</fieldset>`).join('\n');
  const main = `<main class="flex-grow w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
<div class="max-w-3xl mx-auto">
<nav aria-label="Navegação" class="mb-8 text-sm font-medium"><a href="/" class="text-sage hover:underline">← Voltar ao portal</a></nav>
<h1 class="text-4xl sm:text-5xl font-bold font-serif leading-tight text-[#34322d]">Todos os materiais</h1>
<p class="mt-4 text-base text-[#5e5e5b]">Planos de aula, materiais gratuitos e recursos especiais do Sistema Isidoro. Os filtros combinam entre grupos: por exemplo, EJA e História Antiga mostra o que atende às duas escolhas.</p>
<div class="mt-6 rounded-xl border border-black/10 bg-white p-5">
<h2 class="text-lg font-bold font-serif text-[#34322d]">Filtrar</h2>
${painel}
<div class="mt-5 flex items-center justify-between gap-4">
<p id="contagem" class="text-sm font-medium text-[#34322d]" aria-live="polite">${items.length} materiais</p>
<button type="button" id="limpar-filtros" class="text-sm text-sage underline hidden" hidden>Limpar filtros</button>
</div>
</div>
<ul id="lista-materiais" class="mt-8 space-y-4">
${items.map((i) => itemCard(i)).join('\n')}
</ul>
<p id="sem-resultado" class="mt-8 text-center text-[#5e5e5b] hidden" hidden>Nenhum material combina com essas escolhas. Tente retirar um filtro.</p>
</div>
</main>`;
  return pageShell({
    title: 'Todos os materiais | Sistema Isidoro',
    description: 'Planos de aula, materiais gratuitos e recursos especiais de História do Sistema Isidoro, com filtros por etapa, área e tipo.',
    canonical: SITE + '/materiais/',
    ogType: 'website',
    ogImage: DEFAULT_IMAGE,
    main,
  }).replace('</body>', HUB_SCRIPT + '\n</body>');
}

function landingPage(grupo, valor, items, grupos) {
  const lista = items.filter((i) => (i.facets[grupo.id] || []).includes(valor.slug));
  const prefixo = grupo.id === 'etapa' ? 'Materiais para' : 'Materiais de';
  const titulo = `${prefixo} ${valor.nome}`;
  const outros = grupo.valores.filter((v) => v.slug !== valor.slug && items.some((i) => (i.facets[grupo.id] || []).includes(v.slug)));
  const main = `<main class="flex-grow w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
<div class="max-w-3xl mx-auto">
<nav aria-label="Navegação" class="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium"><a href="/" class="text-sage hover:underline">← Voltar ao portal</a><a href="/materiais/" class="text-sage hover:underline">Todos os materiais, com filtros</a></nav>
<h1 class="text-4xl sm:text-5xl font-bold font-serif leading-tight text-[#34322d]">${esc(titulo)}</h1>
<p class="mt-4 text-base text-[#5e5e5b]">${lista.length} ${lista.length === 1 ? 'material' : 'materiais'} do Sistema Isidoro: planos de aula, atividades e recursos de ${esc(valor.nome)}.</p>
<ul class="mt-8 space-y-4">
${lista.map((i) => itemCard(i)).join('\n')}
</ul>
${outros.length ? `<section class="mt-12 border-t border-black/10 pt-6"><h2 class="text-lg font-bold font-serif text-[#34322d]">${esc(grupo.titulo)}: outras opções</h2><p class="mt-3 flex flex-wrap gap-2">${outros.map((v) => `<a href="/materiais/${grupo.id}/${v.slug}/" class="${chipBase} bg-white text-[#34322d] border-black/15 hover:border-sage">${esc(v.nome)}</a>`).join(' ')}</p></section>` : ''}
</div>
</main>`;
  return {
    html: pageShell({
      title: `${titulo} | Sistema Isidoro`,
      description: truncate(`${lista.length} ${lista.length === 1 ? 'material didático' : 'materiais didáticos'} de ${valor.nome} no Sistema Isidoro: planos de aula, atividades e recursos para a sala de aula.`, 155),
      canonical: `${SITE}/materiais/${grupo.id}/${valor.slug}/`,
      ogType: 'website',
      ogImage: DEFAULT_IMAGE,
      main,
    }),
    titulo,
  };
}

// ---------- execução ----------
const rawPosts = await loadPosts();
const items = [];
const usedSlugs = new Set();
for (const post of rawPosts) {
  const key = classify(post);
  if (!key) continue;
  const slug = safeDecode(String(post.slug || ''));
  if (!slug || !/^[\p{L}\p{N}_-]+$/u.test(slug) || usedSlugs.has(slug) || RESERVED_SLUGS.has(slug)) { console.warn(`Ignorado (slug inválido, repetido ou reservado): ${post.slug}`); continue; }
  usedSlugs.add(slug);
  const title = decode(post.title || 'Sem título');
  const description = truncate(plain(post.excerpt) || plain(post.content), 155) || title;
  const modified = post.modified ? new Date(post.modified) : null;
  const item = {
    post, key, slug, title, description,
    url: `${SITE}/materiais/${encodeURIComponent(slug)}/`,
    image: httpsUrl(post.featured_image) || DEFAULT_IMAGE,
    labels: labelsOf(post),
    allLabels: labelsOf(post, 100),
    price: TYPES[key].paid ? priceTag(post) : '',
    buy: TYPES[key].paid ? buyUrl(String(post.content || '')) : '',
    modified: modified && !isNaN(modified) ? modified.toISOString() : '',
    date: post.date ? new Date(post.date).toISOString() : '',
  };
  item.facets = classifyFacets(item);
  items.push(item);
}
if (items.length === 0) {
  console.error('Nenhum material encontrado nas categorias do portal. Nada foi alterado (para evitar apagar o site por uma falha da API).');
  process.exit(1);
}
items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
const grupos = facetas(items);

const outDir = join(ROOT, 'materiais');
rmSync(outDir, { recursive: true, force: true });
for (const m of items) {
  const dir = join(outDir, m.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), materialPage(m));
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), hubPage(items));

const landings = [];
for (const g of FILTROS.grupos) {
  for (const v of g.valores) {
    if (!items.some((i) => (i.facets[g.id] || []).includes(v.slug))) continue;
    const { html } = landingPage(g, v, items, grupos);
    mkdirSync(join(outDir, g.id, v.slug), { recursive: true });
    writeFileSync(join(outDir, g.id, v.slug, 'index.html'), html);
    landings.push(`${SITE}/materiais/${g.id}/${v.slug}/`);
  }
}

// Dados para a página inicial e para qualquer filtro no navegador.
writeFileSync(join(ROOT, 'materiais.json'), JSON.stringify({
  grupos,
  materiais: items.map((i) => ({ slug: i.slug, titulo: i.title, descricao: i.description, tipo: i.key, imagem: i.image, preco: i.price || undefined, etapa: i.facets.etapa, area: i.facets.area, rotulos: i.allLabels, data: i.date })),
}, null, 1) + '\n');

// Relatório para a autora: o que ficou sem classificação e como cada rótulo do blog foi lido.
const usoRotulos = new Map();
for (const i of items) for (const l of i.allLabels) usoRotulos.set(l, (usoRotulos.get(l) || 0) + 1);
const rotuloClassificado = (l) => FILTROS.grupos.some((g) => g.valores.some((v) => v.aliases.some((a) => hasWord(norm(l), norm(a)))));
const sem = (id) => items.filter((i) => !(i.facets[id] || []).length).map((i) => `- ${i.title} (${TYPES[i.key].label.toLowerCase()})`).join('\n') || '- (nenhum)';
mkdirSync(join(ROOT, '.github'), { recursive: true });
writeFileSync(join(ROOT, '.github', 'relatorio-filtros.md'), `# Relatório dos filtros

Gerado pela rotina de atualização. Mostra como os materiais do blog foram classificados em \`config/filtros.json\`.

## Materiais por filtro
${grupos.map((g) => `**${g.titulo}**: ${g.valores.map((v) => `${v.nome} (${v.total})`).join(', ')}`).join('\n\n')}

## Sem etapa ou modalidade (${items.filter((i) => !i.facets.etapa.length).length})
${sem('etapa')}

## Sem área ou período (${items.filter((i) => !i.facets.area.length).length})
${sem('area')}

## Rótulos do blog que ainda não viraram filtro
Rótulos (categorias e tags) usados nos posts do portal que não correspondem a nenhum valor de \`config/filtros.json\`.

${[...usoRotulos].filter(([l]) => !rotuloClassificado(l)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `- ${l} (${n})`).join('\n') || '- (nenhum)'}
`);

const urls = [
  `<url><loc>${SITE}/</loc></url>`,
  `<url><loc>${SITE}/materiais/</loc></url>`,
  ...landings.map((u) => `<url><loc>${esc(u)}</loc></url>`),
  `<url><loc>${SITE}/privacidade.html</loc></url>`,
  ...items.map((m) => `<url><loc>${esc(m.url)}</loc>${m.modified ? `<lastmod>${m.modified.slice(0, 10)}</lastmod>` : ''}</url>`),
];
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`${items.length} materiais gerados (${items.filter((i) => i.key === 'planos').length} planos, ${items.filter((i) => i.key === 'downloads').length} gratuitos, ${items.filter((i) => i.key === 'recursos').length} da loja) e ${landings.length} páginas de filtro.`);
