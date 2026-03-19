import type { RefObject } from "react";
import type { CalendarDay, CalendarTask } from "./general_utils";
import { getFirstUpcomingTaskKey } from "./general_utils";

type DayTaskQuery = (day: CalendarDay) => CalendarTask[];
type TaskStyleResolver = (type: string) => React.CSSProperties;
type TaskOpener = (task: CalendarTask) => void;
type DayClickHandler = (day: CalendarDay) => void;

interface SharedViewProps {
    getTaskStyle: TaskStyleResolver;
    openTaskModal: TaskOpener;
}

interface WeekViewProps extends SharedViewProps {
    weekDays: CalendarDay[];
    getTasksForDay: DayTaskQuery;
    handleDayClick: DayClickHandler;
}

interface DayViewProps extends SharedViewProps {
    currentDate: Date;
    getTasksForDay: DayTaskQuery;
}

interface ListViewProps extends SharedViewProps {
    listTaskGroups: [string, CalendarTask[]][];
    listScrollTargetRef: RefObject<HTMLDivElement | null>;
}

interface MonthViewProps extends SharedViewProps {
    calendarDays: CalendarDay[];
    getTasksForDay: DayTaskQuery;
    handleDayClick: DayClickHandler;
}

export function generateWeekViewDOM({
    weekDays,
    getTasksForDay,
    getTaskStyle,
    openTaskModal,
    handleDayClick,
}: WeekViewProps) {
    return (
        <div className="calendar-grid">
            <div className="weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="weekday">{day}</div>
                ))}
            </div>
            <div className="days">
                <div className="days-a-week">
                    {weekDays.map((day, index) => {
                        const dayTasks = getTasksForDay(day);
                        return (
                            <div
                                key={index}
                                className={`day ${day.isToday ? 'today' : ''}`}
                                onClick={() => handleDayClick(day)}
                            >
                                <div className="day-number">{day.day}</div>
                                <div className="tasks">
                                    {dayTasks.map(task => (
                                        <div
                                            key={task.id}
                                            className={`task clickable-task ${task.type}`}
                                            style={getTaskStyle(task.type)}
                                            title={`${task.title} | ${task.time}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                openTaskModal(task);
                                            }}
                                        >
                                            <span className="task-time">{task.time}</span> {task.title}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function generateDayViewDOM({
    currentDate,
    getTasksForDay,
    getTaskStyle,
    openTaskModal,
}: DayViewProps) {
    const now = new Date();
    const day = {
        day: currentDate.getDate(),
        month: currentDate.getMonth(),
        year: currentDate.getFullYear(),
        isToday:
            currentDate.getDate() === now.getDate() &&
            currentDate.getMonth() === now.getMonth() &&
            currentDate.getFullYear() === now.getFullYear(),
    };
    const dayTasks = getTasksForDay(day);

    return (
        <div className="day-view">
            <div className={`day-view-date ${day.isToday ? 'today' : ''}`}>
                {currentDate.toLocaleDateString('default', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                })}
            </div>
            <div className="day-view-tasks">
                {dayTasks.length > 0 ? (
                    dayTasks.map(task => (
                        <div
                            key={task.id}
                            className={`day-view-task task clickable-task ${task.type}`}
                            style={getTaskStyle(task.type)}
                            onClick={() => openTaskModal(task)}
                        >
                            <div className="day-view-task-main">{task.time} {task.title}</div>
                            <div className="day-view-task-note">{task.note || 'No note'}</div>
                        </div>
                    ))
                ) : (
                    <div className="day-view-empty">No tasks scheduled</div>
                )}
            </div>
        </div>
    );
}

export function generateListViewDOM({
    listTaskGroups,
    listScrollTargetRef,
    getTaskStyle,
    openTaskModal,
}: ListViewProps) {
    const firstUpcomingKey = getFirstUpcomingTaskKey(listTaskGroups);

    return (
        <div className="list-view">
            {listTaskGroups.length > 0 ? (
                listTaskGroups.map(([key, dayTasks]) => {
                    const [year, month, day] = key.split('-').map(Number);
                    const cardDate = new Date(year, month, day);
                    return (
                        <div
                            key={key}
                            className="list-card"
                            ref={key === firstUpcomingKey ? listScrollTargetRef : null}
                        >
                            <div className="list-card-date">
                                {cardDate.toLocaleDateString('default', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    year: 'numeric',
                                })}
                            </div>
                            <div className="list-card-tasks">
                                {dayTasks.map(task => (
                                    <div
                                        key={task.id}
                                        className={`list-card-task task clickable-task ${task.type}`}
                                        style={getTaskStyle(task.type)}
                                        onClick={() => openTaskModal(task)}
                                    >
                                        <div className="list-card-task-main">{task.time} {task.title}</div>
                                        <div className="list-card-task-note">{task.note || 'No note'}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })
            ) : (
                <div className="list-view-empty">No tasks available</div>
            )}
        </div>
    );
}

export function generateMonthViewDOM({
    calendarDays,
    getTasksForDay,
    getTaskStyle,
    openTaskModal,
    handleDayClick,
}: MonthViewProps) {
    return (
        <div className="calendar-grid">
            <div className="weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="weekday">{day}</div>
                ))}
            </div>
            <div className="days">
            {
                calendarDays.reduce((weeks: CalendarDay[][], day, index) => {
                    if (index % 7 === 0) {
                        weeks.push([day]);
                    } else {
                        weeks[weeks.length - 1].push(day);
                    }
                    return weeks;
                }, []).map((week, index) => (
                    <div key={index} className="days-a-week">
                        {week.map((day, index) => {
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
                                            <div
                                                key={task.id}
                                                className={`task clickable-task ${task.type}`}
                                                style={getTaskStyle(task.type)}
                                                title={`${task.title} | ${task.time}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    openTaskModal(task);
                                                }}
                                            >
                                                <span className="task-time">{task.time}</span> {task.title}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    }
                </div>)
                )
            }
            </div>
        </div>
    );
}
