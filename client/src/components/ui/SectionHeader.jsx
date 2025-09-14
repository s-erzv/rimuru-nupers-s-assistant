import React from 'react';

export default function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center space-x-3">
        <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}