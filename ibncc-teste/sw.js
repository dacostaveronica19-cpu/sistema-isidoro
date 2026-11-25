// Service worker do I-BNCC: guarda os arquivos do app para uso sem internet.
// Ao publicar uma nova versão, basta mudar o número abaixo.
const VERSAO = 'ibncc-v0.2.1';
const ARQUIVOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './dados.js',
  './manifest.webmanifest',
  './icons/icone-192.png',
  './icons/icone-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './fonts/inter.woff2',
  './fonts/crimson-Regular.woff2',
  './fonts/crimson-SemiBold.woff2',
  './fonts/crimson-Bold.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const rede = fetch(req).then((resp) => {
        if (resp && resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
        }
        return resp;
      }).catch(() => cached);
      return cached || rede;
    })
  );
});
