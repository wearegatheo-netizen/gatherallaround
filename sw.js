self.addEventListener('push', function(event) {
    console.log('[sw] push event received', event);
    let data = { title: '게더올어라운드', body: '새 알림이 있습니다.' };
    if (event.data) {
        try {
            data = event.data.json();
            console.log('[sw] decoded json:', data);
        } catch (e) {
            console.log('[sw] json parse failed:', e);
            try {
                const txt = event.data.text();
                console.log('[sw] text fallback:', txt);
                data.body = txt;
            } catch (e2) {
                console.log('[sw] text() failed:', e2);
            }
        }
    } else {
        console.log('[sw] no event.data');
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'gaa',
            requireInteraction: false,
            data: { url: data.url || '/' }
        }).then(() => console.log('[sw] showNotification ok'))
          .catch(e => console.log('[sw] showNotification failed', e))
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
