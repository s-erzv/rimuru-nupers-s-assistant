import React from 'react';
import SectionHeader from './ui/SectionHeader';
import Card from './ui/Card';
import Stat from './ui/Stat';
import Badge from './ui/Badge';
import Empty from './ui/Empty';

const formatIDDateTime = (seconds) => {
  try {
    return new Date(seconds * 1000).toLocaleString('id-ID', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    });
  } catch {
    return '-';
  }
};

const formatIDR = (n) =>
  new Intl.NumberFormat('id-ID').format(Math.abs(n || 0));

export default function FinanceList({ finances }) {
  const list = Array.isArray(finances) ? finances : [];

  const isIncome = (f) => f?.type === 'income' || (f?.type == null && (f?.amount || 0) > 0);
  const incomes = list.filter(isIncome).reduce((a, b) => a + Math.abs(b.amount || 0), 0);
  const expenses = list.filter((f) => !isIncome(f)).reduce((a, b) => a + Math.abs(b.amount || 0), 0);
  const balance = incomes - expenses;

  return (
    <div className="p-6">
      <SectionHeader
        title="Finances"
        subtitle="Transactions overview"
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0-2.08-.402-2.599-1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
          </svg>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Stat label="Income" value={`Rp${formatIDR(incomes)}`} tone="positive" />
        <Stat label="Expenses" value={`Rp${formatIDR(expenses)}`} tone="negative" />
        <Stat label="Balance" value={`Rp${formatIDR(balance)}`} tone={balance >= 0 ? 'info' : 'negative'} />
      </div>

      {/* List */}
      {list.length === 0 ? (
        <Empty
          title="No transactions yet"
          desc="Track income/expenses via Chat"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0-2.08-.402-2.599-1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
            </svg>
          }
        />
      ) : (
        <div className="space-y-3">
          {list.map((f) => {
            const income = isIncome(f);
            return (
              <Card key={f.id} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{f.item}</p>
                    <div className="mt-1 flex items-center text-xs text-slate-500 space-x-1">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                      </svg>
                      <span>{formatIDDateTime(f?._seconds)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <Badge tone={income ? 'positive' : 'negative'}>{income ? 'Income' : 'Expense'}</Badge>
                    <p className={`mt-2 text-lg font-semibold ${income ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {income ? '+' : '-'}Rp{formatIDR(f.amount)}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}