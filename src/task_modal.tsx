import type { Dispatch, SetStateAction } from "react";
import { parseTaskDate, type CalendarTask } from "./general_utils";

interface TaskModalProps {
    modalDraft: Omit<CalendarTask, 'id' | 'date'> | null;
    isCreatingTask: boolean;
    selectedTask: CalendarTask | null;
    creatingTaskDate: Date;
    taskTypes: string[];
    addTypeOptionValue: string;
    onClose: () => void;
    onOpenTypeCreateModal: () => void;
    onOpenTypeEditModal: () => void;
    onDeleteTask: () => void;
    onSaveTask: () => void;
    setModalDraft: Dispatch<SetStateAction<Omit<CalendarTask, 'id' | 'date'> | null>>;
}

export function TaskModal({
    modalDraft,
    isCreatingTask,
    selectedTask,
    creatingTaskDate,
    taskTypes,
    addTypeOptionValue,
    onClose,
    onOpenTypeCreateModal,
    onOpenTypeEditModal,
    onDeleteTask,
    onSaveTask,
    setModalDraft,
}: TaskModalProps) {
    return (
        <aside className={`panel-sidebar ${modalDraft ? 'open' : ''}`}>
            <div className="panel-sidebar-header">
                <h2>{isCreatingTask ? 'Create Item' : 'Edit Item'}</h2>
                <button className="ai-sidebar-close" onClick={onClose} aria-label="Close">✕</button>
            </div>

            {modalDraft && (
                <div className="panel-sidebar-body">
                    {!isCreatingTask && selectedTask && (
                        <div className="panel-sidebar-meta">
                            {parseTaskDate(selectedTask.date).toLocaleDateString('default', {
                                weekday: 'long',
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric',
                            })}
                        </div>
                    )}

                    {isCreatingTask && (
                        <div className="panel-sidebar-meta">
                            {creatingTaskDate.toLocaleDateString('default', {
                                weekday: 'long',
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric',
                            })}
                        </div>
                    )}

                    <label className="task-modal-label">Title</label>
                    <input
                        className="task-modal-input"
                        value={modalDraft.title}
                        onChange={(event) => setModalDraft(prev => prev ? { ...prev, title: event.target.value } : prev)}
                    />

                    <label className="task-modal-label">Kind</label>
                    <select
                        className="task-modal-input"
                        value={modalDraft.itemKind}
                        onChange={(event) => {
                            const nextKind = event.target.value as 'task' | 'event';
                            setModalDraft(prev => prev ? {
                                ...prev,
                                itemKind: nextKind,
                                ddl: nextKind === 'task' ? (prev.ddl || '09:00') : '',
                                startTime: nextKind === 'event' ? (prev.startTime || '09:00') : '',
                                endTime: nextKind === 'event' ? (prev.endTime || '10:00') : '',
                            } : prev);
                        }}
                    >
                        <option value="task">task</option>
                        <option value="event">event</option>
                    </select>

                    {modalDraft.itemKind === 'task' ? (
                        <>
                            <label className="task-modal-label">DDL</label>
                            <input
                                className="task-modal-input"
                                type="time"
                                value={modalDraft.ddl}
                                onChange={(event) => setModalDraft(prev => prev ? { ...prev, ddl: event.target.value } : prev)}
                            />
                        </>
                    ) : (
                        <>
                            <label className="task-modal-label">Start Time</label>
                            <input
                                className="task-modal-input"
                                type="time"
                                value={modalDraft.startTime}
                                onChange={(event) => setModalDraft(prev => prev ? { ...prev, startTime: event.target.value } : prev)}
                            />

                            <label className="task-modal-label">End Time</label>
                            <input
                                className="task-modal-input"
                                type="time"
                                value={modalDraft.endTime}
                                onChange={(event) => setModalDraft(prev => prev ? { ...prev, endTime: event.target.value } : prev)}
                            />
                        </>
                    )}

                    <label className="task-modal-label">Type</label>
                    <div className="type-select-row">
                        <select
                            className="task-modal-input"
                            value={modalDraft.type}
                            onChange={(event) => {
                                const value = event.target.value;
                                if (value === addTypeOptionValue) {
                                    onOpenTypeCreateModal();
                                    return;
                                }
                                setModalDraft(prev => prev ? { ...prev, type: value } : prev);
                            }}
                        >
                            {taskTypes.map(type => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                            <option value={addTypeOptionValue}>+ add new type...</option>
                        </select>
                        <button className="task-modal-btn" onClick={onOpenTypeEditModal}>edit</button>
                    </div>

                    <label className="task-modal-label">Note</label>
                    <textarea
                        className="task-modal-textarea"
                        value={modalDraft.note}
                        onChange={(event) => setModalDraft(prev => prev ? { ...prev, note: event.target.value } : prev)}
                    />

                    <div className="panel-sidebar-actions">
                        {!isCreatingTask && (
                            <button className="task-modal-btn danger" onClick={onDeleteTask}>Delete</button>
                        )}
                        <button className="task-modal-btn" onClick={onClose}>Cancel</button>
                        <button className="task-modal-btn primary" onClick={onSaveTask}>Save</button>
                    </div>
                </div>
            )}
        </aside>
    );
}
