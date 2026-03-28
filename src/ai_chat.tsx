import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type AiChatRole = 'user' | 'assistant' | 'system';

export type AiTaskPreview = {
    id: number;
    title: string;
    date: string;
    itemKind: 'task' | 'event';
    ddl: string;
    startTime: string;
    endTime: string;
    type: string;
    note: string;
};

export type AiChatMessage = {
    id: string;
    role: AiChatRole;
    text: string;
    createdAt: number;
    taskPreview?: AiTaskPreview;
    taskCards?: AiTaskPreview[];
};

export type AiChatThread = {
    id: string;
    title: string;
    messages: AiChatMessage[];
    createdAt: number;
    updatedAt: number;
};

export type AiThreadProgress = {
    percent: number;
    status: string;
    isActive: boolean;
    mode?: 'sos' | 'chat';
};

interface AiChatSidebarProps {
    isOpen: boolean;
    isSubmitting: boolean;
    aiThreads: AiChatThread[];
    activeAiThreadId: string;
    activeAiThread: AiChatThread | null;
    activeThreadProgress?: AiThreadProgress | null;
    aiChatInput: string;
    aiMessagesEndRef: React.RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onCreateThread: () => void;
    onDeleteThread: (threadId: string) => void;
    onSwitchThread: (threadId: string) => void;
    onInputChange: (value: string) => void;
    onSendMessage: () => void;
    onCancelRequest: () => void;
    openTaskModalFromPreview: (taskPreview: AiTaskPreview) => void;
    getTaskStyle: (type: string) => React.CSSProperties;
}

export function AiChatSidebar({
    isOpen,
    isSubmitting,
    aiThreads,
    activeAiThreadId,
    activeAiThread,
    activeThreadProgress,
    aiChatInput,
    aiMessagesEndRef,
    onClose,
    onCreateThread,
    onDeleteThread,
    onSwitchThread,
    onInputChange,
    onSendMessage,
    onCancelRequest,
    openTaskModalFromPreview,
    getTaskStyle,
}: AiChatSidebarProps) {
    const [isThreadsOpen, setIsThreadsOpen] = useState(false);
    const [width, setWidth] = useState(380);
    const isDragging = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(380);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        isDragging.current = true;
        startX.current = e.clientX;
        startWidth.current = width;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [width]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging.current) return;
        const delta = startX.current - e.clientX;
        const newWidth = Math.min(800, Math.max(280, startWidth.current + delta));
        setWidth(newWidth);
    }, []);

    const onPointerUp = useCallback(() => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        const handleUp = () => {
            isDragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        window.addEventListener('pointerup', handleUp);
        return () => window.removeEventListener('pointerup', handleUp);
    }, [isOpen]);

    const getPreviewTimeText = (task: AiTaskPreview) => {
        if (task.itemKind === 'event') {
            return `${task.startTime || '--:--'} - ${task.endTime || '--:--'}`;
        }
        return `DDL ${task.ddl || '--:--'}`;
    };

    return (
        <aside className={`ai-sidebar ${isOpen ? 'open' : ''}`} style={{ width }}>
            <div
                className="ai-sidebar-resize-handle"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            />
            <div className="ai-sidebar-header">
                <h2>AI Chat</h2>
                <button className="ai-sidebar-close" onClick={onClose} aria-label="Close sidebar">✕</button>
            </div>

            <div className="ai-sidebar-threads-section">
                <button
                    className={`ai-sidebar-threads-toggle ${isThreadsOpen ? 'expanded' : ''}`}
                    onClick={() => setIsThreadsOpen(prev => !prev)}
                >
                    <span className="ai-sidebar-threads-arrow">{isThreadsOpen ? '▾' : '▸'}</span>
                    <span>Threads ({aiThreads.length})</span>
                    <button
                        className="ai-sidebar-new-thread-btn"
                        onClick={(e) => { e.stopPropagation(); onCreateThread(); }}
                        disabled={isSubmitting}
                        aria-label="New thread"
                    >
                        +
                    </button>
                </button>
                <div className={`ai-sidebar-threads-list ${isThreadsOpen ? 'expanded' : ''}`}>
                    <div className="ai-sidebar-threads-list-inner">
                    {aiThreads.map(thread => {
                        const latestMessage = thread.messages[thread.messages.length - 1];
                        return (
                            <div
                                key={thread.id}
                                className={`ai-thread-item ${thread.id === activeAiThreadId ? 'active' : ''}`}
                            >
                                <button
                                    className="ai-thread-item-body"
                                    onClick={() => { onSwitchThread(thread.id); setIsThreadsOpen(false); }}
                                    disabled={isSubmitting}
                                >
                                    <div className="ai-thread-item-title">{thread.title}</div>
                                    <div className="ai-thread-item-preview">{latestMessage?.text ?? 'No messages yet.'}</div>
                                </button>
                                <button
                                    className="ai-thread-delete-btn"
                                    onClick={(e) => { e.stopPropagation(); onDeleteThread(thread.id); }}
                                    disabled={isSubmitting}
                                    aria-label="Delete thread"
                                >
                                    ✕
                                </button>
                            </div>
                        );
                    })}
                    </div>
                </div>
            </div>

            <div className="ai-chat-main">
                {activeThreadProgress && (
                    <div className={`ai-chat-progress-panel ${activeThreadProgress.isActive ? 'active' : 'done'}`}>
                        <div className="ai-chat-progress-head">
                            <span>AI Progress</span>
                            <span>{`${Math.max(0, Math.min(100, Math.round(activeThreadProgress.percent)))}%`}</span>
                        </div>
                        <div className="ai-chat-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Math.round(activeThreadProgress.percent)))}>
                            <div className="ai-chat-progress-fill" style={{ width: `${Math.max(0, Math.min(100, activeThreadProgress.percent))}%` }} />
                        </div>
                        <div className="ai-chat-progress-status">{activeThreadProgress.status}</div>
                    </div>
                )}

                <div className="ai-chat-messages" aria-live="polite">
                    {activeAiThread?.messages.map(message => (
                        <div
                            key={message.id}
                            className={`ai-chat-message ai-chat-message-${message.role}${message.taskCards?.length ? ' ai-chat-message-task-cards' : ''}`}
                        >
                            <div className="ai-chat-message-role">{message.role}</div>
                            <div className="ai-chat-message-text">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {message.text}
                                </ReactMarkdown>
                            </div>
                            {message.taskPreview && (
                                <div className="ai-task-preview">
                                    <div
                                        className="list-card-task clickable-task"
                                        style={getTaskStyle(message.taskPreview.type)}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => openTaskModalFromPreview(message.taskPreview!)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                openTaskModalFromPreview(message.taskPreview!);
                                            }
                                        }}
                                    >
                                        <div className="list-card-task-main">
                                            <span className="task-time">{getPreviewTimeText(message.taskPreview)}</span>
                                            <span className="task-divider" aria-hidden="true" />
                                            {message.taskPreview.title || '(untitled task)'}
                                        </div>
                                        <div className="list-card-task-note">
                                            {`${message.taskPreview.date} | ${message.taskPreview.itemKind} | ${message.taskPreview.type} | #${message.taskPreview.id}`}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {message.taskCards && message.taskCards.length > 0 && (
                                <div className="ai-task-cards-list">
                                    {message.taskCards.map(taskCard => (
                                        <div
                                            key={`${message.id}-${taskCard.id}`}
                                            className="list-card-task clickable-task"
                                            style={getTaskStyle(taskCard.type)}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openTaskModalFromPreview(taskCard)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    openTaskModalFromPreview(taskCard);
                                                }
                                            }}
                                        >
                                            <div className="list-card-task-main">
                                                <span className="task-time">{getPreviewTimeText(taskCard)}</span>
                                                <span className="task-divider" aria-hidden="true" />
                                                {taskCard.title || '(untitled task)'}
                                            </div>
                                            <div className="list-card-task-note">
                                                {`${taskCard.date} | ${taskCard.itemKind} | ${taskCard.type} | #${taskCard.id}`}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={aiMessagesEndRef} />
                </div>

                {isSubmitting && (
                    <div className="ai-chat-processing">
                        <span>AI is processing your request...</span>
                        <button className="task-modal-btn" onClick={onCancelRequest}>
                            Cancel
                        </button>
                    </div>
                )}

                <div className="ai-chat-input-wrap">
                    <textarea
                        className="task-modal-textarea ai-chat-input"
                        placeholder="e.g. Schedule focused work blocks for tomorrow morning."
                        value={aiChatInput}
                        onChange={(event) => onInputChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                onSendMessage();
                            }
                        }}
                        disabled={isSubmitting}
                    />
                    <button
                        className="task-modal-btn primary"
                        onClick={onSendMessage}
                        disabled={isSubmitting || !aiChatInput.trim() || !activeAiThread}
                    >
                        {isSubmitting ? 'Waiting...' : 'Send'}
                    </button>
                </div>
            </div>
        </aside>
    );
}
