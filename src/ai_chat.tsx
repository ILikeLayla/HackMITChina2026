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

interface AiChatModalProps {
    isOpen: boolean;
    isClosing: boolean;
    isSubmitting: boolean;
    aiThreads: AiChatThread[];
    activeAiThreadId: string;
    activeAiThread: AiChatThread | null;
    activeThreadProgress?: AiThreadProgress | null;
    aiChatInput: string;
    aiMessagesEndRef: React.RefObject<HTMLDivElement | null>;
    onBackdropClose: () => void;
    onCreateThread: () => void;
    onSwitchThread: (threadId: string) => void;
    onInputChange: (value: string) => void;
    onSendMessage: () => void;
    onCancelRequest: () => void;
    openTaskModalFromPreview: (taskPreview: AiTaskPreview) => void;
    getTaskStyle: (type: string) => React.CSSProperties;
}

export function AiChatModal({
    isOpen,
    isClosing,
    isSubmitting,
    aiThreads,
    activeAiThreadId,
    activeAiThread,
    activeThreadProgress,
    aiChatInput,
    aiMessagesEndRef,
    onBackdropClose,
    onCreateThread,
    onSwitchThread,
    onInputChange,
    onSendMessage,
    onCancelRequest,
    openTaskModalFromPreview,
    getTaskStyle,
}: AiChatModalProps) {
    const getPreviewTimeText = (task: AiTaskPreview) => {
        if (task.itemKind === 'event') {
            return `${task.startTime || '--:--'} - ${task.endTime || '--:--'}`;
        }
        return `DDL ${task.ddl || '--:--'}`;
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className={`task-modal-backdrop ${isClosing ? 'closing' : ''}`} onClick={onBackdropClose}>
            <div className={`task-modal ai-create-modal ${isClosing ? 'closing' : ''}`} onClick={(event) => event.stopPropagation()}>
                <div className="task-modal-header">
                    <h2>AI Chat Assistant</h2>
                    <button className="task-modal-close" onClick={onBackdropClose}>x</button>
                </div>

                <div className="ai-chat-layout">
                    <div className="ai-thread-sidebar">
                        <div className="ai-thread-sidebar-header">
                            <span>Threads</span>
                            <button className="task-modal-btn" onClick={onCreateThread} disabled={isSubmitting}>New</button>
                        </div>

                        <div className="ai-thread-list">
                            {aiThreads.map(thread => {
                                const latestMessage = thread.messages[thread.messages.length - 1];
                                return (
                                    <button
                                        key={thread.id}
                                        className={`ai-thread-item ${thread.id === activeAiThreadId ? 'active' : ''}`}
                                        onClick={() => onSwitchThread(thread.id)}
                                        disabled={isSubmitting}
                                    >
                                        <div className="ai-thread-item-title">{thread.title}</div>
                                        <div className="ai-thread-item-preview">{latestMessage?.text ?? 'No messages yet.'}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="ai-chat-main">
                        {activeThreadProgress && (
                            <div className={`ai-chat-progress-panel ${activeThreadProgress.isActive ? 'active' : 'done'}`}>
                                <div className="ai-chat-progress-head">
                                    <span>{activeThreadProgress.mode === 'sos' ? 'SOS Planner Progress' : 'AI Progress'}</span>
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
                                placeholder="Type a message, e.g. Schedule focused work blocks for tomorrow morning."
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
                </div>
            </div>
        </div>
    );
}
