import { getTaskDisplayTime, type CalendarDay, type CalendarTask } from "../general_utils";

type DayTaskQuery = (day: CalendarDay) => CalendarTask[];
type TaskStyleResolver = (type: string) => React.CSSProperties;
type TaskOpener = (task: CalendarTask) => void;

interface DayViewProps {
    currentDate: Date;
    getTasksForDay: DayTaskQuery;
    getTaskStyle: TaskStyleResolver;
    openTaskModal: TaskOpener;
}

export function DayView({
    currentDate,
    getTasksForDay,
    getTaskStyle,
    openTaskModal,
}: DayViewProps) {
    const now = new Date();
    const day: CalendarDay = {
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
            <div className="day-view-tasks-shell">
                <div className="day-view-tasks">
                    {dayTasks.length > 0 ? (
                        dayTasks.map(task => (
                            <div
                                key={task.id}
                                className={`day-view-task task clickable-task ${task.type}`}
                                style={getTaskStyle(task.type)}
                                onClick={() => openTaskModal(task)}
                            >
                                <div className="day-view-task-main">{getTaskDisplayTime(task)}<div className="task-divider" aria-hidden="true"></div>{task.title}</div>
                                <div className="day-view-task-note">{task.note || 'No note'}</div>
                            </div>
                        ))
                    ) : (
                        <div className="day-view-empty">No items scheduled</div>
                    )}
                </div>
            </div>
        </div>
    );
}
