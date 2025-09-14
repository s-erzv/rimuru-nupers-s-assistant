import React, { useState } from 'react';
import Card from '../components/ui/Card';

export default function LoginPage({ onLogin, API_BASE_URL }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/login`, {
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