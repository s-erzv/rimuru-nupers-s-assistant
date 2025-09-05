const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const path = require('path');
const { autoSchedule } = require('./autoScheduler');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 5000;

const corsOptions = {
  origin: [
    'https://rimuru-xi.vercel.app/',
    'https://rimuru.up.railway.app',
    'https://rimuru-backend.up.railway.app',
    'http://localhost:5173'
  ],
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors());
app.use(express.json());

// --- helper env ---
function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} belum di-set`);
  return v;
}

// ===================== API INITIALIZATIONS =====================

// --- PERUBAHAN: Gunakan FIREBASE_SERVICE_ACCOUNT_JSON untuk Firebase Admin SDK ---
try {
  const serviceAccount = JSON.parse(must('FIREBASE_SERVICE_ACCOUNT_JSON'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialized from environment variable.');
} catch (e) {
  console.error("Firebase Admin initialization failed. Check FIREBASE_SERVICE_ACCOUNT_JSON environment variable.");
  process.exit(1);
}
const db = admin.firestore();

// --- PERUBAHAN: Gunakan GOOGLE_CALENDAR_SHEETS_SERVICE_ACCOUNT_JSON untuk Sheets & Calendar ---
let sheetsAndCalendarServiceAccount;
try {
  sheetsAndCalendarServiceAccount = JSON.parse(must('GOOGLE_CALENDAR_SHEETS_SERVICE_ACCOUNT_JSON'));
} catch (e) {
  console.error("Failed to parse GOOGLE_CALENDAR_SHEETS_SERVICE_ACCOUNT_JSON:", e.message);
  process.exit(1);
}

const sheetsAuth = new google.auth.GoogleAuth({
  credentials: sheetsAndCalendarServiceAccount,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

const calendarAuth = new google.auth.GoogleAuth({
  credentials: sheetsAndCalendarServiceAccount,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});
const calendar = google.calendar({ version: 'v3', auth: calendarAuth });

/* ===================== TASKS OAUTH ===================== */
const oauth2ClientTasks = new google.auth.OAuth2(
  must('GOOGLE_OAUTH_TASKS_CLIENT_ID'),
  must('GOOGLE_OAUTH_TASKS_CLIENT_SECRET'),
  must('GOOGLE_OAUTH_TASKS_REDIRECT_URI')
);

const TASKS_SCOPES = ['https://www.googleapis.com/auth/tasks'];
// --- PERUBAHAN: Baca token Tasks dari environment variable ---
if (process.env.GOOGLE_OAUTH_TASKS_TOKEN_JSON) {
  try {
    oauth2ClientTasks.setCredentials(JSON.parse(process.env.GOOGLE_OAUTH_TASKS_TOKEN_JSON));
    console.log('[Tasks OAuth] token dimuat dari environment variable.');
  } catch (e) {
    console.error('Failed to parse GOOGLE_OAUTH_TASKS_TOKEN_JSON:', e.message);
  }
}

// --- PERUBAHAN: Hapus penulisan file ke disk, tampilkan token di response ---
app.get('/auth/google', (req, res) => {
  const url = oauth2ClientTasks.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: TASKS_SCOPES,
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { tokens } = await oauth2ClientTasks.getToken(req.query.code);
    oauth2ClientTasks.setCredentials(tokens);
    res.send(`Google Tasks terhubung! Salin token ini dan simpan di variabel lingkungan GOOGLE_OAUTH_TASKS_TOKEN_JSON:<br/><br/>
              <pre>${JSON.stringify(tokens, null, 2)}</pre><br/><br/>Kamu bisa tutup tab ini.`);
  } catch (e) {
    console.error('OAuth Tasks error:', e.message);
    res.status(500).send('Gagal OAuth Tasks.');
  }
});

function getTasksClientOrThrow() {
  const has = oauth2ClientTasks?.credentials?.access_token || oauth2ClientTasks?.credentials?.refresh_token;
  if (!has) {
    const url = oauth2ClientTasks.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: TASKS_SCOPES });
    const err = new Error('Google Tasks belum terhubung. Buka /auth/google');
    err.authUrl = url;
    throw err;
  }
  return google.tasks({ version: 'v1', auth: oauth2ClientTasks });
}

/* ===================== GMAIL OAUTH ===================== */
const oauth2ClientGmail = new google.auth.OAuth2(
  must('GOOGLE_OAUTH_GMAIL_CLIENT_ID'),
  must('GOOGLE_OAUTH_GMAIL_CLIENT_SECRET'),
  must('GOOGLE_OAUTH_GMAIL_REDIRECT_URI')
);

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// --- PERUBAHAN: Baca token Gmail dari environment variable ---
if (process.env.GOOGLE_OAUTH_GMAIL_TOKEN_JSON) {
  try {
    oauth2ClientGmail.setCredentials(JSON.parse(process.env.GOOGLE_OAUTH_GMAIL_TOKEN_JSON));
    console.log('[Gmail OAuth] token dimuat dari environment variable.');
  } catch(e) {
    console.error('Failed to parse GOOGLE_OAUTH_GMAIL_TOKEN_JSON:', e.message);
  }
}

// --- PERUBAHAN: Hapus penulisan file ke disk, tampilkan token di response ---
app.get('/auth/gmail', (req, res) => {
  const url = oauth2ClientGmail.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
  });
  res.redirect(url);
});

app.get('/oauth2callback_gmail', async (req, res) => {
  try {
    const { tokens } = await oauth2ClientGmail.getToken(req.query.code);
    oauth2ClientGmail.setCredentials(tokens);
    res.send(`Gmail terhubung! Salin token ini dan simpan di variabel lingkungan GOOGLE_OAUTH_GMAIL_TOKEN_JSON:<br/><br/>
              <pre>${JSON.stringify(tokens, null, 2)}</pre><br/><br/>Kamu bisa tutup tab ini.`);
  } catch (e) {
    console.error('OAuth Gmail error:', e.message);
    res.status(500).send('Gagal OAuth Gmail.');
  }
});

function getGmailClientOrThrow() {
  const has = oauth2ClientGmail?.credentials?.access_token || oauth2ClientGmail?.credentials?.refresh_token;
  if (!has) {
    const url = oauth2ClientGmail.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES });
    const err = new Error('Gmail belum terhubung. Buka /auth/gmail');
    err.authUrl = url;
    throw err;
  }
  return google.gmail({ version: 'v1', auth: oauth2ClientGmail });
}

// ----------------- APP CONFIG -----------------
const CALENDAR_ID = 'sarahfajriarahmah@gmail.com';
const SPREADSHEET_ID = '144JyNngIWCm97EAgUEmNphCExkxSaxd6KDSsIVPytIY';
const WEEKLY_BUDGET = 500000;
const DAILY_FOOD_BUDGET = 50000;

const genAI = new GoogleGenerativeAI(must('GEMINI_API_KEY'));
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// --- MENGIMPOR ATURAN AI DARI FILE TERPISAH ---
const GEN_RULES = require('./gemini_rules');

// ----------------- TIME HELPERS -----------------
function formatLocalDateYMD(date, timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}
function formatLocalHM(date, timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const h = parts.find(p => p.type === 'hour').value;
  const m = parts.find(p => p.type === 'minute').value;
  return `${h}:${m}`;
}
function formatRFC3339Local(date, timeZone = 'Asia/Jakarta', offset = '+07:00') {
  const ymd = formatLocalDateYMD(date, timeZone);
  const hm = formatLocalHM(date, timeZone);
  return `${ymd}T${hm}:00${offset}`;
}

// ----------------- PERBAIKAN: PARSER WAKTU YANG LEBIH AKURAT -----------------
function parseStructuredSchedule(day, timeStartStr, timeEndStr) {
  console.log('Memulai parsing waktu dari data terstruktur:', { day, timeStartStr, timeEndStr });
  const dayMap = { 'minggu':0,'senin':1,'selasa':2,'rabu':3,'kamis':4,'jumat':5,'sabtu':6 };
  const monthMap = { 'januari':0,'februari':1,'maret':2,'april':3,'mei':4,'juni':5,'juli':6,'agustus':8,'september':8,'oktober':9,'november':10,'desember':11 };

  let recurrence = null;
  let targetDate = new Date();
  const now = new Date();
  const dayLower = (day || '').toLowerCase();
  
  // Logic to determine the target date...
  if (dayLower === 'hari ini' || dayLower === 'today') {
    targetDate = new Date();
  } else if (dayLower === 'besok' || dayLower === 'tomorrow') {
    targetDate.setDate(now.getDate() + 1);
  } else if (dayLower === 'lusa') {
    targetDate.setDate(now.getDate() + 2);
  } else if (dayMap[dayLower] !== undefined) {
    const diff = (dayMap[dayLower] - now.getDay() + 7) % 7;
    targetDate.setDate(now.getDate() + diff);
    recurrence = `RRULE:FREQ=WEEKLY;BYDAY=${['SU','MO','TU','WE','TH','FR','SA'][dayMap[dayLower]]}`;
  } else {
    const withYear = day && day.match(/(\d{1,2})\s(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s(\d{4})/i);
    const withoutYear = day && day.match(/(\d{1,2})\s(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)/i);
    if (withYear) {
      const [, d, m, y] = withYear;
      targetDate = new Date(y, monthMap[m.toLowerCase()], d);
    } else if (withoutYear) {
      const [, d, m] = withoutYear;
      targetDate = new Date(now.getFullYear(), monthMap[m.toLowerCase()], d);
    }
  }

  const [sh, sm] = (timeStartStr || '00:00').split(':').map(n => parseInt(n, 10));
  const [eh, em] = (timeEndStr || (timeStartStr ? `${sh + 1}:00` : '23:59')).split(':').map(n => parseInt(n, 10));
  const hadExplicitTime = !!(timeStartStr || timeEndStr);
  
  // Perbaikan utama di sini: Buat string ISO 8601 dengan offset +07:00
  const dateString = `${targetDate.getFullYear()}-${(targetDate.getMonth()+1).toString().padStart(2, '0')}-${targetDate.getDate().toString().padStart(2, '0')}`;
  
  const startTime = new Date(`${dateString}T${sh.toString().padStart(2, '0')}:${(sm || 0).toString().padStart(2, '0')}:00+07:00`);
  const endTime = new Date(`${dateString}T${eh.toString().padStart(2, '0')}:${(em || 0).toString().padStart(2, '0')}:00+07:00`);
  
  return { startTime, endTime, recurrence, hadExplicitTime };
}


// Helper untuk mengirim notifikasi FCM
async function sendPushNotification(title, body) {
  try {
    const snapshot = await db.collection('fcmTokens').get();
    const tokens = snapshot.docs.map(doc => doc.id);

    if (tokens.length === 0) {
      console.warn('Tidak ada token FCM yang terdaftar.');
      return;
    }

    const message = {
      notification: { title, body },
      tokens: tokens,
    };
    
    // Gunakan instance Firebase Admin SDK yang default
    const response = await admin.messaging().sendMulticast(message);
    console.log('Notifikasi terkirim:', response.successCount);
  } catch (error) {
    console.error('Error saat mengirim notifikasi:', error);
  }
}

// ----------------- Jadwal Notifikasi Pagi Hari -----------------
setInterval(async () => {
    const now = new Date();
    // Kirim notifikasi setiap hari pukul 06:00 WIB
    if (now.getHours() === 6 && now.getMinutes() === 0) {
        console.log('Mengecek jadwal untuk notifikasi pagi...');
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        const snapshot = await db.collection('schedules')
            .where('date', '>=', admin.firestore.Timestamp.fromDate(todayStart))
            .where('date', '<=', admin.firestore.Timestamp.fromDate(todayEnd))
            .orderBy('date', 'asc')
            .get();

        const schedules = snapshot.docs.map(doc => doc.data().content).join(', ') || 'tidak ada jadwal.';
        await sendPushNotification('Jadwal Hari Ini', `Selamat pagi! Hari ini ada: ${schedules}`);
    }
}, 60000); // Cek setiap menit

// ===================== AUTHENTIKASI =====================
const APP_SECRET_CODE = must('APP_SECRET_CODE');

// Endpoint untuk login
app.post('/api/login', (req, res) => {
  const { code } = req.body;
  if (code === APP_SECRET_CODE) {
    // Generate token sederhana (misalnya, timestamp)
    const token = new Date().getTime().toString();
    return res.status(200).json({ success: true, token });
  } else {
    return res.status(401).json({ success: false, error: 'Kode rahasia salah.' });
  }
});

// Middleware untuk verifikasi token
function authenticateToken(req, res, next) {
  const token = req.headers['authorization'];
  // Cek apakah token ada, valid, dan masih baru (misalnya dalam 24 jam)
  if (!token || (new Date().getTime() - parseInt(token) > 24 * 60 * 60 * 1000)) {
    return res.status(401).json({ error: 'Akses ditolak. Token tidak valid atau kedaluwarsa.' });
  }
  next();
}

// Gunakan middleware ini untuk endpoint yang ingin dilindungi
app.use('/api/chat', authenticateToken);
app.use('/api/schedules', authenticateToken);
app.use('/api/finances', authenticateToken);
app.use('/api/register-token', authenticateToken);

// ----------------- ROUTES: Chat utama -----------------
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('Pesan masuk:', message);
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const result = await new GoogleGenerativeAI(must('GEMINI_API_KEY'))
      .getGenerativeModel({ model: 'gemini-1.5-flash' })
      .generateContent(`${GEN_RULES}\nUser: ${message}`);
    const responseText = result.response.text();
    console.log('Respons mentah dari Gemini:', responseText);

    let data; const m = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (m && m[1]) { try { data = JSON.parse(m[1]); } catch {} }

    if (!data) {
        const fallbackPrompt = `Kamu adalah asisten pribadi. Teks berikut adalah respons dari AI yang gagal diproses. Berikan respons yang ramah, informatif, atau tanyakan kembali jika perlu. Contoh: "Saya tidak mengerti permintaan ini. Bisakah Anda mengatakannya dengan cara lain?"\n\nRespon mentah AI: ${responseText}`;
        const fallbackResult = await model.generateContent(fallbackPrompt);
        return res.json({ text: fallbackResult.response.text() });
    }

    // --- LOGIKA BARU UNTUK FREE TIME QUERY ---
    if (data.type === 'free_time_query') {
      const topic = data.topic;
      const now = new Date();
      const startOfWeek = new Date(now.setDate(now.getDate() - (now.getDay() + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      try {
        const snapshot = await db.collection('schedules')
          .where('date', '>=', admin.firestore.Timestamp.fromDate(startOfWeek))
          .where('date', '<=', admin.firestore.Timestamp.fromDate(endOfWeek))
          .orderBy('date', 'asc')
          .get();
        
        const schedules = snapshot.docs.map(doc => ({
            event: doc.data().content,
            date: doc.data().date?.toDate(),
        })).filter(s => s.date); // Filter out docs with invalid date

        if (schedules.length === 0) {
            return res.json({ text: `Wah, jadwal lo kosong banget minggu ini. Bebas deh mau ${topic} kapan aja!` });
        }

        // --- Logika untuk mencari waktu kosong ---
        const freeTimes = [];
        let lastEventEnd = new Date(startOfWeek);
        schedules.forEach(s => {
            const eventStart = s.date;
            if (eventStart > lastEventEnd) {
                freeTimes.push({
                    start: lastEventEnd,
                    end: eventStart
                });
            }
            lastEventEnd = new Date(s.date.getTime() + 60 * 60 * 1000); // Asumsi durasi 1 jam, bisa disesuaikan
        });

        const freeTimePrompt = `Ringkas waktu kosong berikut untuk ${topic}. Gunakan bahasa gaul yang santai.
        \nData Waktu Kosong:\n${JSON.stringify(freeTimes)}`;
        const freeTimeSummary = await model.generateContent(freeTimePrompt);
        const textSummary = freeTimeSummary.response.text();

        return res.json({ text: textSummary });
      } catch (e) {
          console.error('Error saat mencari waktu kosong:', e);
          return res.status(500).json({ error: 'Gagal mencari waktu kosong.' });
      }
    }

    // --- LOGIKA BARU UNTUK BUDGET QUERY ---
    else if (data.type === 'budget_query') {
        const { topic } = data;
        const now = new Date();
        let startDate;

        if (topic === 'daily') {
            startDate = new Date(now.setHours(0, 0, 0, 0));
        } else if (topic === 'weekly') {
            const dow = (now.getDay() + 6) % 7;
            startDate = new Date(now.setDate(now.getDate() - dow));
            startDate.setHours(0, 0, 0, 0);
        } else {
            return res.json({ text: 'Topik budget tidak valid. Mohon gunakan "daily" atau "weekly".' });
        }

        try {
            const snapshot = await db.collection('finances')
                .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
                .where('type', '==', 'expense')
                .get();

            const totalExpenses = snapshot.docs.reduce((sum, doc) => sum + Math.abs(doc.data().amount), 0);
            const budgetLimit = (topic === 'daily') ? DAILY_FOOD_BUDGET : WEEKLY_BUDGET;
            const remainingBudget = budgetLimit - totalExpenses;
            
            let resp;
            if (remainingBudget > 0) {
                resp = `Sisa budget ${topic} kamu ada Rp${remainingBudget.toLocaleString('id-ID')}. Aman!`;
            } else {
                resp = `Wah, budget ${topic} kamu udah minus Rp${Math.abs(remainingBudget).toLocaleString('id-ID')}. Hati-hati ya!`;
            }
            return res.json({ text: resp });
        } catch (e) {
            console.error('Error saat memeriksa budget:', e);
            return res.status(500).json({ error: 'Gagal memeriksa budget.' });
        }
    }

    // --- LOGIKA BARU UNTUK DELETE & EDIT ---
    else if (data.type === 'delete') {
      const { topic, query } = data;
      try {
        const collection = (topic === 'schedule') ? 'schedules' : 'tasks';
        const field = (topic === 'schedule') ? 'content' : 'title';
        
        const snapshot = await db.collection(collection).where(field, '==', query).get();
        if (snapshot.empty) {
          return res.json({ text: `Maaf, aku gak nemuin ${topic} dengan nama "${query}". Coba cek lagi deh.` });
        }

        const docRef = snapshot.docs[0].ref;
        await docRef.delete();
        return res.json({ text: `Oke, ${topic} "${query}" udah aku apus.` });

      } catch (e) {
        console.error('Error saat menghapus data:', e);
        return res.status(500).json({ error: 'Gagal menghapus data.' });
      }
    }

    else if (data.type === 'edit') {
      const { topic, query, new_value } = data;
      try {
        const collection = (topic === 'schedule') ? 'schedules' : 'tasks';
        const field = (topic === 'schedule') ? 'content' : 'title';
        const updateField = (topic === 'schedule') ? 'content' : 'event'; // Sesuaikan field di Firestore jika perlu

        const snapshot = await db.collection(collection).where(field, '==', query).get();
        if (snapshot.empty) {
          return res.json({ text: `Maaf, aku gak nemuin ${topic} dengan nama "${query}". Coba cek lagi deh.` });
        }

        const docRef = snapshot.docs[0].ref;
        await docRef.update({ [updateField]: new_value });
        return res.json({ text: `Oke, ${topic} "${query}" udah aku ganti jadi "${new_value}".` });

      } catch (e) {
        console.error('Error saat mengedit data:', e);
        return res.status(500).json({ error: 'Gagal mengedit data.' });
      }
    }

    // === EMAIL QUERY ===
    if (data.type === 'email_query') {
      const q = data.query || data.fallback || 'newer_than:30d';
      try {
        const gmail = getGmailClientOrThrow();
        const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 10 });
        const ids = (list.data.messages || []).map(m => m.id);
        if (ids.length === 0) return res.json({ text: `Tidak ada email yang cocok untuk query: ${q}` });

        const details = [];
        for (const id of ids) {
          const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
          const payload = msg.data.payload || {};
          const headers = payload.headers || [];
          const subject = getHeader(headers, 'Subject');
          const from = getHeader(headers, 'From');
          const date = getHeader(headers, 'Date');
          const snippet = msg.data.snippet || '';
          const bodyText = extractPlainText(payload) || snippet;
          details.push({ id, subject, from, date, snippet, body: bodyText.slice(0, 4000) });
        }

        const toSummarize = details.map((d, i) => `#${i+1} - ${d.subject}\nFrom: ${d.from}\nDate: ${d.date}\n---\n${d.body}\n`).join('\n\n');
        const sumResp = await model.generateContent(
          `Ringkas inti email berikut (maks 6 poin, Bahasa Indonesia, singkat, sebutkan pengirim jika relevan). Jika ada follow-up action, tulis poin "Tindakan".\n\n${toSummarize}`
        );
        const summary = sumResp.response.text();

        return res.json({
          text: summary,
          meta: {
            query: q,
            emails: details.map(d => ({
              subject: d.subject, from: d.from, date: d.date, snippet: d.snippet
            })),
          }
        });
      } catch (e) {
        if (e.authUrl) {
          return res.status(401).json({ error: 'Gmail belum terhubung.', auth_url: e.authUrl });
        }
        console.error('Gmail search error:', e.message);
        return res.status(500).json({ error: 'Gagal membaca Gmail. Coba re-auth di /auth/gmail.' });
      }
    }

    else if (data.type === 'summary') {
      const { topic, period } = data;
      const now = new Date();
      let startDate, endDate;
      const timeZone = 'Asia/Jakarta';

      if (period === 'daily') {
        startDate = new Date(now.toLocaleString('en-US', { timeZone }));
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now.toLocaleString('en-US', { timeZone }));
        endDate.setHours(23, 59, 59, 999);
      } else if (period === 'weekly') {
        const dow = (now.getDay() + 6) % 7;
        startDate = new Date(now.toLocaleString('en-US', { timeZone }));
        startDate.setDate(startDate.getDate() - dow);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate.getTime());
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
      } else if (period === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
      } else {
        return res.json({ text: 'Maaf, periode waktu tidak valid. Mohon gunakan harian, mingguan, atau bulanan.' });
      }

      try {
        let collection, field;
        if (topic === 'finances') {
          collection = 'finances';
          field = 'date';
        } else if (topic === 'schedules') {
          collection = 'schedules';
          field = 'date';
        } else if (topic === 'tasks') {
          collection = 'tasks';
          field = 'date';
        } else {
          return res.json({ text: 'Maaf, topik ringkasan tidak valid. Mohon gunakan keuangan, jadwal atau tasks.' });
        }

        const snapshot = await db.collection(collection)
          .where(field, '>=', admin.firestore.Timestamp.fromDate(startDate))
          .where(field, '<=', admin.firestore.Timestamp.fromDate(endDate))
          .orderBy(field, 'asc')
          .get();

        const items = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            date: doc.data().date?.toDate()?.toLocaleString('id-ID'),
            _seconds: doc.data().date?._seconds,
        }));
        
        if (items.length === 0) {
          return res.json({ text: `Tidak ada data ${topic} untuk periode ini.` });
        }

        const summaryPrompt = `Ringkas data berikut menjadi poin-poin yang mudah dibaca. Untuk jadwal, sebutkan tanggalnya. Untuk keuangan, sebutkan total income dan expense. Gunakan Bahasa Indonesia. \n\nData:\n${JSON.stringify(items, null, 2)}`;
        const sumResp = await model.generateContent(summaryPrompt);
        const summary = sumResp.response.text();

        return res.json({ text: summary, dataType: topic, data: items });
      } catch (e) {
        console.error('Error saat merangkum data:', e);
        return res.status(500).json({ error: 'Gagal merangkum data.' });
      }
    }

    else if (data.type === 'general') {
      const { query } = data;
      const generalResponse = await model.generateContent(query);
      return res.json({ text: generalResponse.response.text() });
    }

    if (data.type === 'schedule') {
      const { event, day, time_start, time_end } = data;
      if (!event || !day) return res.status(400).json({ error: 'Informasi jadwal tidak lengkap.' });
      const { startTime, endTime, recurrence, hadExplicitTime } = parseStructuredSchedule(day, time_start, time_end);

      await db.collection('schedules').add({
        content: event, date: admin.firestore.Timestamp.fromDate(startTime)
      });

      if (hadExplicitTime) {
        const startRFC = formatRFC3339Local(startTime);
        const endRFC = formatRFC3339Local(endTime);
        await calendar.events.insert({
          calendarId: CALENDAR_ID,
          resource: {
            summary: event,
            start: { dateTime: startRFC, timeZone: 'Asia/Jakarta' },
            end: { dateTime: endRFC, timeZone: 'Asia/Jakarta' },
            recurrence: recurrence ? [recurrence] : undefined,
          },
        });
      } else {
        const startDateLocal = formatLocalDateYMD(startTime);
        const endDay = new Date(startTime.getTime()); endDay.setDate(endDay.getDate() + 1);
        const endDateLocal = formatLocalDateYMD(endDay);
        await calendar.events.insert({
          calendarId: CALENDAR_ID,
          resource: {
            summary: event,
            start: { date: startDateLocal },
            end: { date: endDateLocal },
            recurrence: recurrence ? [recurrence] : undefined,
          },
        });
      }
      return res.json({ text: `Jadwal "${event}" berhasil disimpan.` });
    }

    if (data.type === 'task') {
      const { event, day, time_start } = data;
      if (!event || !day) return res.status(400).json({ error: 'Informasi tugas tidak lengkap.' });
      const { startTime, hadExplicitTime } = parseStructuredSchedule(day, time_start, null);
      let dueDate = new Date(startTime); if (!hadExplicitTime) dueDate.setHours(23,59,0,0);
      const dueRFC3339 = formatRFC3339Local(dueDate);

      let tasksClient;
      try { tasksClient = getTasksClientOrThrow(); }
      catch (e) { return res.status(401).json({ error: 'Google Tasks belum terhubung.', auth_url: e.authUrl }); }

      await tasksClient.tasks.insert({
        tasklist: '@default',
        resource: { title: event, due: dueRFC3339 },
      });

      if (hadExplicitTime) {
        const startRFC = formatRFC3339Local(startTime);
        const endRFC = formatRFC3339Local(new Date(startTime.getTime()+30*60*1000));
        await calendar.events.insert({
          calendarId: CALENDAR_ID,
          resource: {
            summary: `Deadline: ${event}`,
            start: { dateTime: startRFC, timeZone: 'Asia/Jakarta' },
            end: { dateTime: endRFC, timeZone: 'Asia/Jakarta' },
          },
        });
      } else {
        const startDateLocal = formatLocalDateYMD(startTime);
        const endDay = new Date(startTime.getTime()); endDay.setDate(endDay.getDate()+1);
        const endDateLocal = formatLocalDateYMD(endDay);
        await calendar.events.insert({
          calendarId: CALENDAR_ID,
          resource: {
            summary: `Deadline: ${event}`,
            start: { date: startDateLocal },
            end: { date: endDateLocal },
          },
        });
      }
      return res.json({ text: `Tugas "${event}" berhasil ditambahkan ke Tasks & Calendar.` });
    }

    if (data.type === 'expense') {
      const { item, amount } = data;
      if (!item || !amount) return res.status(400).json({ error: 'Informasi pengeluaran tidak lengkap.' });
      const expenseAmount = -Math.abs(amount);
      const now = new Date();
      const startOfWeek = new Date(now); const dow=(now.getDay()+6)%7; startOfWeek.setDate(now.getDate()-dow); startOfWeek.setHours(0,0,0,0);
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);

      const dailyQuery = await db.collection('finances').where('date','>=',admin.firestore.Timestamp.fromDate(todayStart)).where('type','==','expense').get();
      const weeklyQuery = await db.collection('finances').where('date','>=',admin.firestore.Timestamp.fromDate(startOfWeek)).where('type','==','expense').get();
      const dailyTotal = dailyQuery.docs.reduce((s,d)=>s+d.data().amount,0)+expenseAmount;
      const weeklyTotal = weeklyQuery.docs.reduce((s,d)=>s+d.data().amount,0)+expenseAmount;

      await db.collection('finances').add({ item, amount: expenseAmount, type:'expense', date: admin.firestore.Timestamp.fromDate(new Date()) });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID, range:'Sheet1!A:D', valueInputOption:'USER_ENTERED',
        resource:{ values:[[new Date().toLocaleString('id-ID'), item, Math.abs(amount), 'Pengeluaran']] }
      });

      let resp=`Pengeluaran "${item}" sebesar Rp${Math.abs(amount).toLocaleString('id-ID')} dicatat.`;
      if (Math.abs(dailyTotal)>DAILY_FOOD_BUDGET) {
        resp+=`\n⚠️ Melebihi limit harian Rp${DAILY_FOOD_BUDGET.toLocaleString('id-ID')}.`;
        await sendPushNotification('Peringatan Budget Harian', `Pengeluaran harianmu melebihi budget. Sisa budget hari ini: Rp${(DAILY_FOOD_BUDGET - Math.abs(dailyTotal)).toLocaleString('id-ID')}`);
      }
      if (Math.abs(weeklyTotal)>WEEKLY_BUDGET) {
        resp+=`\n⚠️ Melebihi limit mingguan Rp${WEEKLY_BUDGET.toLocaleString('id-ID')}.`;
        await sendPushNotification('Peringatan Budget Mingguan', `Pengeluaran mingguanmu melebihi budget. Sisa budget minggu ini: Rp${(WEEKLY_BUDGET - Math.abs(weeklyTotal)).toLocaleString('id-ID')}`);
      }
      return res.json({ text: resp });
    }

    if (data.type === 'income') {
      const { item, amount } = data;
      if (!item || !amount) return res.status(400).json({ error: 'Informasi pemasukan tidak lengkap.' });
      const incomeAmount = Math.abs(amount);
      await db.collection('finances').add({ item, amount: incomeAmount, type:'income', date: admin.firestore.Timestamp.fromDate(new Date()) });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID, range:'Sheet1!A:D', valueInputOption:'USER_ENTERED',
        resource:{ values:[[new Date().toLocaleString('id-ID'), item, incomeAmount, 'Pemasukan']] }
      });
      return res.json({ text: `Pemasukan "${item}" sebesar Rp${incomeAmount.toLocaleString('id-ID')} dicatat.` });
    }

    if (data.type === 'auto_schedule') {
    const activity = data.activity || data.topic || 'Quality Time';
    const duration = Number(data.duration_minutes) || 120; // default 2 jam

    // Coba akses Google Tasks (boleh gagal; tetap jalan)
    let tasksClient = null;
    try {
        tasksClient = getTasksClientOrThrow();
    } catch (e) {
        console.warn('[auto_schedule] Tasks not connected, continuing without tasks. Tip:', e.message);
    }

    try {
        const result = await autoSchedule({
        activity,
        durationMinutes: duration,
        calendar,
        CALENDAR_ID,
        db,
        admin,
        tasksClient
        });
        return res.json({ text: result.message });
    } catch (e) {
        console.error('[auto_schedule] failed:', e);
        return res.status(500).json({ error: 'Gagal melakukan auto-schedule. Coba lagi ya.' });
    }
    }


    return res.json({ text: responseText });
  } catch (error) {
    console.error('Terjadi error:', error.message);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
});

// ----------------- ROUTES: Pendaftaran Token FCM -----------------
app.post('/api/register-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send('FCM token is required.');

  try {
    await db.collection('fcmTokens').doc(token).set({ timestamp: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).send('FCM token berhasil didaftarkan.');
  } catch (error) {
    console.error('Error saat mendaftarkan token:', error);
    res.status(500).send('Gagal mendaftarkan token.');
  }
});

// ----------------- READ ROUTES -----------------
app.get('/api/schedules', async (req, res) => {
  const snapshot = await db.collection('schedules').orderBy('date', 'desc').get();
  const schedules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _seconds: doc.data().date?._seconds }));
  res.json(schedules);
});
app.get('/api/finances', async (req, res) => {
  const snapshot = await db.collection('finances').orderBy('date', 'desc').get();
  const finances = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _seconds: doc.data().date?._seconds }));
  res.json(finances);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('API listening on', PORT);
});

app.get('/healthz', (_, res) => res.send('ok'));
