import { useState } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";

async function get_events() {
    console.log(await invoke('get_events'));
}

function MainCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState('month');

    const handlePrevMonth = () => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() - 1);
            return newDate;
        });
    };

    const handleNextMonth = () => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + 1);
            return newDate;
        });
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const handleViewChange = (mode: string) => {
        setViewMode(mode);
    };

    const generateCalendarDays = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const days = [];

        const prevMonthDays = new Date(year, month, 0).getDate();
        for (let i = firstDayOfMonth - 1; i >= 0; i--) {
            days.push({
                day: prevMonthDays - i,
                month: month - 1,
                year: year,
                isOtherMonth: true
            });
        }

        for (let i = 1; i <= daysInMonth; i++) {
            days.push({
                day: i,
                month: month,
                year: year,
                isOtherMonth: false,
                isToday: i === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear()
            });
        }

        const remainingDays = 42 - days.length; // 6 rows × 7 days
        for (let i = 1; i <= remainingDays; i++) {
            days.push({
                day: i,
                month: month + 1,
                year: year,
                isOtherMonth: true
            });
        }

        return days;
    };

    const calendarDays = generateCalendarDays();

    // 模拟任务数据
    const tasks = [
        { id: 1, title: 'Conference', date: new Date(2026, 2, 1), type: 'work' },
        { id: 2, title: 'All Day Event', date: new Date(2026, 2, 1), type: 'personal' },
        { id: 3, title: '10:30a Meeting', date: new Date(2026, 2, 1), type: 'work' },
        { id: 4, title: '12p Lunch', date: new Date(2026, 2, 1), type: 'personal' },
        { id: 5, title: '7th Birthday Party', date: new Date(2026, 2, 3), type: 'personal' },
        { id: 6, title: 'Long Event', date: new Date(2026, 2, 7), type: 'work' },
        { id: 7, title: 'Long Event', date: new Date(2026, 2, 8), type: 'work' },
        { id: 8, title: '4p Repeating Event', date: new Date(2026, 2, 8), type: 'work' },
        { id: 9, title: '4p Repeating Event', date: new Date(2026, 2, 15), type: 'work' },
        { id: 10, title: 'Click for Google', date: new Date(2026, 2, 27), type: 'important' },
    ];

    get_events();

    const getTasksForDay = (day: any) => {
        return tasks.filter(task => {
            return task.date.getDate() === day.day && 
                   task.date.getMonth() === day.month && 
                   task.date.getFullYear() === day.year;
        });
    };

    const handleDayClick = (day: any) => {
        const dayTasks = getTasksForDay(day);
        const dateStr = new Date(day.year, day.month, day.day).toLocaleDateString();
        if (dayTasks.length > 0) {
            const taskList = dayTasks.map(task => `- ${task.title}`).join('\n');
            alert(`${dateStr}\n\nTasks:\n${taskList}`);
        } else {
            alert(`${dateStr}\n\nNo tasks scheduled`);
        }
    };

    return (
        <main className="calendar-container">
            <div className="calendar-header">
                <div className="calendar-nav">
                    <button className="nav-btn" onClick={handlePrevMonth}>&lt;</button>
                    <button className="nav-btn" onClick={handleNextMonth}>&gt;</button>
                    <button className="today-btn" onClick={handleToday}>today</button>
                </div>
                <div className="calendar-title">
                    {currentDate.toLocaleString('default', { month: 'long' })} {currentDate.getFullYear()}
                </div>
                <div className="view-selector">
                    <button className={`view-btn ${viewMode === 'month' ? 'active' : ''}`} onClick={() => handleViewChange('month')}>month</button>
                    <button className={`view-btn ${viewMode === 'week' ? 'active' : ''}`} onClick={() => handleViewChange('week')}>week</button>
                    <button className={`view-btn ${viewMode === 'day' ? 'active' : ''}`} onClick={() => handleViewChange('day')}>day</button>
                    <button className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => handleViewChange('list')}>list</button>
                </div>
            </div>
            <div className="calendar-grid">
                <div className="weekdays">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <div key={day} className="weekday">{day}</div>
                    ))}
                </div>
                <div className="days">
                    {calendarDays.map((day, index) => {
                        const dayTasks = getTasksForDay(day);
                        return (
                            <div 
                                key={index} 
                                className={`day ${day.isOtherMonth ? 'other-month' : ''} ${day.isToday ? 'today' : ''}`}
                                onClick={() => handleDayClick(day)}
                            >
                                <div className="day-number">{day.day}</div>
                                <div className="tasks">
                                    {dayTasks.map(task => (
                                        <div key={task.id} className={`task ${task.type}`} title={task.title}>
                                            {task.title}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </main>
    );
}

function App() {
    return (
        <div className="App">
            <MainCalendar />
        </div>
    );
}

export default App;
