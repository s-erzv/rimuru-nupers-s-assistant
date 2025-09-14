import React, { useState, useEffect } from 'react';
import Card from './ui/Card';
import ScheduleList from './ScheduleList';
import FinanceList from './FinanceList';

export default function Dashboard({ fetchWithAuth, setErrorMessage }) {
  const [schedules, setSchedules] = useState([]);
  const [finances, setFinances] = useState([]);

  const fetchAllData = async () => {
    try {
      const [schedulesRes, financesRes] = await Promise.all([
        fetchWithAuth('/api/schedules'),
        fetchWithAuth('/api/finances'),
      ]);
      if (!schedulesRes.ok || !financesRes.ok) throw new Error('Failed to fetch from server.');
      const schedulesData = await schedulesRes.json();
      const financesData = await financesRes.json();
      setSchedules(schedulesData);
      setFinances(financesData);
      setErrorMessage('');
    } catch (err) {
      console.error(err);
      setErrorMessage('There was an error fetching data. Please try again.');
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="h-auto lg:h-[calc(100vh-220px)] overflow-y-auto">
        <ScheduleList schedules={schedules} />
      </Card>
      <Card className="h-auto lg:h-[calc(100vh-220px)] overflow-y-auto">
        <FinanceList finances={finances} />
      </Card>
    </div>
  );
}