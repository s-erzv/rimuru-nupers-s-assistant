const admin = require('firebase-admin');

module.exports = (db, sheets, SPREADSHEET_ID, DAILY_FOOD_BUDGET, WEEKLY_BUDGET, sendPushNotification) => {
  return {
    expense: async (req, res, data) => {
      const { item, amount } = data;
      if (!item || !amount) return res.status(400).json({ error: 'Informasi pengeluaran tidak lengkap.' });
      const expenseAmount = -Math.abs(amount);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now.setDate(now.getDate() - (now.getDay() + 6) % 7));

      await db.collection('finances').add({ item, amount: expenseAmount, type: 'expense', date: admin.firestore.Timestamp.fromDate(new Date()) });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID, 
        range: 'Pengeluaran!A:D', 
        valueInputOption: 'USER_ENTERED',
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

    income: async (req, res, data) => {
      const { item, amount } = data;
      if (!item || !amount) return res.status(400).json({ error: 'Informasi pemasukan tidak lengkap.' });
      const incomeAmount = Math.abs(amount);
      await db.collection('finances').add({ item, amount: incomeAmount, type: 'income', date: admin.firestore.Timestamp.fromDate(new Date()) });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID, 
        range: 'Pemasukan!A:D', 
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[new Date().toLocaleString('id-ID'), item, incomeAmount, 'Pemasukan']] }
      });
      res.json({ text: `Cihuyy, cuan! Pemasukan dari **${item}** sebesar Rp${incomeAmount.toLocaleString('id-ID')} udah masuk.` });
    },

    budget_query: async (req, res, data) => {
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
    
    finance_summary: async (req, res, data) => {
      const { period } = data;
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
        const incomeSnapshot = await db.collection('finances')
          .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
          .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
          .where('type', '==', 'income')
          .get();
        const totalIncome = incomeSnapshot.docs.reduce((sum, doc) => sum + doc.data().amount, 0);

        const expenseSnapshot = await db.collection('finances')
          .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
          .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
          .where('type', '==', 'expense')
          .get();
        const totalExpenses = expenseSnapshot.docs.reduce((sum, doc) => sum + Math.abs(doc.data().amount), 0);

        const netBalance = totalIncome - totalExpenses;
        const summaryText = `Ringkasan Keuangan ${period}:\n\nTotal Pemasukan: Rp${totalIncome.toLocaleString('id-ID')}\nTotal Pengeluaran: Rp${totalExpenses.toLocaleString('id-ID')}\nSaldo Bersih: Rp${netBalance.toLocaleString('id-ID')}`;
        res.json({ text: summaryText });
      } catch (e) {
        console.error('Error saat merangkum data keuangan:', e);
        res.status(500).json({ error: 'Gagal merangkum data keuangan.' });
      }
    }
  };
};