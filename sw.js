/* Service Worker — Aventura com Jesus (cache offline simples)
   IGUAL ao do app original, com UMA diferenca obrigatoria: neste deploy o
   index.html esta na RAIZ (e o resto do app em /app/), entao o sw precisa
   ficar na raiz pra ter escopo "/" — se ficasse em /app/ ele nao controlaria
   a pagina. Os caminhos do CORE seguem esse mesmo ajuste. */
const V = '187'; // BUMPAR a cada release — senao offline serve versao velha
const CACHE = 'aventura-v' + V;
const CORE = [
  '/', '/index.html', '/app/app.css', '/app/app.js', '/app/data.js',
  '/app/manifest.json', '/app/assets/img/logos/logo_aventura_branco.webp',
  '/app/assets/img/pet_donkey.webp', '/app/assets/img/pet_room_bg.webp'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  // cache resiliente: cada arquivo e independente (um que falhe nao impede os outros)
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CORE.map(u => c.add(u)))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* cache-first p/ assets do app (imagens, anim, som, fontes); network-first p/ o resto */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // ignora CDN / audio externo
  const isAsset = /\/assets\/|\.(webp|png|jpg|jpeg|json|mp3|wav|ttf|css|js)(\?|$)/.test(url.pathname + url.search);
  if (isAsset) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        // SO cacheia resposta BOA. O sw original guardava qualquer coisa — inclusive 404 —
        // e um arquivo que ainda nao existia no deploy ficava "quebrado pra sempre"
        // naquele navegador ate bumpar o V. Este if e a unica diferenca de logica.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit))
    );
  } else {
    e.respondWith(fetch(req).catch(() => caches.match(req).then(h => h || caches.match('/index.html'))));
  }
});

/* ===== WEB PUSH — substitui as notificacoes nativas do Capacitor no PWA =====
   No app nativo o CELULAR agenda o lembrete sozinho. Aqui quem dispara e o
   SERVIDOR (cron do backend manda o push). Este handler recebe e mostra,
   mesmo com o app fechado. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Aventura com Jesus';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'A aventura de fe do seu pequeno continua hoje.',
    icon: d.icon || '/app/assets/img/logos/app_icon_192.png',
    badge: '/app/assets/img/logos/app_icon_192.png',
    tag: d.tag || 'acj-lembrete',
    renotify: false,
    data: { url: d.url || '/index.html' }
  }));
});

/* toque na notificacao: se o app ja esta aberto, foca; senao abre */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
