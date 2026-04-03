// sw.js — Espaço Gabi Borges
const CACHE_NAME = 'gabi-v2';
const timers = {};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Recebe agendamentos do app e agenda os avisos
self.addEventListener('message', event => {
  if (!event.data || event.data.tipo !== 'AGENDAMENTOS') return;

  const agendas = event.data.agendas || [];

  // Cancela todos os timers anteriores
  Object.values(timers).forEach(id => clearTimeout(id));
  Object.keys(timers).forEach(k => delete timers[k]);

  const agora = Date.now();

  agendas.forEach(ag => {
    if (!ag.data || !ag.hora) return;
    if (ag.status === 'cancelado') return;

    // Monta o horário exato do agendamento
    const [hh, mm] = ag.hora.split(':');
    const dtAgenda = new Date(`${ag.data}T${hh.padStart(2,'0')}:${mm.padStart(2,'0')}:00`);
    const dtAviso  = dtAgenda.getTime() - 60 * 60 * 1000; // 1 hora antes
    const msRestam = dtAviso - agora;

    // Só agenda se ainda está no futuro (com até 10s de tolerância)
    if (msRestam < -10000) return;

    const delay = Math.max(msRestam, 0);

    timers[ag.id] = setTimeout(() => {
      self.registration.showNotification('✂️ Espaço Gabi Borges', {
        body: `${ag.cliente} chega em 1 hora — ${ag.servico} às ${ag.hora}`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: `agenda-${ag.id}`,
        renotify: true,
        vibrate: [200, 100, 200],
        data: { agendaId: ag.id }
      });
    }, delay);
  });

  // Confirma para o app quantos foram agendados
  const futuros = agendas.filter(ag => {
    if (!ag.data || !ag.hora || ag.status === 'cancelado') return false;
    const dt = new Date(`${ag.data}T${ag.hora}:00`).getTime() - 3600000;
    return dt > agora - 10000;
  }).length;

  event.source && event.source.postMessage({ tipo: 'AGENDADOS', total: futuros });
});

// Clique na notificação abre o app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
