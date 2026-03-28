import type { CalendarDay, CalendarTask } from "../general_utils";

type DayTaskQuery = (day: CalendarDay) => CalendarTask[];
type TaskStyleResolver = (type: string) => React.CSSProperties;
type TaskOpener = (task: CalendarTask) => void;
type DayClickHandler = (day: CalendarDay) => void;

interface WeekViewProps {
    weekDays: CalendarDay[];
    getTasksForDay: DayTaskQuery;
    getTaskStyle: TaskStyleResolver;
    openTaskModal: TaskOpener;
    handleDayClick: DayClickHandler;
}

export function WeekView({
    weekDays,
    getTasksForDay,
    getTaskStyle,
    openTaskModal,
    handleDayClick,
}: WeekViewProps) {
    return (
        <div className="calendar-grid week-view-grid">
            <div className="weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="weekday">{day}</div>
                ))}
            </div>
            <div className="days-scroll-shell">
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
                                                title={`${task.title} ${task.time}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    openTaskModal(task);
                                                }}
                                            >
                                                <p className="task-time">{task.time}</p><div className="task-divider" aria-hidden="true"></div>{task.title}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
