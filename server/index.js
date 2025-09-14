const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const path = require('path');
const { autoSchedule } = require('./autoScheduler');
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

// --- Helper for FCM ---
// Fungsi ini dipindahkan ke atas agar bisa diakses oleh handlers di bawah.
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

// ===================== API INITIALIZATIONS =====================
let db, calendar, sheets, tasks, gmail;

try {
  const serviceAccount = JSON.parse(must('FIREBASE_SERVICE_ACCOUNT_JSON'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Menambahkan projectId untuk inisialisasi Firebase Messaging
    projectId: serviceAccount.project_id,
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

// --- Import Handlers ---
// Semua fungsi handler sekarang diimpor dari file-file terpisah
// Variabel admin sekarang juga dikirimkan
const { schedule, task, schedule_query, auto_schedule, free_time_query } = require('./handlers/schedules')(db, calendar, CALENDAR_ID, tasksOAuth, sendPushNotification, admin);
const { expense, income, budget_query, finance_summary } = require('./handlers/finances')(db, sheets, SPREADSHEET_ID, DAILY_FOOD_BUDGET, WEEKLY_BUDGET, sendPushNotification, admin);
const { habit_track, habit_query, set_goal, goal_progress } = require('./handlers/habits')(db, admin);
const { general, delete_item, edit_item, email_query, other_summary } = require('./handlers/general')(db, model, gmailOAuth, admin);

// Daftarkan semua handler dalam satu objek
const routeHandlers = {
  'general': general,
  'schedule': schedule,
  'task': task,
  'expense': expense,
  'income': income,
  'auto_schedule': auto_schedule,
  'habit_track': habit_track,
  'habit_query': habit_query,
  'set_goal': set_goal,
  'goal_progress': goal_progress,
  'email_query': email_query,
  'schedule_query': schedule_query,
  'free_time_query': free_time_query,
  'budget_query': budget_query,
  'delete': delete_item,
  'edit': edit_item,
  'summary': async (req, res, data) => {
    if (data.topic === 'finances') return finance_summary(req, res, data);
    return other_summary(req, res, data);
  }
};

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
});