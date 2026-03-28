import type { RefObject } from "react";
import {
    getFirstUpcomingTaskKey,
    getTaskCommitmentCategory,
    getTaskCommitmentCategoryLabel,
    getTaskDisplayTime,
    type CalendarTask,
} from "../general_utils";

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

                    const renderTask = (task: CalendarTask) => {
                        const category = getTaskCommitmentCategory(task);
                        return (
                            <div
                                key={task.id}
                                className={`list-card-task task clickable-task ${task.type} commitment-${category}`}
                                style={getTaskStyle(task.type)}
                                onClick={() => openTaskModal(task)}
                            >
                                <div className="list-card-task-main">
                                    <span className="task-main-left">
                                        <span className="task-time">{getTaskDisplayTime(task)}</span>
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
                                <div className="list-card-task-note">{task.note || 'No note'}</div>
                            </div>
                        );
                    };

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
                                {dayTasks.map(renderTask)}
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
