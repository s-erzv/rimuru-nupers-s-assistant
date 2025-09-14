import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseConfig } from './firebaseConfig';
import LoginPage from './Pages/LoginPage';
import Chat from './components/Chat';
import Dashboard from './components/Dashboard';
import Card from './components/ui/Card';

// Gunakan URL lengkap untuk produksi dan path relatif untuk dev proxy
const API_BASE_URL = 'https://rimuru-backend.up.railway.app';

function MainApp({ userToken }) {
  const [isChatView, setIsChatView] = useState(true);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const fetchWithAuth = async (url, options = {}) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setErrorMessage('Sesi habis, silakan login ulang.');
      throw new Error('No auth token found');
    }
    const headers = { ...options.headers, 'Authorization': `Bearer ${userToken}` };
    const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.reload();
    }
    return response;
  }

  const registerForPush = async () => {
    const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    const messaging = getMessaging(firebaseApp);
    try {
      const isMessagingSupported = await isSupported();
      if (!isMessagingSupported) {
        console.log('Firebase Messaging is not supported in this browser.');
        return;
      }
      await Notification.requestPermission();
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      const token = await getToken(messaging, { vapidKey });
      console.log('FCM Token:', token);
      await fetchWithAuth('/api/register-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      console.log('FCM token registered with server.');
    } catch (err) {
      console.error('Failed to get FCM token or permission', err);
    }
  };

  useEffect(() => {
    // START: Service Worker PWA Registration
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').then(registration => {
          console.log('Service Worker berhasil didaftarkan dengan ruang lingkup:', registration.scope);
        }).catch(error => {
          console.error('Pendaftaran Service Worker gagal:', error);
        });
      });
    }
    // END: Service Worker PWA Registration
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuRef]);

  const handleMenuAction = (action) => {
    setIsMenuOpen(false);
    if (action === 'dashboard') {
      setIsChatView(false);
    } else if (action === 'logout') {
      localStorage.removeItem('auth_token');
      window.location.reload();
    } else if (action === 'chat') {
      setIsChatView(true);
    }
  }

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 text-slate-900">
      {/* Header — compact, sticky */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full overflow-hidden flex-shrink-0">
            <img src="/rimuru.png" alt="Rimuru Avatar" className="w-full h-full object-cover" />
          </div>
          <div className="flex-grow">
            <h1 className="text-base font-semibold">Nupers's Assistant</h1>
            <p className="text-xs text-slate-500">Your personal hub</p>
          </div>
          {/* Action button with dropdown */}
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="h-9 w-9 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors"
              aria-label="Open menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 top-10 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-20">
                <div className="py-1">
                  {isChatView ? (
                    <button
                      onClick={() => handleMenuAction('dashboard')}
                      className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      Dashboard
                    </button>
                  ) : (
                    <button
                      onClick={() => handleMenuAction('chat')}
                      className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      Chat
                    </button>
                  )}
                  <button
                    onClick={() => handleMenuAction('logout')}
                    className="block w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-slate-100"
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="mt-3 w-full px-6">
          <Card className="border-rose-200 bg-rose-50 text-rose-700">
            <div className="p-3 text-sm">{errorMessage}</div>
          </Card>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto w-full max-w-2xl mx-auto px-4 py-4 sm:px-6">
        {isChatView ? (
          <Chat
            API_BASE_URL={API_BASE_URL}
            userToken={userToken}
            fetchWithAuth={fetchWithAuth}
            registerForPush={registerForPush}
            isFirstLoad={isFirstLoad}
            setIsFirstLoad={setIsFirstLoad}
            setErrorMessage={setErrorMessage}
          />
        ) : (
          <Dashboard
            API_BASE_URL={API_BASE_URL}
            fetchWithAuth={fetchWithAuth}
            setErrorMessage={setErrorMessage}
          />
        )}
      </div>
    </div>
  );
}


// ————————————————————————————————————————————————
// Main App
// ————————————————————————————————————————————————
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userToken, setUserToken] = useState(null);
  const API_BASE_URL = 'https://rimuru-backend.up.railway.app';

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      if (new Date().getTime() - parseInt(token) < 24 * 60 * 60 * 1000) {
        setIsLoggedIn(true);
        setUserToken(token);
      } else {
        localStorage.removeItem('auth_token');
      }
    }
  }, []);

  const handleLogin = (token) => {
    localStorage.setItem('auth_token', token);
    setIsLoggedIn(true);
    setUserToken(token);
  };
  
  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} API_BASE_URL={API_BASE_URL} />;
  }

  return <MainApp userToken={userToken} />;
}