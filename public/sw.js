
// public/sw.js - Service Worker para notificações push
const CACHE_NAME = 'casa-automacao-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  console.log('🛠️ Service Worker instalado');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Cache aberto');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker ativado');
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
      }
    )
  );
});

// 🚨 SISTEMA DE NOTIFICAÇÕES PUSH
self.addEventListener('push', (event) => {
  console.log('📨 Push notification recebida', event);
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('❌ Erro ao parsear dados push:', error);
    data = {
      title: 'Alerta de Segurança',
      body: 'Alerta do sistema de automação',
      icon: '/icons/icon-192x192.png'
    };
  }

  const options = {
    body: data.body || 'Alerta do sistema de automação residencial',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    image: data.image || '/icons/alert-gas-512x512.png',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    actions: [
      {
        action: 'view-details',
        title: 'Ver Detalhes',
        icon: '/icons/eye-24x24.png'
      },
      {
        action: 'snooze',
        title: 'Adiar 5min',
        icon: '/icons/snooze-24x24.png'
      }
    ],
    data: {
      url: data.url || '/',
      alertType: data.alertType || 'gas',
      timestamp: data.timestamp || new Date().toISOString(),
      gasLevel: data.gasLevel || 0
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🚨 Alerta de Gás', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notificação clicada:', event);
  
  event.notification.close();

  if (event.action === 'view-details') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  } else if (event.action === 'snooze') {
    // Implementar adiamento se necessário
    console.log('⏰ Notificação adiada por 5 minutos');
  } else {
    // Clique normal na notificação
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('🔄 Assinatura push alterada');
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then((subscription) => {
        console.log('✅ Nova assinatura criada:', subscription);
      })
  );
});
