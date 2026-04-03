// sw.js — Espaço Gabi Borges (VERSÃO CORRIGIDA COM PERSISTÊNCIA)
const CACHE_NAME = 'gabi-v3';
const DB_NAME = 'GabiDB';
const DB_STORE = 'agendamentos';

// ════════════════════════════════════════════════════════════
// INICIALIZAÇÃO DO SERVICE WORKER
// ════════════════════════════════════════════════════════════

self.addEventListener('install', () => {
  console.log('[SW] Instalando Service Worker');
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Ativando Service Worker');
  e.waitUntil(self.clients.claim());
});

// ════════════════════════════════════════════════════════════
// INDEXEDDB - PERSISTÊNCIA DE AGENDAMENTOS
// ════════════════════════════════════════════════════════════

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
  });
}

async function salvarAgendamentos(agendas) {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    
    // Limpa os antigos
    store.clear();
    
    // Salva os novos
    agendas.forEach(ag => {
      store.add({
        id: ag.id,
        cliente: ag.cliente,
        servico: ag.servico,
        data: ag.data,
        hora: ag.hora,
        obs: ag.obs || '',
        status: ag.status || 'pendente',
        notificacaoEnviada: false
      });
    });
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[SW] Erro ao salvar agendamentos:', err);
  }
}

async function obterAgendamentos() {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('[SW] Erro ao obter agendamentos:', err);
    return [];
  }
}

async function marcarNotificacaoEnviada(agendaId) {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(agendaId);
    
    req.onsuccess = () => {
      const ag = req.result;
      if (ag) {
        ag.notificacaoEnviada = true;
        store.put(ag);
      }
    };
  } catch (err) {
    console.error('[SW] Erro ao marcar notificação:', err);
  }
}

// ════════════════════════════════════════════════════════════
// VERIFICAÇÃO E ENVIO DE NOTIFICAÇÕES
// ════════════════════════════════════════════════════════════

async function verificarEEnviarNotificacoes() {
  console.log('[SW] Verificando agendamentos para notificações...');
  
  const agendas = await obterAgendamentos();
  const agora = Date.now();
  
  agendas.forEach(async (ag) => {
    // Pula se já foi notificado, cancelado ou sem dados
    if (ag.notificacaoEnviada || ag.status === 'cancelado' || !ag.data || !ag.hora) {
      return;
    }
    
    // Calcula o horário do agendamento
    const [hh, mm] = ag.hora.split(':');
    const dtAgenda = new Date(`${ag.data}T${hh.padStart(2,'0')}:${mm.padStart(2,'0')}:00`);
    const dtAviso = dtAgenda.getTime() - 60 * 60 * 1000; // 1 hora antes
    
    // Se já passou o horário de aviso, envia agora
    if (dtAviso <= agora && dtAviso > agora - 5 * 60 * 1000) {
      console.log(`[SW] ✅ Enviando notificação para ${ag.cliente}`);
      
      await self.registration.showNotification('✂️ Espaço Gabi Borges', {
        body: `${ag.cliente} chega em 1 hora — ${ag.servico} às ${ag.hora}`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: `agenda-${ag.id}`,
        renotify: true,
        vibrate: [200, 100, 200],
        data: { agendaId: ag.id },
        requireInteraction: true // Força o usuário a interagir
      });
      
      // Marca como enviada
      await marcarNotificacaoEnviada(ag.id);
    }
  });
}

// ════════════════════════════════════════════════════════════
// RECEBER AGENDAMENTOS DO APP
// ════════════════════════════════════════════════════════════

self.addEventListener('message', async (event) => {
  console.log('[SW] Mensagem recebida:', event.data);
  
  if (!event.data || event.data.tipo !== 'AGENDAMENTOS') return;
  
  const agendas = event.data.agendas || [];
  console.log(`[SW] Recebido ${agendas.length} agendamentos`);
  
  // Salva no IndexedDB
  await salvarAgendamentos(agendas);
  
  // Verifica e envia notificações imediatamente
  await verificarEEnviarNotificacoes();
  
  // Confirma para o app
  const futuros = agendas.filter(ag => {
    if (!ag.data || !ag.hora || ag.status === 'cancelado') return false;
    const dt = new Date(`${ag.data}T${ag.hora}:00`).getTime() - 3600000;
    return dt > Date.now() - 10000;
  }).length;
  
  event.source?.postMessage({ 
    tipo: 'AGENDADOS', 
    total: futuros,
    mensagem: `${futuros} agendamentos sincronizados com sucesso`
  });
});

// ════════════════════════════════════════════════════════════
// BACKGROUND SYNC - SINCRONIZAR PERIODICAMENTE
// ════════════════════════════════════════════════════════════

self.addEventListener('sync', (event) => {
  console.log('[SW] Background Sync disparado:', event.tag);
  
  if (event.tag === 'sync-agendamentos') {
    event.waitUntil(verificarEEnviarNotificacoes());
  }
});

// ════════════════════════════════════════════════════════════
// PERIODIC SYNC - VERIFICAR A CADA 15 MINUTOS
// ════════════════════════════════════════════════════════════

self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic Sync disparado:', event.tag);
  
  if (event.tag === 'check-agendamentos') {
    event.waitUntil(verificarEEnviarNotificacoes());
  }
});

// ════════════════════════════════════════════════════════════
// CLIQUE NA NOTIFICAÇÃO
// ════════════════════════════════════════════════════════════

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notificação clicada:', event.notification.tag);
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Se já existe janela aberta, foca nela
      if (clients.length > 0) {
        return clients[0].focus();
      }
      // Senão, abre uma nova
      return self.clients.openWindow('./');
    })
  );
});

// ════════════════════════════════════════════════════════════
// FETCH - CACHE STRATEGY
// ════════════════════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  // Ignora requisições não-GET
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      
      return fetch(event.request).then(response => {
        // Não cacheia se não for sucesso
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        
        // Clona a resposta
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        
        return response;
      }).catch(() => {
        // Fallback offline
        return caches.match(event.request);
      });
    })
  );
});
