import React from 'react';
import Card from './Card';

export default function Empty({ icon, title, desc }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {desc && <p className="text-xs text-slate-500 mt-1">{desc}</p>}
    </Card>
  );
}