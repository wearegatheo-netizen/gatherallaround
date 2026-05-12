self.addEventListener('push', function(event) {
    let data = { title: '게더올어라운드', body: '새 알림이 있습니다.' };
    if (event.data) {
        try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'gaa',
            requireInteraction: false,
            data: { url: data.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (const client of clientList) {
                if ('focus' in client) { client.focus(); return; }
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
