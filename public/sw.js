// public/sw.js - SERVICE WORKER CORRIGIDO PARA NOTIFICAÇÕES
const CACHE_NAME = 'casa-automacao-v3-push-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/login.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/badge-72x72.png',
  '/icons/alert-gas-512x512.png'
];

self.addEventListener('install', (event) => {
  console.log('🛠️ Service Worker instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Cache aberto - adicionando URLs');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Todos os recursos em cache');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ Erro no cache:', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker ativado - tomando controle');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// 🚨 SISTEMA DE NOTIFICAÇÕES PUSH CORRIGIDO - FUNCIONA COM NAVEGADOR FECHADO
self.addEventListener('push', (event) => {
  console.log('📨 Push notification recebida - Navegador pode estar fechado!');
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
    console.log('📊 Dados da notificação:', data);
  } catch (error) {
    console.error('❌ Erro ao parsear dados push:', error);
    data = {
      title: '🚨 Alerta de Segurança',
      body: 'Alerta do sistema de automação residencial',
      icon: '/icons/icon-192x192.png'
    };
  }

  // 🔥 CORREÇÃO CRÍTICA: Configurações otimizadas para mobile
  const options = {
    body: data.body || 'Alerta do sistema de automação',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    image: data.image || '/icons/alert-gas-512x512.png',
    vibrate: [1000, 500, 1000, 500, 1000],
    requireInteraction: true,
    tag: data.alertType || 'gas-alert',
    renotify: true,
    silent: false,
    actions: [
      {
        action: 'view-details',
        title: '🔍 Ver Detalhes',
        icon: '/icons/icon-72x72.png'
      },
      {
        action: 'silencio',
        title: '🔇 Silenciar',
        icon: '/icons/icon-72x72.png'
      }
    ],
    data: {
      url: data.url || '/index.html',
      alertType: data.alertType || 'gas',
      timestamp: data.timestamp || new Date().toISOString(),
      gasLevel: data.gasLevel || 0,
      critical: data.critical || false
    }
  };

  // 🔥 CORREÇÃO: Garantir que a notificação seja mostrada SEMPRE
  event.waitUntil(
    self.registration.showNotification(
      data.title || '🚨 Alerta - Casa Automação', 
      options
    ).then(() => {
      console.log('✅ Notificação exibida com sucesso no celular!');
    }).catch(error => {
      console.error('❌ Erro crítico ao mostrar notificação:', error);
      // Fallback: tentar com configurações mínimas
      const fallbackOptions = {
        body: data.body || 'Alerta importante',
        icon: '/icons/icon-192x192.png',
        vibrate: [1000, 500, 1000]
      };
      return self.registration.showNotification(
        data.title || 'Alerta',
        fallbackOptions
      );
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notificação clicada:', event.action);
  
  event.notification.close();

  const notificationData = event.notification.data || {};
  
  if (event.action === 'view-details') {
    // Abrir/focar na aplicação
    event.waitUntil(
      clients.matchAll({ 
        type: 'window', 
        includeUncontrolled: true 
      }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('/index.html') && 'focus' in client) {
            return client.focus();
          }
        }
        // Se não encontrou janela aberta, abrir nova
        return clients.openWindow('/index.html');
      })
    );
  } else if (event.action === 'silencio') {
    console.log('🔇 Notificação silenciada pelo usuário');
    // Enviar mensagem para a aplicação sobre o silenciamento
    event.waitUntil(
      clients.matchAll().then((allClients) => {
        allClients.forEach((client) => {
          client.postMessage({
            type: 'SILENCE_ALERTS',
            timestamp: new Date().toISOString()
          });
        });
      })
    );
  } else {
    // Clique normal na notificação
    event.waitUntil(
      clients.openWindow('/index.html').then((windowClient) => {
        console.log('📍 Aplicação aberta pelo clique na notificação');
      })
    );
  }
});

self.addEventListener('notificationclose', (event) => {
  console.log('❌ Notificação fechada pelo usuário');
});

// Background sync para notificações offline
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('🔄 Background sync triggered');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  console.log('🔄 Executando sincronização em background');
  // Implementar sincronização em background se necessário
}

// 🔥 NOVO: Message handler para comunicação com a aplicação
self.addEventListener('message', (event) => {
  console.log('📨 Mensagem recebida no Service Worker:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
