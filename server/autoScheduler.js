// autoScheduler.js
// Schedules an activity automatically within the next 7 days by scanning Calendar events,
// Firestore schedules, and Google Tasks deadlines, then picking the best free slot.
// Timezone: Asia/Jakarta.

const { google } = require('googleapis');

const JAKARTA_TZ = 'Asia/Jakarta';
const DAY_START_H = 9;   // 09:00 local
const DAY_END_H   = 22;  // 22:00 local

/** Convert Date to RFC3339 with local timezone offset */
function toRFC3339Local(d) {
  const pad = (n)=>String(n).padStart(2,'0');
  const yyyy=d.getFullYear(), mm=pad(d.getMonth()+1), dd=pad(d.getDate());
  const hh=pad(d.getHours()), mi=pad(d.getMinutes()), ss=pad(d.getSeconds());
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off)/60));
  const om = pad(Math.abs(off)%60);
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${oh}:${om}`;
}

function startOfDay(d){ const x=new Date(d); x.setHours(DAY_START_H,0,0,0); return x; }
function endOfDay(d){ const x=new Date(d); x.setHours(DAY_END_H,0,0,0); return x; }

/** Merge overlapping busy intervals */
function mergeIntervals(intervals){
  if(!intervals.length) return [];
  intervals.sort((a,b)=>a.start-b.start || a.end-b.end);
  const out=[intervals[0]];
  for(let i=1;i<intervals.length;i++){
    const cur=intervals[i]; const last=out[out.length-1];
    if(cur.start<=last.end){ last.end=new Date(Math.max(+last.end, +cur.end)); }
    else out.push({start:new Date(cur.start), end:new Date(cur.end), source:cur.source});
  }
  return out;
}

/** Subtract busy intervals from a day's window to get free slots */
function dayFreeSlots(dayDate, busy) {
  const dayStart = startOfDay(dayDate);
  const dayEnd = endOfDay(dayDate);
  const relevant = busy.filter(iv => iv.end > dayStart && iv.start < dayEnd)
                       .map(iv => ({ start: new Date(Math.max(+iv.start, +dayStart)), end: new Date(Math.min(+iv.end, +dayEnd)) }))
                       .sort((a,b)=>a.start-b.start);
  const free = [];
  let cursor = dayStart;
  for(const iv of relevant){
    if(iv.start > cursor) free.push({ start: new Date(cursor), end: new Date(iv.start) });
    if(iv.end > cursor) cursor = new Date(iv.end);
  }
  if(cursor < dayEnd) free.push({ start: new Date(cursor), end: new Date(dayEnd) });
  return free;
}

function isWeekend(d){ const wd=d.getDay(); return wd===0 || wd===6; } // Sun=0
function scoreSlot(slotStart, durationMin, deadlinesCount) {
  // Heuristics: prefer weekend, then weekday evenings, avoid late night
  const end = new Date(slotStart.getTime()+durationMin*60000);
  let score = 0;
  if(isWeekend(slotStart)) score += 3;
  const hour = slotStart.getHours();
  if(hour >= 18 && hour <= 21) score += 2;
  if(hour >= 13 && hour < 18) score += 1;
  if(hour < 10) score -= 1;
  if(hour >= 21) score -= 1;
  // Fewer deadlines that day = better
  score += Math.max(0, 3 - deadlinesCount);
  // Closer to now gets slight boost
  const soonness = Math.max(0, 6 - Math.floor((slotStart - new Date())/86400000));
  score += soonness*0.1;
  // Longer headroom in the day = small bonus
  score += Math.min(120, ( (endOfDay(slotStart) - slotStart) / 60000 - durationMin )) * 0.005;
  return score;
}

/**
 * Build busy intervals from:
 *  - Google Calendar events (event.start.dateTime OR all-day)
 *  - Firestore 'schedules' (assume 60m duration if end unknown)
 *  - Google Tasks deadlines (1h busy block ending at 'due', or all-day if only date)
 */
async function collectBusyIntervals({ calendar, CALENDAR_ID, db, admin, tasksClient, windowStart, windowEnd }) {
  const busy = [];

  // Google Calendar
  try{
    const resp = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: toRFC3339Local(windowStart),
      timeMax: toRFC3339Local(windowEnd),
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = resp.data.items || [];
    for(const ev of events){
      const s = ev.start?.dateTime ? new Date(ev.start.dateTime) : (ev.start?.date ? new Date(ev.start.date+'T00:00:00') : null);
      const e = ev.end?.dateTime ? new Date(ev.end.dateTime) : (ev.end?.date ? new Date(ev.end.date+'T23:59:59') : null);
      if(s && e) busy.push({ start:s, end:e, source:`calendar:${ev.summary||''}` });
    }
  }catch(e){
    console.warn('[autoScheduler] calendar.list failed, skip:', e.message);
  }

  // Firestore schedules
  try{
    const snap = await db.collection('schedules')
      .where('date','>=', admin.firestore.Timestamp.fromDate(windowStart))
      .where('date','<=', admin.firestore.Timestamp.fromDate(windowEnd))
      .get();
    for(const doc of snap.docs){
      const d = doc.data();
      const dt = d.date?.toDate?.() || null;
      if(!dt) continue;
      const end = d.endDate?.toDate?.() || new Date(dt.getTime()+60*60000); // fallback 1h
      busy.push({ start: dt, end, source: `fs:schedule:${d.content||''}` });
    }
  }catch(e){
    console.warn('[autoScheduler] firestore schedules failed, skip:', e.message);
  }

  // Google Tasks deadlines
  if(tasksClient){
    try{
      const tasks = await tasksClient.tasks.list({ tasklist: '@default', showDeleted:false, showHidden:false, maxResults: 100 });
      for(const t of tasks.data.items || []){
        if(!t.due) continue;
        const due = new Date(t.due);
        if(!(due >= windowStart && due <= windowEnd)) continue;
        // If 'due' has time zone, use 1h block ending at 'due'; else 1h at 20:00 local
        let start = new Date(due);
        let end = new Date(due);
        if(t.due.endsWith('Z') || t.due.includes('T')){
          start = new Date(due.getTime() - 60*60000);
        } else {
          start.setHours(20,0,0,0);
          end   = new Date(start.getTime()+60*60000);
        }
        busy.push({ start, end, source:`task:${t.title}` });
      }
    }catch(e){
      console.warn('[autoScheduler] tasks.list failed, skip deadlines:', e.message);
    }
  }

  return mergeIntervals(busy);
}

/** Count tasks due on a local date (0..23h) */
function countDeadlinesOn(tasksClient) {
  return async (d0, d1) => {
    if(!tasksClient) return 0;
    try{
      const tasks = await tasksClient.tasks.list({ tasklist: '@default', showDeleted:false, showHidden:false, maxResults: 100 });
      let c = 0;
      for(const t of tasks.data.items || []){
        if(!t.due) continue;
        const due = new Date(t.due);
        if(due >= d0 && due < d1) c++;
      }
      return c;
    }catch{ return 0; }
  };
}

/**
 * Main entry point
 */
async function autoSchedule({ activity, durationMinutes=120, calendar, CALENDAR_ID, db, admin, tasksClient }) {
  const now = new Date();
  const windowStart = new Date(now);
  const windowEnd = new Date(now.getTime()+7*24*60*60*1000); // next 7 days

  const busy = await collectBusyIntervals({ calendar, CALENDAR_ID, db, admin, tasksClient, windowStart, windowEnd });

  // Generate candidate free slots per day
  const candidates = [];
  const countDeadlines = await countDeadlinesOn(tasksClient);

  for(let i=0;i<7;i++){
    const day = new Date(windowStart); day.setDate(day.getDate()+i);
    const free = dayFreeSlots(day, busy);
    const d0 = startOfDay(day), d1=endOfDay(day);
    const deadlines = await countDeadlines(d0, d1);

    for(const slot of free){
      const slotLenMin = Math.floor((slot.end - slot.start)/60000);
      if(slotLenMin < durationMinutes) continue;
      // Step every 30 minutes within slot
      for(let t = new Date(slot.start); t <= new Date(slot.end - durationMinutes*60000); t = new Date(t.getTime()+30*60000)){
        const sc = scoreSlot(t, durationMinutes, deadlines);
        candidates.push({ start: new Date(t), end: new Date(t.getTime()+durationMinutes*60000), score: sc });
      }
    }
  }

  if(candidates.length === 0){
    return { ok:false, message: 'Minggu ini lagi padet banget, jadi belum ada slot kosong yang cukup buat dijadwalin. Mau aku cek minggu depan atau cari durasi lebih pendek?' };
  }

  // pick best candidate
  candidates.sort((a,b)=>b.score - a.score);
  const best = candidates[0];

  // Create calendar event
  let calendarEventId = null;
  try{
    const ins = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: {
        summary: activity,
        start: { dateTime: toRFC3339Local(best.start), timeZone: JAKARTA_TZ },
        end: { dateTime: toRFC3339Local(best.end), timeZone: JAKARTA_TZ },
      },
    });
    calendarEventId = ins.data.id || null;
  }catch(e){
    console.warn('[autoScheduler] calendar.insert failed:', e.message);
  }

  // Save to Firestore
  try{
    await db.collection('schedules').add({
      content: activity,
      date: admin.firestore.Timestamp.fromDate(best.start),
      endDate: admin.firestore.Timestamp.fromDate(best.end),
      calendarEventId: calendarEventId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: { auto: true }
    });
  }catch(e){
    console.warn('[autoScheduler] firestore add failed:', e.message);
  }

  const options = { hour:'2-digit', minute:'2-digit', weekday:'long', day:'2-digit', month:'short' };
  const when = best.start.toLocaleString('id-ID', options);
  const until = best.end.toLocaleString('id-ID', { hour:'2-digit', minute:'2-digit' });
  return { ok:true, message: `Siap! Aku udah ngejadwalin **${activity}** di **${when} – ${until} (WIB)**. Have fun! 🎬🎮` };
}

module.exports = { autoSchedule };
