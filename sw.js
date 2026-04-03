const CACHE = 'salao-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('api.anthropic.com')) return;
  if (e.request.url.includes('fonts.googleapis.com')) return;
  if (e.request.url.includes('fonts.gstatic.com')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

// ── NOTIFICAÇÕES ──
// Recebe lista de agendamentos do app via postMessage
let agendamentosParaNotificar = [];

self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'AGENDAMENTOS') {
    agendamentosParaNotificar = e.data.agendas || [];
  }
});

// Verifica a cada 60 segundos se algum agendamento está a 1h de distância
setInterval(() => {
  const agora = new Date();
  const hoje  = agora.toISOString().split('T')[0];
  const amanha = new Date(agora); amanha.setDate(amanha.getDate() + 1);
  const amanhaISO = amanha.toISOString().split('T')[0];

  agendamentosParaNotificar.forEach(a => {
    if (a.status === 'cancelado') return;
    if (a.data !== hoje && a.data !== amanhaISO) return;

    const [ano, mes, dia] = a.data.split('-').map(Number);
    const [hr, mn] = a.hora.split(':').map(Number);
    const horario = new Date(ano, mes - 1, dia, hr, mn, 0);
    const umHoraAntes = new Date(horario.getTime() - 60 * 60 * 1000);

    // Dispara se estiver dentro da janela de 60s ao redor do momento exato
    const diffMs = umHoraAntes.getTime() - agora.getTime();
    if (diffMs >= 0 && diffMs < 60000) {
      const jaNotificado = a._notificado || false;
      if (!jaNotificado) {
        a._notificado = true; // evita duplicar dentro do mesmo minuto
        self.registration.showNotification('⏰ Agendamento em 1 hora', {
          body: `${a.cliente} — ${a.servico} às ${a.hora}`,
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag: 'ag-' + a.id,
          renotify: false,
          requireInteraction: true,
          vibrate: [200, 100, 200],
        });
      }
    }

    // Reset flag no dia seguinte para permitir nova notificação se reagendado
    if (diffMs < -120000) a._notificado = false;
  });
}, 60000); // a cada 1 minuto
