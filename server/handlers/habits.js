const admin = require('firebase-admin');

module.exports = (db) => {
  return {
    habit_track: async (req, res, data) => {
      const { habit, status } = data;
      if (!habit || !status) return res.status(400).json({ error: 'Informasi kebiasaan tidak lengkap.' });
      await db.collection('habits').add({ habit, status, date: admin.firestore.Timestamp.now() });
      const text = status === 'done' ? `Hebat! Kebiasaan **${habit}** hari ini udah dicatat. Pertahankan ya!` : `Oke, aku catat status **${habit}** kamu.`;
      res.json({ text });
    },

    habit_query: async (req, res, data) => {
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

    set_goal: async (req, res, data) => {
      const { topic, goal_name, amount, period, frequency } = data;
      await db.collection('goals').add({ topic, goal_name, amount: amount || null, period: period || null, frequency: frequency || null, createdAt: admin.firestore.Timestamp.now() });
      res.json({ text: `Oke, target **${goal_name}** udah aku simpan. Aku akan ingetin kamu biar on track.` });
    },

    goal_progress: async (req, res, data) => {
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
  };
};