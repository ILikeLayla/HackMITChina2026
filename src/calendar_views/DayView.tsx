import {
    getTaskCommitmentCategory,
    getTaskCommitmentCategoryLabel,
    getTaskDisplayTime,
    type CalendarDay,
    type CalendarTask,
    type DeadlineMode,
} from "../general_utils";

type DayTaskQuery = (day: CalendarDay) => CalendarTask[];
type TaskStyleResolver = (type: string) => React.CSSProperties;
type TaskOpener = (task: CalendarTask) => void;

interface DayViewProps {
    currentDate: Date;
    getTasksForDay: DayTaskQuery;
    getTaskStyle: TaskStyleResolver;
    openTaskModal: TaskOpener;
    deadlineMode: DeadlineMode;
}

export function DayView({
    currentDate,
    getTasksForDay,
    getTaskStyle,
    openTaskModal,
    deadlineMode,
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
    const renderTask = (task: CalendarTask) => {
        const category = getTaskCommitmentCategory(task);
        return (
            <div
                key={task.id}
                className={`day-view-task task clickable-task ${task.type} commitment-${category}${task._aiPreviewStatus ? ` ${task._aiPreviewStatus}` : ''}`}
                style={getTaskStyle(task.type)}
                onClick={() => { if (task._aiPreviewStatus !== 'ai-preview-deleted') openTaskModal(task); }}
            >
                <div className="day-view-task-main">
                    <span className="task-main-left">
                        <span className="task-time">{getTaskDisplayTime(task, deadlineMode)}</span>
                        <span className="task-divider" aria-hidden="true"></span>
                        <span className="task-main-title">{task.title}</span>
                    </span>
                    <span className="task-label-stack">
                        <span className={`task-kind-badge ${task.itemKind}`}>
                            {task.itemKind === 'event' ? 'EVT' : 'TSK'}
                        </span>
                        {category !== 'undetermined' && (
                            <span className={`task-commitment-badge ${category}`}>
                                {getTaskCommitmentCategoryLabel(category)}
                            </span>
                        )}
                    </span>
                </div>
                <div className="day-view-task-note">{task.note || 'No note'}</div>
            </div>
        );
    };

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
                        dayTasks.map(renderTask)
                    ) : (
                        <div className="day-view-empty">No items scheduled</div>
                    )}
                </div>
            </div>
        </div>
    );
}
