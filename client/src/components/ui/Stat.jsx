import React from 'react';
import Card from './Card';

export default function Stat({ label, value, hint, tone = 'default' }) {
  const toneMap = {
    default: 'text-slate-900',
    positive: 'text-emerald-700',
    negative: 'text-rose-700',
    info: 'text-blue-700',
  };
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${toneMap[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </Card>
  );
}