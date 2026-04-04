const CACHE = 'salao-v4';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
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

// ── LÊ AGENDAMENTOS DO INDEXEDDB (mesmo banco que o app usa via wrapper) ──
function lerAgendas() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('salaoDB', 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore('dados');
      };
      req.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction('dados', 'readonly');
        const store = tx.objectStore('dados');
        const get = store.get('agendas');
        get.onsuccess = () => resolve(get.result || []);
        get.onerror = () => resolve([]);
      };
      req.onerror = () => resolve([]);
    } catch(err) { resolve([]); }
  });
}

// ── SALVA agendas recebidas via postMessage no IndexedDB ──
function salvarAgendasIDB(agendas) {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('salaoDB', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('dados');
      req.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction('dados', 'readwrite');
        tx.objectStore('dados').put(agendas, 'agendas');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    } catch(err) { resolve(); }
  });
}

// ── RECEBE agendamentos do app e salva no IDB ──
self.addEventListener('message', async e => {
  if (e.data && e.data.tipo === 'AGENDAMENTOS') {
    await salvarAgendasIDB(e.data.agendas || []);
  }
});

// ── CONTROLE: quais IDs já foram notificados hoje ──
const jaNotificados = new Set();

async function verificarENotificar() {
  const agendas = await lerAgendas();
  if (!agendas.length) return;

  const agora = new Date();
  const hoje  = agora.toISOString().split('T')[0];
  const amanha = new Date(agora); amanha.setDate(agora.getDate() + 1);
  const amanhaISO = amanha.toISOString().split('T')[0];

  for (const a of agendas) {
    if (a.status === 'cancelado') continue;
    if (a.data !== hoje && a.data !== amanhaISO) continue;

    const [ano, mes, dia] = a.data.split('-').map(Number);
    const [hr, mn]        = a.hora.split(':').map(Number);
    const horario         = new Date(ano, mes - 1, dia, hr, mn, 0);
    const umHoraAntes     = new Date(horario.getTime() - 60 * 60 * 1000);
    const diffMs          = umHoraAntes.getTime() - agora.getTime();

    // Janela: entre 0 e 90 segundos antes do momento exato (cobre 1 ciclo de 60s com folga)
    const chave = `${a.id}-${a.data}-${a.hora}`;
    if (diffMs >= 0 && diffMs < 90000 && !jaNotificados.has(chave)) {
      jaNotificados.add(chave);
      await self.registration.showNotification('⏰ Agendamento em 1 hora', {
        body: `${a.cliente} — ${a.servico} às ${a.hora}`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'ag-' + a.id,
        renotify: false,
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 300],
      });
    }

    // Limpa flag depois de 2 minutos para não acumular memória
    if (diffMs < -120000) jaNotificados.delete(chave);
  }
}

// Verifica a cada 60 segundos
setInterval(verificarENotificar, 60000);

// Verifica também logo ao ativar
self.addEventListener('activate', () => {
  verificarENotificar();
});
