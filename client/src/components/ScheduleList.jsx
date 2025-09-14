import React from 'react';
import SectionHeader from './ui/SectionHeader';
import Card from './ui/Card';
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

export default function ScheduleList({ schedules }) {
  return (
    <div className="p-6">
      <SectionHeader
        title="Schedule"
        subtitle="Your current agenda"
        icon={
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
          </svg>
        }
      />

      {!schedules || schedules.length === 0 ? (
        <Empty
          title="No schedule yet"
          desc="Add a schedule via the Chat tab"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
            </svg>
          }
        />
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <Card key={s.id} className="p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{s.content}</p>
                  <div className="mt-1 flex items-center text-xs text-slate-500 space-x-1">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                    <span>{formatIDDateTime(s?._seconds)}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}