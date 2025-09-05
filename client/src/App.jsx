import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseConfig } from './firebaseConfig';

const formatIDDateTime = (seconds) => {
  try {
    return new Date(seconds * 1000).toLocaleString('id-ID', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta', 
    });
  } catch {
    return '-';
  }
};

const formatIDR = (n) =>
  new Intl.NumberFormat('id-ID').format(Math.abs(n || 0));

// ————————————————————————————————————————————————
// Base atoms
// ————————————————————————————————————————————————
function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center space-x-3">
        <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function Card({ children, className = '' }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow ${className}`}>
      {children}
    </div>
  );
}

function Stat({ label, value, hint, tone = 'default' }) {
  const toneMap = {
    default: 'text-slate-900',
    positive: 'text-emerald-700',
    negative: 'text-rose-700',
    info: 'text-blue-700',
  };
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${toneMap[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </Card>
  );
}

function Badge({ children, tone = 'default' }) {
  const tones = {
    default: 'bg-slate-100 text-slate-700',
    positive: 'bg-emerald-100 text-emerald-700',
    negative: 'bg-rose-100 text-rose-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Empty({ icon, title, desc }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {desc && <p className="text-xs text-slate-500 mt-1">{desc}</p>}
    </Card>
  );
}

// ————————————————————————————————————————————————
// Schedule List — clean & compact
// ————————————————————————————————————————————————
function ScheduleList({ schedules }) {
  return (
    <div className="p-6">
      <SectionHeader
        title="Schedule"
        subtitle="Your current agenda"
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
          </svg>
        }
      />

      {!schedules || schedules.length === 0 ? (
        <Empty
          title="No schedule yet"
          desc="Add a schedule via the Chat tab"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
            </svg>
          }
        />
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <Card key={s.id} className="p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{s.content}</p>
                  <div className="mt-1 flex items-center text-xs text-slate-500 space-x-1">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                    <span>{formatIDDateTime(s?._seconds)}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ————————————————————————————————————————————————
// Finance List — neutral & data-forward
// ————————————————————————————————————————————————
function FinanceList({ finances }) {
  const list = Array.isArray(finances) ? finances : [];

  const isIncome = (f) => f?.type === 'income' || (f?.type == null && (f?.amount || 0) > 0);
  const incomes = list.filter(isIncome).reduce((a, b) => a + Math.abs(b.amount || 0), 0);
  const expenses = list.filter((f) => !isIncome(f)).reduce((a, b) => a + Math.abs(b.amount || 0), 0);
  const balance = incomes - expenses;

  return (
    <div className="p-6">
      <SectionHeader
        title="Finances"
        subtitle="Transactions overview"
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0-2.08-.402-2.599-1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
          </svg>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Stat label="Income" value={`Rp${formatIDR(incomes)}`} tone="positive" />
        <Stat label="Expenses" value={`Rp${formatIDR(expenses)}`} tone="negative" />
        <Stat label="Balance" value={`Rp${formatIDR(balance)}`} tone={balance >= 0 ? 'info' : 'negative'} />
      </div>

      {/* List */}
      {list.length === 0 ? (
        <Empty
          title="No transactions yet"
          desc="Track income/expenses via Chat"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0-2.08-.402-2.599-1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
            </svg>
          }
        />
      ) : (
        <div className="space-y-3">
          {list.map((f) => {
            const income = isIncome(f);
            return (
              <Card key={f.id} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{f.item}</p>
                    <div className="mt-1 flex items-center text-xs text-slate-500 space-x-1">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                      </svg>
                      <span>{formatIDDateTime(f?._seconds)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <Badge tone={income ? 'positive' : 'negative'}>{income ? 'Income' : 'Expense'}</Badge>
                    <p className={`mt-2 text-lg font-semibold ${income ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {income ? '+' : '-'}Rp{formatIDR(f.amount)}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ————————————————————————————————————————————————
// Main App Component
// ————————————————————————————————————————————————
function MainApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [finances, setFinances] = useState([]);
  const [activeTab, setActiveTab] = useState('chat');
  const [errorMessage, setErrorMessage] = useState('');
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  const fetchWithAuth = async (url, options = {}) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        setErrorMessage('Sesi habis, silakan login ulang.');
        throw new Error('No auth token found');
    }
    const headers = { ...options.headers, 'Authorization': token };
    const response = await fetch(url, { ...options, headers });
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
    if (isFirstLoad) {
      const greetingMessage = {
        sender: 'gemini',
        text:
          "Yo! I’m Rimuru, your buddy from **Nupers’s Assistant** 😎. Here to back up your lazy lifestyle and keep things on track. Type something to get rollin’!",
      };
      setMessages([greetingMessage]);
      setIsFirstLoad(false);
      registerForPush();
    }
  }, [isFirstLoad]);


  const fetchAllData = async () => {
    try {
      const [schedulesRes, financesRes] = await Promise.all([
        fetchWithAuth('https://rimuru-backend.up.railway.app/api/schedules'),
        fetchWithAuth('https://rimuru-backend.up.railway.app/api/finances'),
      ]);
      if (!schedulesRes.ok || !financesRes.ok) throw new Error('Failed to fetch from server.');
      const schedulesData = await schedulesRes.json();
      const financesData = await financesRes.json();
      setSchedules(schedulesData);
      setFinances(financesData);
      setErrorMessage('');
    } catch (err) {
      console.error(err);
      setErrorMessage('There was an error fetching data. Please try again.');
    }
  };

  useEffect(() => {
    if (activeTab === 'data') fetchAllData();
  }, [activeTab]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newMessage = { sender: 'user', text: input.trim() };
    setMessages((prev) => [...prev, newMessage, { sender: 'gemini', text: 'Processing…', isLoading: true }]);
    setInput('');

    try {
      const res = await fetchWithAuth('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage.text }),
      });
      if (!res.ok) throw new Error('Failed to send message.');
      const data = await res.json();

      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => !m.isLoading);
        const newResponse = { sender: 'gemini', text: data.text };
        if (data.dataType === 'finances' || data.dataType === 'schedules') {
          newResponse.dataType = data.dataType;
          newResponse.data = data.data;
        }
        return [...withoutLoading, newResponse];
      });
      setErrorMessage('');
    } catch (err) {
      console.error(err);
      setMessages((prev) => prev.filter((m) => !m.isLoading));
      setErrorMessage('There was an error sending your message. Please try again.');
    }
  };

  const TabButton = ({ id, icon, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex flex-col items-center justify-center gap-1 w-full p-2 transition-colors
        ${activeTab === id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
    >
      <span className="h-6 w-6">{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 text-slate-900">
      {/* Header — compact, sticky */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 4v10l-7 4-7-4V7l7-4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold">Nupers's Assistant</h1>
            <p className="text-xs text-slate-500">Your personal hub</p>
          </div>
          {/* Logout button */}
          <div className="ml-auto">
            <button
              onClick={() => {
                localStorage.removeItem('auth_token');
                window.location.reload();
              }}
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              Logout
            </button>
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
        {activeTab === 'chat' ? (
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto space-y-3 pb-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.dataType === 'finances' ? (
                    <div className="w-full">
                      <ReactMarkdown
                        components={{
                          p: ({ node, ...props }) => <p className="whitespace-pre-line text-sm leading-relaxed mb-2" {...props} />,
                          ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2" {...props} />,
                          li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                          em: ({ node, ...props }) => <em className="italic" {...props} />,
                        }}
                      >
                        {m.text}
                      </ReactMarkdown>
                      <FinanceList finances={m.data} />
                    </div>
                  ) : m.dataType === 'schedules' ? (
                    <div className="w-full">
                      <ReactMarkdown
                        components={{
                          p: ({ node, ...props }) => <p className="whitespace-pre-line text-sm leading-relaxed mb-2" {...props} />,
                          ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2" {...props} />,
                          li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                          em: ({ node, ...props }) => <em className="italic" {...props} />,
                        }}
                      >
                        {m.text}
                      </ReactMarkdown>
                      <ScheduleList schedules={m.data} />
                    </div>
                  ) : (
                    <div
                      className={`max-w-md rounded-xl border ${
                        m.sender === 'user'
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-900 border-slate-200'
                      } p-3 shadow`}
                    >
                      <ReactMarkdown
                        components={{
                          p: ({ node, ...props }) => <p className="whitespace-pre-line text-sm leading-relaxed" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                          em: ({ node, ...props }) => <em className="italic" {...props} />,
                        }}
                      >
                        {m.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Composer */}
            <div className="w-full sticky bottom-0 z-10 bg-white border-t border-slate-200 pt-3 pb-2">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type a message…"
                  className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />
                <button
                  type="submit"
                  className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-900 text-white hover:bg-black transition-colors"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-7-7l7 7-7 7" />
                  </svg>
                </button>
              </form>

              {/* Quick actions */}
              <div className="mt-2 flex flex-wrap gap-2">
                {['Schedule a meeting tomorrow at 10', 'Log lunch expense 15000', 'Log salary income 5000000', 'Ringkas keuanganku minggu ini', 'Tampilkan jadwalku bulan ini'].map(
                  (preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInput(preset)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {preset}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="h-auto lg:h-[calc(100vh-220px)] overflow-y-auto">
              <ScheduleList schedules={schedules} />
            </Card>
            <Card className="h-auto lg:h-[calc(100vh-220px)] overflow-y-auto">
              <FinanceList finances={finances} />
            </Card>
          </div>
        )}
      </div>

      {/* Mobile Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-slate-200 p-2 lg:hidden">
        <div className="flex justify-around">
          <TabButton
            id="chat"
            label="Chat"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <TabButton
            id="data"
            label="Dashboard"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h18M3 9h18M3 15h18M3 21h18" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————
// Login Component
// ————————————————————————————————————————————————
function LoginPage({ onLogin }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('auth_token', data.token);
        onLogin();
      } else {
        setError('Kode rahasia salah. Coba lagi.');
      }
    } catch (err) {
      setError('Terjadi kesalahan saat mencoba login.');
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-slate-50 text-slate-900">
      <Card className="p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2">Halo! 👋</h1>
        <p className="text-sm text-slate-600 mb-6">Masukkan kode rahasia kamu untuk melanjutkan.</p>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Kode rahasia"
            className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
          />
          {error && <p className="text-sm text-rose-500">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black transition-colors"
          >
            Masuk
          </button>
        </form>
      </Card>
    </div>
  );
}

// ————————————————————————————————————————————————
// App
// ————————————————————————————————————————————————
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      // Validasi sederhana: cek apakah token tidak kadaluarsa (misalnya 24 jam)
      if (new Date().getTime() - parseInt(token) < 24 * 60 * 60 * 1000) {
        setIsLoggedIn(true);
      } else {
        localStorage.removeItem('auth_token');
      }
    }
  }, []);

  if (!isLoggedIn) {
    return <LoginPage onLogin={() => setIsLoggedIn(true)} />;
  }

  return <MainApp />;
}