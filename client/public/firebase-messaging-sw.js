// public/firebase-messaging-sw.js
/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// NOTE: config HARUS hardcode di SW (env tidak otomatis tersedia di SW)
// Aman karena ini memang config public client-side.
firebase.initializeApp({
  apiKey: "AIzaSyA7wrc7wf291vRJZcnNcMPmYW4Jqho33ds",
  authDomain: "share-gcp-fca72.firebaseapp.com",
  projectId: "share-gcp-fca72",
  storageBucket: "share-gcp-fca72.firebasestorage.app",
  messagingSenderId: "122172344089",
  appId: "1:122172344089:web:bf22a59f0a73aaea4f6788",
  measurementId: "G-R29T302P3C",
});

const messaging = firebase.messaging();

// Optional: tampilkan notif saat background message
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'New message';
  const options = {
    body: payload?.notification?.body,
    icon: '/icon-192.png', // sediakan icon ini di public/ jika mau
    data: payload?.data || {},
  };
  self.registration.showNotification(title, options);
});

// (Opsional) click action
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
