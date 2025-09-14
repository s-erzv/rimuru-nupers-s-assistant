import React from 'react';

export default function Badge({ children, tone = 'default' }) {
  const tones = {
    default: 'bg-slate-100 text-slate-700',
    positive: 'bg-emerald-100 text-emerald-700',
    negative: 'bg-rose-100 text-rose-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}