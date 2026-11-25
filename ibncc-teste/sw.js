// Endereço antigo do I-BNCC: remove a versão guardada e deixa o redirecionamento para /ibncc/.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ns) => Promise.all(ns.map((n) => caches.delete(n))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll()).then((cs) => cs.forEach((c) => c.navigate('../ibncc/'))));
});
