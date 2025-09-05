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
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors());
app.use(express.json());

// --- Helper Functions and Initializations ---

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} belum di-set`);
  return v;
}

// ===================== API INITIALIZATIONS =====================

let db, calendar, sheets, tasks, gmail;

try {
  const serviceAccount = JSON.parse(must('FIREBASE_SERVICE_ACCOUNT_JSON'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  db = admin.firestore();
  console.log('Firebase Admin SDK initialized from environment variable.');
} catch (e) {
  console.error("Firebase Admin initialization failed. Check FIREBASE_SERVICE_ACCOUNT_JSON environment variable.");
  process.exit(1);
}

const initializeGoogleApis = () => {
  try {
    const serviceAccount = JSON.parse(must('GOOGLE_CALENDAR_SHEETS_SERVICE_ACCOUNT_JSON'));
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar',
      ],
    });
    sheets = google.sheets({ version: 'v4', auth });
    calendar = google.calendar({ version: 'v3', auth });
  } catch (e) {
    console.error("Failed to parse GOOGLE_CALENDAR_SHEETS_SERVICE_ACCOUNT_JSON:", e.message);
    process.exit(1);
  }
};
initializeGoogleApis();

// --- OAuth Clients and Functions ---
const createOAuthClient = (clientIdEnv, clientSecretEnv, redirectUriEnv, tokenEnv, scopes, name) => {
  const oauth2Client = new google.auth.OAuth2(
    must(clientIdEnv),
    must(clientSecretEnv),
    must(redirectUriEnv)
  );
  if (process.env[tokenEnv]) {
    try {
      oauth2Client.setCredentials(JSON.parse(process.env[tokenEnv]));
      console.log(`[${name} OAuth] token dimuat dari environment variable.`);
    } catch (e) {
      console.error(`Failed to parse ${tokenEnv}:`, e.message);
    }
  }
  return {
    client: oauth2Client,
    getService: () => {
      const hasToken = oauth2Client.credentials.access_token || oauth2Client.credentials.refresh_token;
      if (!hasToken) {
        const url = oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
        const err = new Error(`${name} belum terhubung.`);
        err.authUrl = url;
        throw err;
      }
      return name === 'Tasks' ? google.tasks({ version: 'v1', auth: oauth2Client }) : google.gmail({ version: 'v1', auth: oauth2Client });
    },
    generateAuthUrl: () => oauth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes }),
    getToken: (code) => oauth2Client.getToken(code),
    setCredentials: (tokens) => oauth2Client.setCredentials(tokens),
  };
};

const tasksOAuth = createOAuthClient(
  'GOOGLE_OAUTH_TASKS_CLIENT_ID', 'GOOGLE_OAUTH_TASKS_CLIENT_SECRET', 'GOOGLE_OAUTH_TASKS_REDIRECT_URI',
  'GOOGLE_OAUTH_TASKS_TOKEN_JSON', ['https://www.googleapis.com/auth/tasks'], 'Tasks'
);
const gmailOAuth = createOAuthClient(
  'GOOGLE_OAUTH_GMAIL_CLIENT_ID', 'GOOGLE_OAUTH_GMAIL_CLIENT_SECRET', 'GOOGLE_OAUTH_GMAIL_REDIRECT_URI',
  'GOOGLE_OAUTH_GMAIL_TOKEN_JSON', ['https://www.googleapis.com/auth/gmail.readonly'], 'Gmail'
);

app.get('/auth/google/tasks', (req, res) => res.redirect(tasksOAuth.generateAuthUrl()));
app.get('/oauth2callback/tasks', async (req, res) => {
  try {
    const { tokens } = await tasksOAuth.getToken(req.query.code);
    tasksOAuth.setCredentials(tokens);
    res.send(`Google Tasks terhubung! Salin token ini:<br/><br/><pre>${JSON.stringify(tokens, null, 2)}</pre><br/><br/>Kamu bisa tutup tab ini.`);
  } catch (e) {
    console.error('OAuth Tasks error:', e.message);
    res.status(500).send('Gagal OAuth Tasks.');
  }
});

app.get('/auth/google/gmail', (req, res) => res.redirect(gmailOAuth.generateAuthUrl()));
app.get('/oauth2callback/gmail', async (req, res) => {
  try {
    const { tokens } = await gmailOAuth.getToken(req.query.code);
    gmailOAuth.setCredentials(tokens);
    res.send(`Gmail terhubung! Salin token ini:<br/><br/><pre>${JSON.stringify(tokens, null, 2)}</pre><br/><br/>Kamu bisa tutup tab ini.`);
  } catch (e) {
    console.error('OAuth Gmail error:', e.message);
    res.status(500).send('Gagal OAuth Gmail.');
  }
});

// ----------------- APP CONFIG -----------------
const CALENDAR_ID = 'sarahfajriarahmah@gmail.com';
const SPREADSHEET_ID = '144JyNngIWCm97EAgUEmNphCExkxSaxd6KDSsIVPytIY';
const WEEKLY_BUDGET = 500000;
const DAILY_FOOD_BUDGET = 50000;
const GEN_RULES = require('./gemini_rules');

const genAI = new GoogleGenerativeAI(must('GEMINI_API_KEY'));
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// --- Time Helpers ---
const timeZone = 'Asia/Jakarta';
const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

function formatDateYMD(date) {
  const dtf = new Intl.DateTimeFormat('sv-SE', { timeZone, ...dateOptions });
  const [{ value: y }, , { value: m }, , { value: d }] = dtf.formatToParts(date);
  return `${y}-${m}-${d}`;
}
function formatTimeHM(date) {
  const dtf = new Intl.DateTimeFormat('en-GB', { timeZone, ...timeOptions });
  const [{ value: h }, , { value: m }] = dtf.formatToParts(date);
  return `${h}:${m}`;
}
function formatRFC3339Local(date) {
  return `${formatDateYMD(date)}T${formatTimeHM(date)}:00+07:00`;
}

// ----------------- Refactored Time Parser -----------------
function parseStructuredSchedule(day, timeStartStr, timeEndStr) {
  const now = new Date();
  let targetDate = new Date();
  let recurrence = null;
  const dayLower = (day || '').toLowerCase();
  
  const dayMap = { 'minggu': 0, 'senin': 1, 'selasa': 2, 'rabu': 3, 'kamis': 4, 'jumat': 5, 'sabtu': 6, 'today': 'hari ini', 'tomorrow': 'besok' };
  const dayNameMap = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const monthMap = { 'januari': 0, 'februari': 1, 'maret': 2, 'april': 3, 'mei': 4, 'juni': 5, 'juli': 6, 'agustus': 7, 'september': 8, 'oktober': 9, 'november': 10, 'desember': 11 };

  if (dayMap[dayLower] === 'hari ini' || dayLower === 'hari ini') {
    targetDate = new Date();
  } else if (dayMap[dayLower] === 'besok' || dayLower === 'besok') {
    targetDate.setDate(now.getDate() + 1);
  } else if (dayLower === 'lusa') {
    targetDate.setDate(now.getDate() + 2);
  } else if (dayMap[dayLower] !== undefined) {
    const diff = (dayMap[dayLower] - now.getDay() + 7) % 7;
    targetDate.setDate(now.getDate() + diff);
    recurrence = `RRULE:FREQ=WEEKLY;BYDAY=${dayNameMap[dayMap[dayLower]]}`;
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
  
  const dateString = `${targetDate.getFullYear()}-${(targetDate.getMonth() + 1).toString().padStart(2, '0')}-${targetDate.getDate().toString().padStart(2, '0')}`;
  const startTime = new Date(`${dateString}T${sh.toString().padStart(2, '0')}:${(sm || 0).toString().padStart(2, '0')}:00+07:00`);
  const endTime = new Date(`${dateString}T${eh.toString().padStart(2, '0')}:${(em || 0).toString().padStart(2, '0')}:00+07:00`);
  
  return { startTime, endTime, recurrence, hadExplicitTime };
}

// --- Helper for FCM ---
async function sendPushNotification(title, body) {
  try {
    const snapshot = await db.collection('fcmTokens').get();
    const tokens = snapshot.docs.map(doc => doc.id);
    if (tokens.length === 0) {
      console.warn('Tidak ada token FCM yang terdaftar.');
      return;
    }
    const message = { notification: { title, body }, tokens };
    const response = await admin.messaging().sendMulticast(message);
    console.log('Notifikasi terkirim:', response.successCount);
  } catch (error) {
    console.error('Error saat mengirim notifikasi:', error);
  }
}

// --- Scheduled Tasks ---
setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 6 && now.getMinutes() === 0) {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const snapshot = await db.collection('schedules')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(todayStart))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(todayEnd))
      .orderBy('date', 'asc')
      .get();
    const schedules = snapshot.docs.map(doc => doc.data().content).join(', ') || 'tidak ada jadwal.';
    await sendPushNotification('Jadwal Hari Ini', `Selamat pagi! Hari ini ada: ${schedules}`);
  }
}, 60000);

// --- Task Deadline Checker ---
setInterval(async () => {
  const now = admin.firestore.Timestamp.now();
  const twelveHoursFromNow = admin.firestore.Timestamp.fromMillis(now.toMillis() + 12 * 60 * 60 * 1000);
  try {
    const tasksSnapshot = await db.collection('tasks')
      .where('date', '<=', twelveHoursFromNow)
      .where('date', '>', now)
      .get();
    for (const doc of tasksSnapshot.docs) {
      const task = doc.data();
      if (!task.notified) {
        const body = `Tugas "**${task.content}**" akan jatuh tempo dalam waktu 12 jam ke depan!`;
        await sendPushNotification('Peringatan Deadline', body);
        await db.collection('tasks').doc(doc.id).update({ notified: true });
      }
    }
  } catch (e) {
    console.error('Error saat mengecek deadline tugas:', e);
  }
}, 3600000); // Check every hour

// ----------------- AUTHENTICATION -----------------
const APP_SECRET_CODE = must('APP_SECRET_CODE');
function isValidCode(code) {
  return typeof code === 'string' && code === APP_SECRET_CODE;
}
function issueToken() {
  return Date.now().toString();
}
function loginResponse(res, code) {
  if (!isValidCode(code)) {
    return res.status(401).json({ success: false, message: 'Kode rahasia salah.' });
  }
  return res.json({ success: true, token: issueToken() });
}
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || (new Date().getTime() - parseInt(token, 10) > 24 * 60 * 60 * 1000)) {
    return res.status(401).json({ error: 'Akses ditolak. Token tidak valid atau kedaluwarsa.' });
  }
  next();
}

app.post('/api/login', (req, res) => loginResponse(res, req.body.code));
app.get('/api/login', (req, res) => {
  const code = req.query.code || req.headers['x-code'];
  if (!code) {
    return res.status(400).json({ success: false, message: 'Tambahkan ?code=<APP_SECRET_CODE> atau header x-code.' });
  }
  return loginResponse(res, code);
});

// Apply auth middleware to protected routes
app.use('/api/chat', authenticateToken);
app.use('/api/schedules', authenticateToken);
app.use('/api/finances', authenticateToken);
app.use('/api/register-token', authenticateToken);

// ----------------- ROUTES -----------------
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const result = await model.generateContent(`${GEN_RULES}\nUser: ${message}`);
    const responseText = result.response.text();
    let data;
    const m = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (m && m[1]) {
      try {
        data = JSON.parse(m[1]);
      } catch (e) {
        console.error('JSON parsing failed:', e);
      }
    }

    if (!data || !data.type) {
      const fallbackPrompt = `Kamu adalah asisten pribadi. Teks berikut adalah respons dari AI yang gagal diproses. Berikan respons yang ramah, informatif, atau tanyakan kembali jika perlu. Contoh: "Saya tidak mengerti permintaan ini. Bisakah Anda mengatakannya dengan cara lain?"\n\nRespon mentah AI: ${responseText}`;
      const fallbackResult = await model.generateContent(fallbackPrompt);
      return res.json({ text: fallbackResult.response.text() });
    }

    // --- Dynamic Handler based on data.type ---
    const handler = routeHandlers[data.type];
    if (handler) {
      await handler(req, res, data);
    } else {
      return res.json({ text: 'Maaf, saya tidak mengenali jenis permintaan ini.' });
    }

  } catch (error) {
    console.error('Terjadi error:', error.message);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
});

// --- Handlers for each action type ---
const routeHandlers = {
  'general': async (req, res, data) => {
    const generalResponse = await model.generateContent(data.query);
    res.json({ text: generalResponse.response.text() });
  },

  'schedule': async (req, res, data) => {
    const { event, day, time_start, time_end } = data;
    if (!event || !day) return res.status(400).json({ error: 'Informasi jadwal tidak lengkap.' });
    const { startTime, endTime, recurrence, hadExplicitTime } = parseStructuredSchedule(day, time_start, time_end);

    await db.collection('schedules').add({
      content: event, date: admin.firestore.Timestamp.fromDate(startTime)
    });

    const calendarEvent = {
      summary: event,
      start: hadExplicitTime
        ? { dateTime: formatRFC3339Local(startTime), timeZone: timeZone }
        : { date: formatDateYMD(startTime) },
      end: hadExplicitTime
        ? { dateTime: formatRFC3339Local(endTime), timeZone: timeZone }
        : { date: formatDateYMD(new Date(startTime.getTime() + 24 * 60 * 60 * 1000)) },
      recurrence: recurrence ? [recurrence] : undefined,
    };
    await calendar.events.insert({ calendarId: CALENDAR_ID, resource: calendarEvent });
    res.json({ text: `Oke noted! Jadwal "**${event}**" udah aku tambahin.` });
  },

  'task': async (req, res, data) => {
    const { event, day, time_start } = data;
    if (!event || !day) return res.status(400).json({ error: 'Informasi tugas tidak lengkap.' });
    const { startTime, hadExplicitTime } = parseStructuredSchedule(day, time_start, null);
    
    let tasksClient;
    try {
      tasksClient = tasksOAuth.getService();
    } catch (e) {
      return res.status(401).json({ error: 'Google Tasks belum terhubung.', auth_url: e.authUrl });
    }

    const dueDate = new Date(startTime);
    if (!hadExplicitTime) dueDate.setHours(23, 59, 0, 0);

    await tasksClient.tasks.insert({
      tasklist: '@default',
      resource: { title: event, due: formatRFC3339Local(dueDate) },
    });

    // Add to Calendar
    const calendarEvent = {
      summary: `Deadline: ${event}`,
      start: hadExplicitTime
        ? { dateTime: formatRFC3339Local(startTime), timeZone: timeZone }
        : { date: formatDateYMD(startTime) },
      end: hadExplicitTime
        ? { dateTime: formatRFC3339Local(new Date(startTime.getTime() + 30 * 60 * 1000)), timeZone: timeZone }
        : { date: formatDateYMD(new Date(startTime.getTime() + 24 * 60 * 60 * 1000)) },
    };
    await calendar.events.insert({ calendarId: CALENDAR_ID, resource: calendarEvent });

    res.json({ text: `Sip! Tugas "**${event}**" udah aku tambahin ke to-do list, jangan lupa dikerjain.` });
  },

  'expense': async (req, res, data) => {
    const { item, amount } = data;
    if (!item || !amount) return res.status(400).json({ error: 'Informasi pengeluaran tidak lengkap.' });
    const expenseAmount = -Math.abs(amount);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.setDate(now.getDate() - (now.getDay() + 6) % 7));

    await db.collection('finances').add({ item, amount: expenseAmount, type: 'expense', date: admin.firestore.Timestamp.fromDate(new Date()) });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'Sheet1!A:D', valueInputOption: 'USER_ENTERED',
      resource: { values: [[new Date().toLocaleString('id-ID'), item, Math.abs(amount), 'Pengeluaran']] }
    });

    const dailyQuery = await db.collection('finances').where('date', '>=', admin.firestore.Timestamp.fromDate(todayStart)).where('type', '==', 'expense').get();
    const weeklyQuery = await db.collection('finances').where('date', '>=', admin.firestore.Timestamp.fromDate(startOfWeek)).where('type', '==', 'expense').get();
    const dailyTotal = dailyQuery.docs.reduce((s, d) => s + d.data().amount, 0) + expenseAmount;
    const weeklyTotal = weeklyQuery.docs.reduce((s, d) => s + d.data().amount, 0) + expenseAmount;

    let resp = `Pengeluaran "${item}" sebesar Rp${Math.abs(amount).toLocaleString('id-ID')} dicatat.`;
    if (Math.abs(dailyTotal) > DAILY_FOOD_BUDGET) {
      resp += `\nPPPPPP WOIIII lu udah melebihi limit harian Rp${DAILY_FOOD_BUDGET.toLocaleString('id-ID')}.`;
      await sendPushNotification('Peringatan Budget Harian', `Pengeluaran harianmu melebihi budget. Sisa budget hari ini: Rp${(DAILY_FOOD_BUDGET - Math.abs(dailyTotal)).toLocaleString('id-ID')}`);
    }
    if (Math.abs(weeklyTotal) > WEEKLY_BUDGET) {
      resp += `\nWOIIIIII lu udah melebihi limit mingguan Rp${WEEKLY_BUDGET.toLocaleString('id-ID')}.`;
      await sendPushNotification('Peringatan Budget Mingguan', `Pengeluaran mingguanmu melebihi budget. Sisa budget minggu ini: Rp${(WEEKLY_BUDGET - Math.abs(weeklyTotal)).toLocaleString('id-ID')}`);
    }
    res.json({ text: resp });
  },

  'income': async (req, res, data) => {
    const { item, amount } = data;
    if (!item || !amount) return res.status(400).json({ error: 'Informasi pemasukan tidak lengkap.' });
    const incomeAmount = Math.abs(amount);
    await db.collection('finances').add({ item, amount: incomeAmount, type: 'income', date: admin.firestore.Timestamp.fromDate(new Date()) });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: 'Sheet1!A:D', valueInputOption: 'USER_ENTERED',
      resource: { values: [[new Date().toLocaleString('id-ID'), item, incomeAmount, 'Pemasukan']] }
    });
    res.json({ text: `Cihuyy! Pemasukan dari **${item}** sebesar Rp${incomeAmount.toLocaleString('id-ID')} udah masuk.` });
  },

  'auto_schedule': async (req, res, data) => {
    const activity = data.activity || data.topic || 'Quality Time';
    const duration = Number(data.duration_minutes) || 120;
    let tasksClient = null;
    try {
      tasksClient = tasksOAuth.getService();
    } catch (e) {
      console.warn('[auto_schedule] Tasks not connected, continuing without tasks. Tip:', e.message);
    }
    try {
      const result = await autoSchedule({ activity, durationMinutes: duration, calendar, CALENDAR_ID, db, admin, tasksClient });
      res.json({ text: result.message });
    } catch (e) {
      console.error('[auto_schedule] failed:', e);
      res.status(500).json({ error: 'Gagal melakukan auto-schedule. Coba lagi ya.' });
    }
  },

  'habit_track': async (req, res, data) => {
    const { habit, status } = data;
    if (!habit || !status) return res.status(400).json({ error: 'Informasi kebiasaan tidak lengkap.' });
    await db.collection('habits').add({ habit, status, date: admin.firestore.Timestamp.now() });
    const text = status === 'done' ? `Hebat! Kebiasaan **${habit}** hari ini udah dicatat. Pertahankan ya!` : `Oke, aku catat status **${habit}** kamu.`;
    res.json({ text });
  },

  'habit_query': async (req, res, data) => {
    const { habit, period } = data;
    let startDate = new Date();
    if (period === 'weekly') {
      const dow = startDate.getDay();
      startDate.setDate(startDate.getDate() - dow);
    }
    startDate.setHours(0, 0, 0, 0);

    const snapshot = await db.collection('habits').where('habit', '==', habit).where('date', '>=', admin.firestore.Timestamp.fromDate(startDate)).get();
    const count = snapshot.docs.length;
    res.json({ text: `Minggu ini kamu udah **${habit}** sebanyak **${count}** kali. Terus semangat!` });
  },

  'set_goal': async (req, res, data) => {
    const { topic, goal_name, amount, period, frequency } = data;
    await db.collection('goals').add({ topic, goal_name, amount: amount || null, period: period || null, frequency: frequency || null, createdAt: admin.firestore.Timestamp.now() });
    res.json({ text: `Oke, target **${goal_name}** udah aku simpan. Aku akan ingetin kamu biar on track.` });
  },

  'goal_progress': async (req, res, data) => {
    const { topic, goal_name, period } = data;
    const now = new Date();
    let startDate, endDate;
    if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else {
      return res.json({ text: 'Maaf, periode waktu tidak valid. Saat ini hanya mendukung "monthly".' });
    }

    const goalSnapshot = await db.collection('goals').where('goal_name', '==', goal_name).limit(1).get();
    if (goalSnapshot.empty) return res.json({ text: 'Maaf, aku ga nemuin target dengan nama itu.' });
    const goalData = goalSnapshot.docs[0].data();

    const progressSnapshot = await db.collection(topic === 'finances' ? 'finances' : 'habits')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .get();

    if (topic === 'finances') {
      const progress = progressSnapshot.docs.reduce((sum, doc) => sum + doc.data().amount, 0);
      const remaining = goalData.amount - progress;
      res.json({ text: `Sampai sekarang kamu sudah nabung Rp${progress.toLocaleString('id-ID')} dari target Rp${goalData.amount.toLocaleString('id-ID')}. Sisa Rp${remaining.toLocaleString('id-ID')} lagi, semangat!` });
    } else {
      const progress = progressSnapshot.docs.length;
      res.json({ text: `Kamu sudah memenuhi target **${goal_name}** sebanyak **${progress}** kali bulan ini!` });
    }
  },

  'email_query': async (req, res, data) => {
    const q = data.query || data.fallback || 'newer_than:30d';
    try {
      const gmail = gmailOAuth.getService();
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 10 });
      const ids = (list.data.messages || []).map(m => m.id);
      if (ids.length === 0) return res.json({ text: `Tidak ada email yang cocok untuk query: ${q}` });

      const details = [];
      const getHeader = (headers, name) => headers.find(h => h.name === name)?.value || '';
      const extractPlainText = (payload) => {
        if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
        if (payload.parts) {
          const part = payload.parts.find(p => p.mimeType === 'text/plain');
          if (part?.body?.data) return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        return '';
      };

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

      const toSummarize = details.map((d, i) => `#${i + 1} - ${d.subject}\nFrom: ${d.from}\nDate: ${d.date}\n---\n${d.body}\n`).join('\n\n');
      const sumResp = await model.generateContent(`Ringkas inti email berikut (maks 6 poin, Bahasa Indonesia, singkat, sebutkan pengirim jika relevan). Jika ada follow-up action, tulis poin "Tindakan".\n\n${toSummarize}`);
      const summary = sumResp.response.text();
      res.json({ text: summary, meta: { query: q, emails: details.map(d => ({ subject: d.subject, from: d.from, date: d.date, snippet: d.snippet })) } });
    } catch (e) {
      if (e.authUrl) return res.status(401).json({ error: 'Gmail belum terhubung.', auth_url: e.authUrl });
      console.error('Gmail search error:', e.message);
      res.status(500).json({ error: 'Gagal membaca Gmail. Coba re-auth di /auth/google/gmail.' });
    }
  },
  
  'schedule_query': async (req, res, data) => {
    const { period, date } = data;
    const now = new Date();
    let startDate, endDate;
    const timeZone = 'Asia/Jakarta';
  
    // Determine date range
    if (period === 'today') {
      startDate = new Date(now.toLocaleString('en-US', { timeZone }));
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now.toLocaleString('en-US', { timeZone }));
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'tomorrow') {
      startDate = new Date(now.toLocaleString('en-US', { timeZone }));
      startDate.setDate(now.getDate() + 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'day_after_tomorrow') {
      startDate = new Date(now.toLocaleString('en-US', { timeZone }));
      startDate.setDate(now.getDate() + 2);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'this_week') {
      const dow = (now.getDay() + 6) % 7;
      startDate = new Date(now.toLocaleString('en-US', { timeZone }));
      startDate.setDate(now.getDate() - dow);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'next_week') {
      const dow = (now.getDay() + 6) % 7;
      startDate = new Date(now.toLocaleString('en-US', { timeZone }));
      startDate.setDate(now.getDate() + 7 - dow);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'daily' && date) {
      const dayMatch = date.match(/(\d{1,2})\s(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)/i);
      if (dayMatch) {
        const [, day, monthName] = dayMatch;
        const monthMap = { 'januari': 0, 'februari': 1, 'maret': 2, 'april': 3, 'mei': 4, 'juni': 5, 'juli': 6, 'agustus': 7, 'september': 8, 'oktober': 9, 'november': 10, 'desember': 11 };
        const month = monthMap[monthName.toLowerCase()];
        startDate = new Date(now.getFullYear(), month, day);
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
      } else {
        return res.json({ text: `Maaf, format tanggal "${date}" tidak valid. Coba seperti "tanggal 15" atau "tanggal 15 desember".` });
      }
    } else {
      return res.json({ text: 'Maaf, periode waktu tidak valid. Mohon gunakan harian, mingguan, atau bulanan.' });
    }
  
    try {
      const snapshot = await db.collection('schedules')
        .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
        .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
        .orderBy('date', 'asc')
        .get();
  
      const items = snapshot.docs.map(doc => ({
        event: doc.data().content,
        date: doc.data().date?.toDate()?.toLocaleString('id-ID'),
      }));
  
      if (items.length === 0) {
        const dayName = period === 'today' ? 'hari ini' : period === 'tomorrow' ? 'besok' : 'periode ini';
        return res.json({ text: `Wah, jadwal ${dayName} kamu kosong nih. Nonton anime dulu yuk.` });
      }
  
      const summaryPrompt = `Ringkas jadwal berikut menjadi poin-poin yang mudah dibaca. Sebutkan hari dan tanggalnya. Gunakan Bahasa Indonesia gaul yang santai. \n\nData Jadwal:\n${JSON.stringify(items, null, 2)}`;
      const sumResp = await model.generateContent(summaryPrompt);
      const summary = sumResp.response.text();
  
      res.json({ text: summary, dataType: 'schedules', data: items });
    } catch (e) {
      console.error('Error saat merangkum jadwal:', e);
      res.status(500).json({ error: 'Gagal merangkum jadwal.' });
    }
  },

  'free_time_query': async (req, res, data) => {
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
      })).filter(s => s.date);

      if (schedules.length === 0) {
          return res.json({ text: `Wah, jadwal lo kosong banget minggu ini. Bebas deh mau ${topic} kapan aja!` });
      }

      const freeTimes = [];
      let lastEventEnd = new Date(startOfWeek);
      schedules.forEach(s => {
          const eventStart = s.date;
          if (eventStart > lastEventEnd) {
              freeTimes.push({ start: lastEventEnd, end: eventStart });
          }
          lastEventEnd = new Date(s.date.getTime() + 60 * 60 * 1000); // Assumed 1-hour duration
      });

      const freeTimePrompt = `Ringkas waktu kosong berikut untuk ${topic}. Gunakan bahasa gaul yang santai.\nData Waktu Kosong:\n${JSON.stringify(freeTimes)}`;
      const freeTimeSummary = await model.generateContent(freeTimePrompt);
      res.json({ text: freeTimeSummary.response.text() });
    } catch (e) {
        console.error('Error saat mencari waktu kosong:', e);
        res.status(500).json({ error: 'Gagal mencari waktu kosong.' });
    }
  },
  
  'budget_query': async (req, res, data) => {
    const { topic } = data;
    const now = new Date();
    let startDate;

    if (topic === 'daily') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (topic === 'weekly') {
        const dow = (now.getDay() + 6) % 7;
        startDate = new Date(now.setDate(now.getDate() - dow));
    } else {
        return res.json({ text: 'Topik budget tidak valid. Mohon gunakan "daily" atau "weekly".' });
    }
    startDate.setHours(0, 0, 0, 0);

    try {
        const snapshot = await db.collection('finances')
            .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
            .where('type', '==', 'expense')
            .get();

        const totalExpenses = snapshot.docs.reduce((sum, doc) => sum + Math.abs(doc.data().amount), 0);
        const budgetLimit = (topic === 'daily') ? DAILY_FOOD_BUDGET : WEEKLY_BUDGET;
        const remainingBudget = budgetLimit - totalExpenses;
        
        const periodText = topic === 'daily' ? 'harian' : 'mingguan';
        const responseText = `Total pengeluaran ${periodText} kamu: Rp${totalExpenses.toLocaleString('id-ID')}. Sisa budget: Rp${remainingBudget.toLocaleString('id-ID')}.`;

        res.json({ text: responseText });
    } catch (e) {
        console.error('Error saat memeriksa budget:', e);
        res.status(500).json({ error: 'Gagal memeriksa budget.' });
    }
  },

  'delete': async (req, res, data) => {
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
      res.json({ text: `Okeng, ${topic} **"${query}"** udah aku hapus dari daftar.` });

    } catch (e) {
      console.error('Error saat menghapus data:', e);
      res.status(500).json({ error: 'Gagal menghapus data.' });
    }
  },

  'edit': async (req, res, data) => {
    const { topic, query, new_value } = data;
    try {
      const collection = (topic === 'schedule') ? 'schedules' : 'tasks';
      const field = (topic === 'schedule') ? 'content' : 'title';
      const updateField = (topic === 'schedule') ? 'content' : 'title'; // Fix: consistent field name

      const snapshot = await db.collection(collection).where(field, '==', query).get();
      if (snapshot.empty) {
        return res.json({ text: `Maaf, aku gak nemuin ${topic} dengan nama "${query}". Coba cek lagi deh.` });
      }

      const docRef = snapshot.docs[0].ref;
      await docRef.update({ [updateField]: new_value });
      res.json({ text: `Oke, ${topic} "${query}" udah aku ganti jadi "${new_value}".` });

    } catch (e) {
      console.error('Error saat mengedit data:', e);
      res.status(500).json({ error: 'Gagal mengedit data.' });
    }
  },

  'summary': async (req, res, data) => {
    const { topic, period } = data;
    const now = new Date();
    let startDate, endDate;
  
    // Determine date range for summary
    if (period === 'daily') {
      startDate = new Date(now.toLocaleString('en-US', { timeZone }));
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now.toLocaleString('en-US', { timeZone }));
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'weekly') {
      const dow = (now.getDay() + 6) % 7;
      startDate = new Date(now.toLocaleString('en-US', { timeZone }));
      startDate.setDate(now.getDate() - dow);
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
      }));
      
      if (items.length === 0) {
        return res.json({ text: `Tidak ada data ${topic} untuk periode ini.` });
      }
  
      const summaryPrompt = `Ringkas data berikut menjadi poin-poin yang mudah dibaca. Untuk jadwal, sebutkan tanggalnya. Untuk keuangan, sebutkan total income dan expense. Gunakan Bahasa Indonesia. \n\nData:\n${JSON.stringify(items, null, 2)}`;
      const sumResp = await model.generateContent(summaryPrompt);
      const summary = sumResp.response.text();
  
      res.json({ text: summary, dataType: topic, data: items });
    } catch (e) {
      console.error('Error saat merangkum data:', e);
      res.status(500).json({ error: 'Gagal merangkum data.' });
    }
  }
};


// ----------------- OTHER ROUTES -----------------
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

app.get('/api/tasks', async (req, res) => {
  const snapshot = await db.collection('tasks').orderBy('date', 'desc').get();
  const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _seconds: doc.data().date?._seconds }));
  res.json(tasks);
});

app.listen(port, () => {
  console.log(`Server is running ea`);
  //checkTaskDeadlinesAndNotify(); 
});