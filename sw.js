// sw.js
const CACHE = 'gabi-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Guarda os timers ativos
const timers = {};

self.addEventListener('message', event => {
  if (event.data?.tipo !== 'AGENDAMENTOS') return;

  const agendas = event.data.agendas || [];

  // Limpa timers antigos
  Object.values(timers).forEach(id => clearTimeout(id));
  Object.keys(timers).forEach(k => delete timers[k]);

  const agora = Date.now();

  agendas.forEach(ag => {
    if (!ag.data || !ag.hora || ag.status === 'cancelado') return;

    // Monta o timestamp do agendamento
    const dt = new Date(`${ag.data}T${ag.hora}:00`);
    const msParaNotif = dt.getTime() - 60 * 60 * 1000 - agora; // 1h antes

    if (msParaNotif < 0) return; // já passou

    timers[ag.id] = setTimeout(() => {
      self.registration.showNotification('✂️ Espaço Gabi Borges', {
        body: `${ag.cliente} chega em 1 hora — ${ag.servico} às ${ag.hora}`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `agenda-${ag.id}`,
        renotify: true,
        data: { agendaId: ag.id }
      });
    }, msParaNotif);
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
