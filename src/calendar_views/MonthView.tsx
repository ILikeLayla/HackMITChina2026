import {
    getTaskCommitmentCategory,
    getTaskDisplayTime,
    type CalendarDay,
    type CalendarTask,
    type DeadlineMode,
} from "../general_utils";

type DayTaskQuery = (day: CalendarDay) => CalendarTask[];
type TaskStyleResolver = (type: string) => React.CSSProperties;
type TaskOpener = (task: CalendarTask) => void;
type DayClickHandler = (day: CalendarDay) => void;

interface MonthViewProps {
    calendarDays: CalendarDay[];
    getTasksForDay: DayTaskQuery;
    getTaskStyle: TaskStyleResolver;
    openTaskModal: TaskOpener;
    handleDayClick: DayClickHandler;
    deadlineMode: DeadlineMode;
}

export function MonthView({
    calendarDays,
    getTasksForDay,
    getTaskStyle,
    openTaskModal,
    handleDayClick,
    deadlineMode,
}: MonthViewProps) {
    return (
        <div className="calendar-grid month-view-grid">
            <div className="weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="weekday">{day}</div>
                ))}
            </div>
            <div className="days-scroll-shell">
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
                                {week.map((day, dayIndex) => {
                                    const dayTasks = getTasksForDay(day);
                                    return (
                                        <div
                                            key={dayIndex}
                                            className={`day ${day.isOtherMonth ? 'other-month' : ''} ${day.isToday ? 'today' : ''}`}
                                            onClick={() => handleDayClick(day)}
                                        >
                                            <div className="day-number">{day.day}</div>
                                            <div className="tasks">
                                                {dayTasks.map(task => {
                                                    const commitmentCategory = getTaskCommitmentCategory(task);
                                                    return (
                                                    <div
                                                        key={task.id}
                                                        className={`task clickable-task ${task.type} commitment-${commitmentCategory}${task._aiPreviewStatus ? ` ${task._aiPreviewStatus}` : ''}`}
                                                        style={getTaskStyle(task.type)}
                                                        title={`${task.title} ${getTaskDisplayTime(task, deadlineMode)}`}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            if (task._aiPreviewStatus !== 'ai-preview-deleted') openTaskModal(task);
                                                        }}
                                                    >
                                                        <div className="task-meta-line">
                                                            <p className="task-time">{getTaskDisplayTime(task, deadlineMode)}</p>
                                                            <span className="task-label-stack">
                                                                <span className={`task-kind-badge ${task.itemKind}`}>
                                                                    {task.itemKind === 'event' ? 'EVT' : 'TSK'}
                                                                </span>
                                                                {commitmentCategory !== 'undetermined' && (
                                                                    <span className={`task-commitment-pill ${commitmentCategory}`}>
                                                                        {commitmentCategory === 'hard_commitment' ? 'Hard' : 'Flex'}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div className="task-title-line">{task.title}</div>
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>)
                        )
                    }
                </div>
            </div>
        </div>
    );
}
