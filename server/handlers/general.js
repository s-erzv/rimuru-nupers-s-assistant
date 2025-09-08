const admin = require('firebase-admin');
const { autoSchedule } = require('../autoScheduler');

module.exports = (db, model, gmailOAuth) => {
  return {
    general: async (req, res, data) => {
      const generalResponse = await model.generateContent(data.query);
      res.json({ text: generalResponse.response.text() });
    },

    delete_item: async (req, res, data) => {
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

    edit_item: async (req, res, data) => {
      const { topic, query, new_value } = data;
      try {
        const collection = (topic === 'schedule') ? 'schedules' : 'tasks';
        const field = (topic === 'schedule') ? 'content' : 'title';
        const updateField = (topic === 'schedule') ? 'content' : 'title';

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

    email_query: async (req, res, data) => {
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

    other_summary: async (req, res, data) => {
      const { topic, period } = data;
      const now = new Date();
      let startDate, endDate;
    
      if (period === 'daily') {
        startDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        endDate.setHours(23, 59, 59, 999);
      } else if (period === 'weekly') {
        const dow = (now.getDay() + 6) % 7;
        startDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
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
        if (topic === 'schedules') {
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
    },
  };
};