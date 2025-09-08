const { parseStructuredSchedule, formatRFC3339Local, formatDateYMD } = require('../utils/dateUtils');
const { autoSchedule } = require('../autoScheduler');

module.exports = (db, calendar, CALENDAR_ID, tasksOAuth, sendPushNotification) => {
  const timeZone = 'Asia/Jakarta';
  
  return {
    schedule: async (req, res, data) => {
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
      res.json({ text: `Okeng, noted! Jadwal "**${event}**" udah aku tambahin nih.` });
    },

    task: async (req, res, data) => {
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

    schedule_query: async (req, res, data) => {
      const { period, date } = data;
      const now = new Date();
      let startDate, endDate;
    
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
          date: doc.data().date?.toDate()?.toISOString(), 
        }));
    
        if (items.length === 0) {
          const dayName = period === 'today' ? 'hari ini' : period === 'tomorrow' ? 'besok' : 'periode ini';
          return res.json({ text: `Wah, jadwal ${dayName} kamu kosong nih. Waktunya santai-santai!` });
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

    auto_schedule: async (req, res, data) => {
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

    free_time_query: async (req, res, data) => {
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
  };
};