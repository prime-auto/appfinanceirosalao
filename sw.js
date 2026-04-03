// sw-salao.js — Service Worker com Notificações Automáticas
const CACHE_NAME = 'salao-v1';
const DB_NAME = 'SalaoDb';
const DB_VERSION = 1;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ════════════════════════════════════════════════════════════
// IndexedDB
// ════════════════════════════════════════════════════════════

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('agendas')) {
        db.createObjectStore('agendas', {keyPath: 'id'});
      }
    };
  });
}

function getAgendas() {
  return new Promise(async (resolve) => {
    try {
      const db = await openDB();
      const store = db.transaction('agendas', 'readonly').objectStore('agendas');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

function saveAgendas(agendas) {
  return new Promise(async (resolve) => {
    try {
      const db = await openDB();
      const store = db.transaction('agendas', 'readwrite').objectStore('agendas');
      store.clear();
      agendas.forEach(a => store.add(a));
      resolve(true);
    } catch (e) {
      resolve(false);
    }
  });
}

// ════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO DE AGENDAMENTOS
// ════════════════════════════════════════════════════════════

self.addEventListener('message', async (event) => {
  if (!event.data || event.data.tipo !== 'AGENDAMENTOS') return;

  const agendas = event.data.agendas || [];
  await saveAgendas(agendas);

  // Confirma para o app
  event.source?.postMessage({tipo: 'AGENDAMENTOS_SYNC', total: agendas.length});

  // Agenda notificações
  scheduleNotifications(agendas);
});

// ════════════════════════════════════════════════════════════
// AGENDAMENTO DE NOTIFICAÇÕES
// ════════════════════════════════════════════════════════════

const timers = {};

function scheduleNotifications(agendas) {
  // Limpa timers anteriores
  Object.values(timers).forEach(id => clearTimeout(id));
  Object.keys(timers).forEach(k => delete timers[k]);

  const agora = Date.now();

  agendas.forEach(ag => {
    if (!ag.data || !ag.hora || ag.status === 'cancelado') return;

    // Monta o horário exato
    const [hh, mm] = ag.hora.split(':');
    const dtAgenda = new Date(`${ag.data}T${hh.padStart(2,'0')}:${mm.padStart(2,'0')}:00`);
    const dtAviso = dtAgenda.getTime() - 60 * 60 * 1000; // 1 hora antes
    const msRestam = dtAviso - agora;

    // Só agenda se ainda está no futuro
    if (msRestam < -10000) return;

    const delay = Math.max(msRestam, 0);

    timers[ag.id] = setTimeout(() => {
      self.registration.showNotification('💇 Lembrete de Agendamento', {
        body: `${ag.cliente} chega em 1 hora\n${ag.servico} às ${ag.hora}`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%23e94560"/><text x="50" y="55" font-size="60" text-anchor="middle" fill="white">✂</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%23e94560"/><text x="50" y="55" font-size="60" text-anchor="middle" fill="white">✂</text></svg>',
        tag: `agenda-${ag.id}`,
        renotify: true,
        vibrate: [300, 100, 300],
        data: {agendaId: ag.id, cliente: ag.cliente, servico: ag.servico, hora: ag.hora},
        actions: [
          {action: 'confirm', title: '✓ Confirmar'},
          {action: 'dismiss', title: 'Descartar'}
        ]
      });

      console.log(`[SW] Notificação enviada para ${ag.cliente} às ${ag.hora}`);
    }, delay);
  });

  console.log(`[SW] ${Object.keys(timers).length} agendamentos sincronizados para notificação`);
}

// ════════════════════════════════════════════════════════════
// CLIQUE NA NOTIFICAÇÃO
// ════════════════════════════════════════════════════════════

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'confirm') {
    console.log(`[SW] Agendamento confirmado: ${event.notification.data.cliente}`);
  } else if (event.action === 'dismiss') {
    console.log(`[SW] Agendamento descartado`);
  }

  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});

// ════════════════════════════════════════════════════════════
// PERIODIC SYNC (Background Sync)
// ════════════════════════════════════════════════════════════

self.addEventListener('periodicsync', async (event) => {
  if (event.tag === 'sync-agendas') {
    console.log('[SW] Periodic Sync acionado');

    const agendas = await getAgendas();
    if (agendas.length > 0) {
      scheduleNotifications(agendas);
    }
  }
});

// ════════════════════════════════════════════════════════════
// BACKGROUND SYNC
// ════════════════════════════════════════════════════════════

self.addEventListener('sync', async (event) => {
  if (event.tag === 'sync-agendas') {
    console.log('[SW] Background Sync acionado');

    const agendas = await getAgendas();
    if (agendas.length > 0) {
      scheduleNotifications(agendas);
    }
  }
});
