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

module.exports = {
  formatDateYMD,
  formatTimeHM,
  formatRFC3339Local,
  parseStructuredSchedule
};