import type { RefObject } from "react";
import { getFirstUpcomingTaskKey, getTaskDisplayTime, type CalendarTask } from "../general_utils";

type TaskStyleResolver = (type: string) => React.CSSProperties;
type TaskOpener = (task: CalendarTask) => void;

interface ListViewProps {
    listTaskGroups: [string, CalendarTask[]][];
    listScrollTargetRef: RefObject<HTMLDivElement | null>;
    getTaskStyle: TaskStyleResolver;
    openTaskModal: TaskOpener;
}

export function ListView({
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
                    const now = new Date();
                    const isToday =
                        cardDate.getDate() === now.getDate() &&
                        cardDate.getMonth() === now.getMonth() &&
                        cardDate.getFullYear() === now.getFullYear();

                    return (
                        <div
                            key={key}
                            className={`list-card ${isToday ? 'today' : ''}`}
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
                                        <div className="list-card-task-main">{getTaskDisplayTime(task)}<div className="task-divider" aria-hidden="true"></div>{task.title}</div>
                                        <div className="list-card-task-note">{task.note || 'No note'}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })
            ) : (
                <div className="list-view-empty">No items available</div>
            )}
        </div>
    );
}
