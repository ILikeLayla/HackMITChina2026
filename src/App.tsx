import { useEffect, useRef, useState } from "react";
import "./App.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    defaultTypeColors,
    loadTaskTypeColorsFromTempDb,
    loadTasksFromTempDb,
    loadTaskTypesFromTempDb,
    saveTaskTypeColorsToTempDb,
    saveTasksToTempDb,
    saveTaskTypesToTempDb,
} from "./db_utils";
import {
    generateDayViewDOM,
    generateListViewDOM,
    generateMonthViewDOM,
    generateWeekViewDOM,
} from "./dom_generation";
import {
    ADD_TYPE_OPTION_VALUE,
    OTHER_TYPE,
    DATE_SWITCH_ANIMATION_MS,
    VIEW_SWITCH_ANIMATION_MS,
    FILTER_BUTTON_HORIZONTAL_PADDING_PX,
    FILTER_BUTTON_BORDER_PX,
    VIEW_ORDER,
    type ViewMode,
    type DateTransitionDirection,
    type DateTransitionState,
    type ViewTransitionState,
    type SearchScope,
    isSameDay,
    buildShiftedDate,
    filterAndSortTasks,
    getTasksForDayFromTasks,
    groupTasksByDate,
    buildDateString,
} from "./calendar_logic";
import {
    generateCalendarDays,
    generateWeekDays,
    getDayTitle,
    getReadableTextColor,
    getWeekTitle,
    isValidHexColor,
    parseTaskDate,
    type CalendarDay,
    type CalendarTask,
    type TaskType,
} from "./general_utils";
import { SnackbarProvider, closeSnackbar, enqueueSnackbar } from 'notistack';

async function get_events() {
    console.log(await invoke('get_events'));
}

const MODAL_CLOSE_ANIMATION_MS = 180;
const FILTER_REFRESH_ANIMATION_MS = 180;
const AI_REQUEST_TIMEOUT_MS = 180000;

type AiChatRole = 'user' | 'assistant' | 'system';

type AiTaskPreview = {
    id: number;
    title: string;
    date: string;
    time: string;
    type: string;
    note: string;
};

type AiChatMessage = {
    id: string;
    role: AiChatRole;
    text: string;
    createdAt: number;
    taskPreview?: AiTaskPreview;
    taskCards?: AiTaskPreview[];
};

type AiChatThread = {
    id: string;
    title: string;
    messages: AiChatMessage[];
    createdAt: number;
    updatedAt: number;
};

function MainCalendar() {
    const createAiMessageId = () => `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createAiThreadId = () => `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createDefaultAiThread = (): AiChatThread => ({
        id: 'default_thread',
        title: 'Default thread',
        messages: [
            {
                id: createAiMessageId(),
                role: 'assistant',
                text: 'Hello! I can help you manage your calendar. Ask me to create, adjust, or summarize your schedule.',
                createdAt: Date.now(),
            },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });

    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [dateTransition, setDateTransition] = useState<DateTransitionState | null>(null);
    const [viewTransition, setViewTransition] = useState<ViewTransitionState | null>(null);
    const [tasks, setTasks] = useState<CalendarTask[]>(() => loadTasksFromTempDb());
    const [taskTypes, setTaskTypes] = useState<string[]>(() => loadTaskTypesFromTempDb());
    const [taskTypeColors, setTaskTypeColors] = useState<Record<string, string>>(() => loadTaskTypeColorsFromTempDb(loadTaskTypesFromTempDb()));
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
    const [isCreatingTask, setIsCreatingTask] = useState(false);
    const [creatingTaskDate, setCreatingTaskDate] = useState(new Date());
    const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
    const [isTaskModalClosing, setIsTaskModalClosing] = useState(false);
    const [isTypeModalClosing, setIsTypeModalClosing] = useState(false);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isAiModalClosing, setIsAiModalClosing] = useState(false);
    const [isAiSubmitting, setIsAiSubmitting] = useState(false);
    const [aiChatInput, setAiChatInput] = useState('');
    const [aiThreads, setAiThreads] = useState<AiChatThread[]>(() => [createDefaultAiThread()]);
    const [activeAiThreadId, setActiveAiThreadId] = useState('default_thread');
    const [typeModalMode, setTypeModalMode] = useState<'create' | 'edit'>('create');
    const [typeEditingOriginalName, setTypeEditingOriginalName] = useState<string | null>(null);
    const [typeDraftName, setTypeDraftName] = useState('');
    const [typeDraftColor, setTypeDraftColor] = useState('#4f7ef7');
    const [filterType, setFilterType] = useState<string>('all');
    const [filterKeyword, setFilterKeyword] = useState('');
    const [searchScope, setSearchScope] = useState<SearchScope>('all');
    const [isHeaderToolsOpen, setIsHeaderToolsOpen] = useState(false);
    const [isFilterRefreshActive, setIsFilterRefreshActive] = useState(false);
    const [filtersButtonWidth, setFiltersButtonWidth] = useState<number | null>(null);
    const [modalDraft, setModalDraft] = useState<Omit<CalendarTask, 'id' | 'date'> | null>(null);
    const listScrollTargetRef = useRef<HTMLDivElement | null>(null);
    const dateTransitionTimerRef = useRef<number | null>(null);
    const viewTransitionTimerRef = useRef<number | null>(null);
    const taskModalCloseTimerRef = useRef<number | null>(null);
    const typeModalCloseTimerRef = useRef<number | null>(null);
    const aiModalCloseTimerRef = useRef<number | null>(null);
    const filterRefreshTimerRef = useRef<number | null>(null);
    const filterRefreshRafRef = useRef<number | null>(null);
    const hasMountedFilterControlsRef = useRef(false);
    const filtersButtonMeasureRef = useRef<HTMLSpanElement | null>(null);

    const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? null;
    const nextTaskId = tasks.reduce((maxId, task) => Math.max(maxId, task.id), 0) + 1;

    const ws = useRef<WebSocket | null>(null);
    const createdTaskAckResult = useRef<string | null>(null);
    const hasEverConnectedWsRef = useRef(false);
    const isUnmountingRef = useRef(false);
    const taskTypesRef = useRef(taskTypes);
    const tasksRef = useRef(tasks);
    const taskTypeColorsRef = useRef(taskTypeColors);
    const nextTaskIdRef = useRef(nextTaskId);
    const wsDisconnectedSnackbarIdRef = useRef<string | number | null>(null);
    const wsReconnectingSnackbarIdRef = useRef<string | number | null>(null);
    const aiResultPollTimerRef = useRef<number | null>(null);
    const aiRequestDeadlineRef = useRef<number | null>(null);
    const activeAiThreadIdRef = useRef(activeAiThreadId);
    const pendingAiRequestThreadIdRef = useRef<string | null>(null);
    const isManualWsCloseRef = useRef(false);
    const isAiSubmittingRef = useRef(false);
    const isWindowCloseCleanupRunningRef = useRef(false);
    const hasWindowDestroyBeenRequestedRef = useRef(false);
    const aiMessagesEndRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        taskTypesRef.current = taskTypes;
    }, [taskTypes]);

    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        taskTypeColorsRef.current = taskTypeColors;
    }, [taskTypeColors]);

    useEffect(() => {
        nextTaskIdRef.current = nextTaskId;
    }, [nextTaskId]);

    useEffect(() => {
        isAiSubmittingRef.current = isAiSubmitting;
    }, [isAiSubmitting]);

    useEffect(() => {
        activeAiThreadIdRef.current = activeAiThreadId;
    }, [activeAiThreadId]);

    const clearAiResultPollTimer = () => {
        if (aiResultPollTimerRef.current !== null) {
            window.clearTimeout(aiResultPollTimerRef.current);
            aiResultPollTimerRef.current = null;
        }
    };

    const stopAiSubmitting = (options?: { closeConnection?: boolean }) => {
        clearAiResultPollTimer();
        aiRequestDeadlineRef.current = null;
        pendingAiRequestThreadIdRef.current = null;
        setIsAiSubmitting(false);

        if (options?.closeConnection) {
            const socket = ws.current;
            if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                isManualWsCloseRef.current = true;
                socket.close(1000, 'AI request canceled by user');
                ws.current = null;
            }
        }
    };

    const cancelActiveAiRequest = (reasonMessage: string) => {
        if (!isAiSubmittingRef.current) {
            return;
        }

        const pendingThreadId = pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current;
        appendMessageToThread(pendingThreadId, 'system', reasonMessage);
        stopAiSubmitting({ closeConnection: true });
    };

    const appendMessageToThread = (
        threadId: string,
        role: AiChatRole,
        text: string,
        options?: { taskPreview?: AiTaskPreview; taskCards?: AiTaskPreview[] },
    ) => {
        const createdAt = Date.now();
        setAiThreads(prev => prev.map(thread => (
            thread.id === threadId
                ? {
                    ...thread,
                    messages: [
                        ...thread.messages,
                        {
                            id: createAiMessageId(),
                            role,
                            text,
                            createdAt,
                            ...(options?.taskPreview ? { taskPreview: options.taskPreview } : {}),
                            ...(options?.taskCards ? { taskCards: options.taskCards } : {}),
                        },
                    ],
                    updatedAt: createdAt,
                }
                : thread
        )));
    };

    const appendTaskEventMessageToActiveThread = (
        message: string,
        task?: CalendarTask,
    ) => {
        const targetThreadId = pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current;
        appendMessageToThread(
            targetThreadId,
            'system',
            message,
            task
                ? {
                    taskPreview: {
                        id: task.id,
                        title: task.title,
                        date: task.date,
                        time: task.time,
                        type: task.type,
                        note: task.note,
                    },
                }
                : undefined,
        );
    };

    const updateThreadTitleFromFirstUserMessage = (threadId: string, messageText: string) => {
        const normalized = messageText.trim();
        if (!normalized) {
            return;
        }

        const nextTitle = normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
        setAiThreads(prev => prev.map(thread => {
            if (thread.id !== threadId) {
                return thread;
            }
            if (thread.title !== 'Default thread' && thread.title !== 'New thread') {
                return thread;
            }
            return {
                ...thread,
                title: nextTitle,
            };
        }));
    };

    const clearWsDisconnectedSnackbar = () => {
        if (wsDisconnectedSnackbarIdRef.current !== null) {
            closeSnackbar(wsDisconnectedSnackbarIdRef.current);
            wsDisconnectedSnackbarIdRef.current = null;
        }
    };

    const clearWsReconnectingSnackbar = () => {
        if (wsReconnectingSnackbarIdRef.current !== null) {
            closeSnackbar(wsReconnectingSnackbarIdRef.current);
            wsReconnectingSnackbarIdRef.current = null;
        }
    };

    const enqueueWsReconnectingSnackbar = () => {
        if (wsReconnectingSnackbarIdRef.current !== null) {
            return;
        }

        const snackbarId = enqueueSnackbar('Reconnecting to AI service...', {
            variant: 'info',
            persist: true,
            onClose: () => {
                wsReconnectingSnackbarIdRef.current = null;
            },
        });

        wsReconnectingSnackbarIdRef.current = snackbarId;
    };

    const enqueueWsDisconnectedSnackbar = () => {
        if (wsDisconnectedSnackbarIdRef.current !== null) {
            return;
        }

        const snackbarId = enqueueSnackbar('WebSocket connection lost.', {
            variant: 'warning',
            persist: true,
            action: (id) => (
                <div className="snackbar-action-group">
                    <button
                        className="task-modal-btn snackbar-action-btn snackbar-action-btn-reconnect"
                        onClick={() => {
                            closeSnackbar(id);
                            wsDisconnectedSnackbarIdRef.current = null;
                            enqueueWsReconnectingSnackbar();
                            connectWebSocket();
                        }}
                    >
                        Reconnect
                    </button>
                    <button
                        className="task-modal-btn snackbar-action-btn snackbar-action-btn-dismiss"
                        onClick={() => {
                            closeSnackbar(id);
                            wsDisconnectedSnackbarIdRef.current = null;
                        }}
                    >
                        Dismiss
                    </button>
                </div>
            ),
            onClose: () => {
                wsDisconnectedSnackbarIdRef.current = null;
            },
        });

        wsDisconnectedSnackbarIdRef.current = snackbarId;
    };

    const requestServerShutdown = async () => {
        const sendShutdownWithAck = (socket: WebSocket, closeAfterAck: boolean) => {
            return new Promise<boolean>((resolve) => {
                let settled = false;

                const finish = (ok: boolean) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    window.clearTimeout(timeoutId);
                    socket.removeEventListener('message', handleAckMessage);
                    socket.removeEventListener('close', handleSocketClose);
                    socket.removeEventListener('error', handleSocketError);
                    if (closeAfterAck) {
                        try {
                            socket.close(1000, 'shutdown ack handled');
                        } catch {
                            // ignore close errors on temp socket
                        }
                    }
                    resolve(ok);
                };

                const handleAckMessage = (event: MessageEvent) => {
                    if (event.data === 'shutdown_ack') {
                        finish(true);
                    }
                };

                const handleSocketClose = () => {
                    finish(false);
                };

                const handleSocketError = () => {
                    finish(false);
                };

                const timeoutId = window.setTimeout(() => {
                    finish(false);
                }, 3000);

                socket.addEventListener('message', handleAckMessage);
                socket.addEventListener('close', handleSocketClose);
                socket.addEventListener('error', handleSocketError);

                try {
                    socket.send('shutdown_server:window_close');
                } catch {
                    finish(false);
                }
            });
        };

        const mainSocket = ws.current;
        if (mainSocket && mainSocket.readyState === WebSocket.OPEN) {
            const acknowledged = await sendShutdownWithAck(mainSocket, false);
            if (acknowledged) {
                return true;
            }
        }

        const tempSocket = await new Promise<WebSocket | null>((resolve) => {
            let done = false;
            const socket = new WebSocket('ws://localhost:8765');

            const finish = (result: WebSocket | null) => {
                if (done) {
                    return;
                }
                done = true;
                window.clearTimeout(timeoutId);
                socket.removeEventListener('open', handleOpen);
                socket.removeEventListener('error', handleError);
                resolve(result);
            };

            const handleOpen = () => finish(socket);
            const handleError = () => finish(null);

            const timeoutId = window.setTimeout(() => finish(null), 1500);
            socket.addEventListener('open', handleOpen, { once: true });
            socket.addEventListener('error', handleError, { once: true });
        });

        if (!tempSocket) {
            return false;
        }

        return await sendShutdownWithAck(tempSocket, true);
    };

    const connectWebSocket = () => {
        const existing = ws.current;
        if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const socket = new WebSocket('ws://localhost:8765');
        ws.current = socket;

        const handleMessage = (event: MessageEvent) => {
            console.log('Received message from WebSocket:', event.data);
            // start with "newing_task: " followed by a date string in json format
            if (typeof event.data === 'string' && event.data.startsWith('newing_task: ')) {
                console.log('Handling newing_task message');
                const task_info = JSON.parse(event.data.substring('newing_task: '.length));
                const date = task_info.date ? new Date(task_info.date) : new Date();
                const title = task_info.title || '';
                // check if type is valid, otherwise create a new type with random color
                let type = task_info.type || 'other';
                if (!taskTypesRef.current.includes(type)) {
                    const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
                    setTaskTypes(prev => [...prev, type]);
                    setTaskTypeColors(prev => ({
                        ...prev,
                        [type]: randomColor,
                    }));
                }

                const time = task_info.time || '';
                const note = task_info.note || '';
                const computedTaskId = nextTaskIdRef.current;
                nextTaskIdRef.current = computedTaskId + 1;
                const newTask: CalendarTask = {
                    id: computedTaskId,
                    title,
                    type,
                    time,
                    note,
                    date: buildDateString(date),
                };

                setTasks(prev => [...prev, newTask]);
                if (isAiSubmittingRef.current) {
                    aiRequestDeadlineRef.current = Date.now() + AI_REQUEST_TIMEOUT_MS;
                }
                console.log('Created new task from WebSocket message:', newTask);
                createdTaskAckResult.current = null;
                ws.current?.send(`created_task: ${JSON.stringify(newTask)}`);
                // disable the handler and listen for "Acknowledged task creation result" text in ws here, if not recieved within 1 second, resend. repeat 5 times.
                let resendAttempts = 0;
                const waitForAcknowledgement = () => {
                    if (createdTaskAckResult.current === 'Acknowledged task creation result') {
                        console.log('Received acknowledgement for task creation result');
                        createdTaskAckResult.current = null;
                        return;
                    }
                    if (resendAttempts >= 10) {
                        console.warn('Did not receive acknowledgement for task creation result after 10 attempts, giving up');
                        return;
                    }
                    resendAttempts++;
                    console.warn(`Did not receive acknowledgement for task creation result, resending... (attempt ${resendAttempts})`);
                    ws.current?.send(`created_task: ${JSON.stringify(newTask)}`);
                    setTimeout(waitForAcknowledgement, 2000);
                };
                waitForAcknowledgement();
                appendTaskEventMessageToActiveThread(`AI created a new task: ${title || '(untitled task)'}`, newTask);
            } 

            if (typeof event.data === 'string' && event.data.startsWith('ack_created_task: ')) {
                console.log('Handling ack_created_task message');
                createdTaskAckResult.current = event.data.substring('ack_created_task: '.length);
            }

            if (typeof event.data === 'string' && event.data.startsWith('task_creation_result: ')) {
                console.log('Handling task_creation_result message');
                const resultText = event.data.substring('task_creation_result: '.length);
                const targetThreadId = pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current;
                appendMessageToThread(targetThreadId, 'assistant', resultText || 'AI finished, but returned an empty result.');
                if (isAiSubmittingRef.current) {
                    stopAiSubmitting();
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('get_all_tasks: ')) {
                const payloadText = event.data.substring('get_all_tasks: '.length);
                try {
                    const payload = JSON.parse(payloadText) as { request_id?: string };
                    if (!payload.request_id) {
                        return;
                    }

                    const lightweightTasks = tasksRef.current.map(task => ({
                        id: task.id,
                        title: task.title,
                        date: task.date,
                        time: task.time,
                        type: task.type,
                    }));

                    ws.current?.send(`all_tasks_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        tasks: lightweightTasks,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse get_all_tasks payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('get_task_by_id: ')) {
                const payloadText = event.data.substring('get_task_by_id: '.length);
                try {
                    const payload = JSON.parse(payloadText) as { request_id?: string; task_id?: number | string };
                    if (!payload.request_id) {
                        return;
                    }

                    const taskId = Number(payload.task_id);
                    const matchedTask = Number.isFinite(taskId)
                        ? tasksRef.current.find(task => task.id === taskId) ?? null
                        : null;

                    ws.current?.send(`task_by_id_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        task: matchedTask,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse get_task_by_id payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('update_task: ')) {
                const payloadText = event.data.substring('update_task: '.length);
                try {
                    const payload = JSON.parse(payloadText) as {
                        request_id?: string;
                        task_id?: number | string;
                        updates?: Partial<CalendarTask>;
                    };

                    if (!payload.request_id) {
                        return;
                    }

                    const taskId = Number(payload.task_id);
                    if (!Number.isFinite(taskId) || !payload.updates || typeof payload.updates !== 'object') {
                        ws.current?.send(`update_task_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: 'Invalid task update payload.',
                        })}`);
                        return;
                    }

                    const existingTask = tasksRef.current.find(task => task.id === taskId) ?? null;
                    if (!existingTask) {
                        ws.current?.send(`update_task_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: `Task with id ${taskId} not found.`,
                        })}`);
                        return;
                    }

                    const updatedTask: CalendarTask = {
                        ...existingTask,
                        ...(payload.updates?.title !== undefined ? { title: String(payload.updates.title) } : {}),
                        ...(payload.updates?.date !== undefined ? { date: String(payload.updates.date) } : {}),
                        ...(payload.updates?.type !== undefined ? { type: String(payload.updates.type) } : {}),
                        ...(payload.updates?.time !== undefined ? { time: String(payload.updates.time) } : {}),
                        ...(payload.updates?.note !== undefined ? { note: String(payload.updates.note) } : {}),
                    };

                    setTasks(prev => prev.map(task => task.id === taskId ? updatedTask : task));

                    if (!taskTypesRef.current.includes(updatedTask.type)) {
                        setTaskTypes(prev => [...prev, updatedTask.type]);
                        setTaskTypeColors(prev => ({
                            ...prev,
                            [updatedTask.type]: prev[updatedTask.type] ?? defaultTypeColors[OTHER_TYPE],
                        }));
                    }

                    appendTaskEventMessageToActiveThread(
                        `AI updated task #${updatedTask.id}: ${updatedTask.title}`,
                        updatedTask,
                    );

                    ws.current?.send(`update_task_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        task: updatedTask,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse update_task payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('delete_task: ')) {
                const payloadText = event.data.substring('delete_task: '.length);
                try {
                    const payload = JSON.parse(payloadText) as { request_id?: string; task_id?: number | string };
                    if (!payload.request_id) {
                        return;
                    }

                    const taskId = Number(payload.task_id);
                    if (!Number.isFinite(taskId)) {
                        ws.current?.send(`delete_task_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: 'Invalid task id.',
                        })}`);
                        return;
                    }

                    const existingTask = tasksRef.current.find(task => task.id === taskId) ?? null;
                    if (!existingTask) {
                        ws.current?.send(`delete_task_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: `Task with id ${taskId} not found.`,
                        })}`);
                        return;
                    }

                    setTasks(prev => prev.filter(task => task.id !== taskId));
                    appendTaskEventMessageToActiveThread(
                        `AI deleted task #${existingTask.id}: ${existingTask.title}`,
                    );
                    ws.current?.send(`delete_task_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        task: existingTask,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse delete_task payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('update_task_type_color: ')) {
                const payloadText = event.data.substring('update_task_type_color: '.length);
                try {
                    const payload = JSON.parse(payloadText) as { request_id?: string; task_type?: string; color?: string };
                    if (!payload.request_id) {
                        return;
                    }

                    const taskType = (payload.task_type ?? '').trim().toLowerCase();
                    const color = (payload.color ?? '').trim();
                    if (!taskType || !isValidHexColor(color)) {
                        ws.current?.send(`update_task_type_color_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: 'Invalid task_type or color.',
                        })}`);
                        return;
                    }

                    if (!taskTypesRef.current.includes(taskType)) {
                        setTaskTypes(prev => [...prev, taskType]);
                    }

                    setTaskTypeColors(prev => ({
                        ...prev,
                        [taskType]: color,
                    }));

                    appendMessageToThread(
                        pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current,
                        'system',
                        `AI updated type color: ${taskType} -> ${color}`,
                    );

                    ws.current?.send(`update_task_type_color_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        task_type: taskType,
                        color,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse update_task_type_color payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('rename_task_type: ')) {
                const payloadText = event.data.substring('rename_task_type: '.length);
                try {
                    const payload = JSON.parse(payloadText) as {
                        request_id?: string;
                        old_task_type?: string;
                        new_task_type?: string;
                        new_color?: string;
                    };
                    if (!payload.request_id) {
                        return;
                    }

                    const oldType = (payload.old_task_type ?? '').trim().toLowerCase();
                    const newType = (payload.new_task_type ?? '').trim().toLowerCase();
                    const newColor = (payload.new_color ?? '').trim();

                    if (!oldType || !newType) {
                        ws.current?.send(`rename_task_type_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: 'Both old_task_type and new_task_type are required.',
                        })}`);
                        return;
                    }

                    if (!taskTypesRef.current.includes(oldType)) {
                        ws.current?.send(`rename_task_type_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: `Type ${oldType} does not exist.`,
                        })}`);
                        return;
                    }

                    if (oldType !== newType && taskTypesRef.current.includes(newType)) {
                        ws.current?.send(`rename_task_type_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: `Type ${newType} already exists.`,
                        })}`);
                        return;
                    }

                    const movedCount = tasksRef.current.filter(task => task.type === oldType).length;

                    setTaskTypes(prev => prev.map(type => (type === oldType ? newType : type)));
                    setTaskTypeColors(prev => {
                        const next = { ...prev };
                        const previousColor = next[oldType] ?? defaultTypeColors[OTHER_TYPE];
                        delete next[oldType];
                        next[newType] = isValidHexColor(newColor) ? newColor : previousColor;
                        return next;
                    });
                    setTasks(prev => prev.map(task => (
                        task.type === oldType
                            ? { ...task, type: newType }
                            : task
                    )));
                    setModalDraft(prev => (
                        prev && prev.type === oldType
                            ? { ...prev, type: newType }
                            : prev
                    ));
                    setFilterType(prev => (prev === oldType ? newType : prev));

                    appendMessageToThread(
                        pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current,
                        'system',
                        `AI renamed type ${oldType} to ${newType}. Moved ${movedCount} task(s).`,
                    );

                    ws.current?.send(`rename_task_type_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        old_task_type: oldType,
                        new_task_type: newType,
                        moved_count: movedCount,
                        color: isValidHexColor(newColor)
                            ? newColor
                            : (taskTypeColorsRef.current[oldType] ?? defaultTypeColors[OTHER_TYPE]),
                    })}`);
                } catch (error) {
                    console.error('Failed to parse rename_task_type payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('delete_task_type: ')) {
                const payloadText = event.data.substring('delete_task_type: '.length);
                try {
                    const payload = JSON.parse(payloadText) as {
                        request_id?: string;
                        task_type?: string;
                        move_to_type?: string;
                    };
                    if (!payload.request_id) {
                        return;
                    }

                    const targetType = (payload.task_type ?? '').trim().toLowerCase();
                    const moveToType = (payload.move_to_type ?? OTHER_TYPE).trim().toLowerCase() || OTHER_TYPE;

                    if (!targetType) {
                        ws.current?.send(`delete_task_type_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: 'task_type is required.',
                        })}`);
                        return;
                    }

                    if (targetType === OTHER_TYPE) {
                        ws.current?.send(`delete_task_type_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: `Type ${OTHER_TYPE} cannot be deleted.`,
                        })}`);
                        return;
                    }

                    if (!taskTypesRef.current.includes(targetType)) {
                        ws.current?.send(`delete_task_type_result: ${JSON.stringify({
                            request_id: payload.request_id,
                            ok: false,
                            message: `Type ${targetType} does not exist.`,
                        })}`);
                        return;
                    }

                    const movedCount = tasksRef.current.filter(task => task.type === targetType).length;

                    setTaskTypes(prev => {
                        const withoutDeleted = prev.filter(type => type !== targetType);
                        return withoutDeleted.includes(moveToType)
                            ? withoutDeleted
                            : [...withoutDeleted, moveToType];
                    });
                    setTaskTypeColors(prev => {
                        const next = { ...prev };
                        delete next[targetType];
                        next[moveToType] = next[moveToType] ?? defaultTypeColors[OTHER_TYPE];
                        return next;
                    });
                    setTasks(prev => prev.map(task => (
                        task.type === targetType
                            ? { ...task, type: moveToType }
                            : task
                    )));
                    setModalDraft(prev => (
                        prev && prev.type === targetType
                            ? { ...prev, type: moveToType }
                            : prev
                    ));
                    setFilterType(prev => (prev === targetType ? moveToType : prev));

                    appendMessageToThread(
                        pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current,
                        'system',
                        `AI deleted type ${targetType}. Moved ${movedCount} task(s) to ${moveToType}.`,
                    );

                    ws.current?.send(`delete_task_type_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        task_type: targetType,
                        move_to_type: moveToType,
                        moved_count: movedCount,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse delete_task_type payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('get_task_type_colors: ')) {
                const payloadText = event.data.substring('get_task_type_colors: '.length);
                try {
                    const payload = JSON.parse(payloadText) as { request_id?: string };
                    if (!payload.request_id) {
                        return;
                    }

                    ws.current?.send(`task_type_colors_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        colors: taskTypeColorsRef.current,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse get_task_type_colors payload:', error);
                }
            }

            if (typeof event.data === 'string' && event.data.startsWith('show_task_cards: ')) {
                const payloadText = event.data.substring('show_task_cards: '.length);
                try {
                    const payload = JSON.parse(payloadText) as {
                        request_id?: string;
                        task_ids?: Array<number | string> | string;
                        task_type?: string;
                        date?: string;
                        limit?: number;
                        intro?: string;
                    };
                    if (!payload.request_id) {
                        return;
                    }

                    let candidates = [...tasksRef.current];

                    const idsRaw = payload.task_ids;
                    const parsedIds = Array.isArray(idsRaw)
                        ? idsRaw
                        : typeof idsRaw === 'string'
                            ? idsRaw.split(',').map(token => token.trim()).filter(Boolean)
                            : [];

                    if (parsedIds.length > 0) {
                        const idSet = new Set(
                            parsedIds
                                .map(id => Number(id))
                                .filter(id => Number.isFinite(id)),
                        );
                        candidates = candidates.filter(task => idSet.has(task.id));
                    }

                    const typeFilter = (payload.task_type ?? '').trim().toLowerCase();
                    if (typeFilter) {
                        candidates = candidates.filter(task => task.type === typeFilter);
                    }

                    const dateFilter = (payload.date ?? '').trim();
                    if (dateFilter) {
                        candidates = candidates.filter(task => task.date === dateFilter);
                    }

                    const limit = Math.max(1, Math.min(12, Number(payload.limit) || 6));
                    const selected = candidates.slice(0, limit);

                    const taskCards: AiTaskPreview[] = selected.map(task => ({
                        id: task.id,
                        title: task.title,
                        date: task.date,
                        time: task.time,
                        type: task.type,
                        note: task.note,
                    }));

                    appendMessageToThread(
                        pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current,
                        'assistant',
                        (payload.intro ?? '').trim() || 'Here are some related tasks:',
                        { taskCards },
                    );

                    ws.current?.send(`show_task_cards_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: true,
                        count: taskCards.length,
                    })}`);
                } catch (error) {
                    console.error('Failed to parse show_task_cards payload:', error);
                }
            }
        };

        const handleOpen = () => {
            hasEverConnectedWsRef.current = true;
            clearWsDisconnectedSnackbar();
            clearWsReconnectingSnackbar();
            enqueueSnackbar('AI service connected.', { variant: 'success' });
        };

        const handleClose = () => {
            const wasManualClose = isManualWsCloseRef.current;
            if (wasManualClose) {
                isManualWsCloseRef.current = false;
            }

            if (ws.current === socket) {
                ws.current = null;
            }

            clearWsReconnectingSnackbar();

            if (wasManualClose) {
                if (!isUnmountingRef.current) {
                    enqueueSnackbar('Connection closed.', { variant: 'default' });
                    connectWebSocket();
                }
                return;
            }

            if (isAiSubmittingRef.current) {
                const pendingThreadId = pendingAiRequestThreadIdRef.current;
                if (pendingThreadId) {
                    appendMessageToThread(pendingThreadId, 'system', 'Connection was lost while waiting for AI response.');
                }
                stopAiSubmitting();
                enqueueSnackbar('Connection lost while waiting for AI response.', { variant: 'warning' });
            }

            if (!isUnmountingRef.current) {
                enqueueWsDisconnectedSnackbar();
            }
        };

        const handleError = () => {
            clearWsReconnectingSnackbar();
            if (isAiSubmittingRef.current) {
                const pendingThreadId = pendingAiRequestThreadIdRef.current;
                if (pendingThreadId) {
                    appendMessageToThread(pendingThreadId, 'system', 'Connection error occurred while waiting for AI response.');
                }
                stopAiSubmitting();
                enqueueSnackbar('Connection error while waiting for AI response.', { variant: 'warning' });
            }
            if (!isUnmountingRef.current) {
                enqueueWsDisconnectedSnackbar();
            }
        };

        socket.addEventListener('message', handleMessage);
        socket.addEventListener('open', handleOpen);
        socket.addEventListener('close', handleClose);
        socket.addEventListener('error', handleError);
    };

    useEffect(() => {
        isUnmountingRef.current = false;
        connectWebSocket();

        return () => {
            isUnmountingRef.current = true;
            stopAiSubmitting();
            clearWsDisconnectedSnackbar();
            clearWsReconnectingSnackbar();
            ws.current?.close();
            ws.current = null;
        };
    }, []);

    useEffect(() => {
        const appWindow = getCurrentWindow();
        let unlisten: (() => void) | null = null;

        const setupCloseHandler = async () => {
            unlisten = await appWindow.onCloseRequested(async (event) => {
                if (hasWindowDestroyBeenRequestedRef.current) {
                    return;
                }
                if (isWindowCloseCleanupRunningRef.current) {
                    event.preventDefault();
                    return;
                }

                event.preventDefault();
                isWindowCloseCleanupRunningRef.current = true;
                isUnmountingRef.current = true;

                await requestServerShutdown();

                stopAiSubmitting();
                clearWsDisconnectedSnackbar();
                clearWsReconnectingSnackbar();

                const socket = ws.current;
                if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                    isManualWsCloseRef.current = true;
                    socket.close(1000, 'Window closing');
                }
                ws.current = null;

                hasWindowDestroyBeenRequestedRef.current = true;
                try {
                    await appWindow.close();
                } catch (closeError) {
                    console.error('appWindow.close failed during shutdown cleanup:', closeError);
                    try {
                        await appWindow.destroy();
                    } catch (destroyError) {
                        console.error('appWindow.destroy failed during shutdown cleanup:', destroyError);
                        hasWindowDestroyBeenRequestedRef.current = false;
                        isWindowCloseCleanupRunningRef.current = false;
                        isUnmountingRef.current = false;
                    }
                }
            });
        };

        void setupCloseHandler();

        return () => {
            if (unlisten) {
                unlisten();
            }
        };
    }, []);

    const cancelDateTransition = () => {
        if (dateTransitionTimerRef.current !== null) {
            window.clearTimeout(dateTransitionTimerRef.current);
            dateTransitionTimerRef.current = null;
        }

        setDateTransition(null);
    };

    const cancelViewTransition = () => {
        if (viewTransitionTimerRef.current !== null) {
            window.clearTimeout(viewTransitionTimerRef.current);
            viewTransitionTimerRef.current = null;
        }

        setViewTransition(null);
    };

    const clearTaskModalCloseTimer = () => {
        if (taskModalCloseTimerRef.current !== null) {
            window.clearTimeout(taskModalCloseTimerRef.current);
            taskModalCloseTimerRef.current = null;
        }
    };

    const clearTypeModalCloseTimer = () => {
        if (typeModalCloseTimerRef.current !== null) {
            window.clearTimeout(typeModalCloseTimerRef.current);
            typeModalCloseTimerRef.current = null;
        }
    };

    const clearAiModalCloseTimer = () => {
        if (aiModalCloseTimerRef.current !== null) {
            window.clearTimeout(aiModalCloseTimerRef.current);
            aiModalCloseTimerRef.current = null;
        }
    };

    const clearFilterRefreshAnimation = () => {
        if (filterRefreshTimerRef.current !== null) {
            window.clearTimeout(filterRefreshTimerRef.current);
            filterRefreshTimerRef.current = null;
        }

        if (filterRefreshRafRef.current !== null) {
            window.cancelAnimationFrame(filterRefreshRafRef.current);
            filterRefreshRafRef.current = null;
        }
    };

    const startDateTransition = (targetDate: Date, direction: DateTransitionDirection) => {
        if (viewMode === 'list') {
            setCurrentDate(new Date(targetDate));
            return;
        }

        cancelDateTransition();
        const frozenTargetDate = new Date(targetDate);
        setDateTransition({
            direction,
            nextDate: frozenTargetDate,
        });
        dateTransitionTimerRef.current = window.setTimeout(() => {
            setCurrentDate(frozenTargetDate);
            setDateTransition(null);
            dateTransitionTimerRef.current = null;
        }, DATE_SWITCH_ANIMATION_MS);
    };

    const handlePrevMonth = () => {
        if (dateTransition || viewTransition) {
            return;
        }
        const newDate = buildShiftedDate(currentDate, -1, viewMode);
        startDateTransition(newDate, 'backward');
    };

    const handleNextMonth = () => {
        if (dateTransition || viewTransition) {
            return;
        }
        const newDate = buildShiftedDate(currentDate, 1, viewMode);
        startDateTransition(newDate, 'forward');
    };

    const handleToday = () => {
        if (viewMode === 'list') {
            requestAnimationFrame(() => {
                const target = listScrollTargetRef.current;
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            return;
        }

        if (dateTransition || viewTransition) {
            return;
        }

        const targetDate = new Date();
        if (isSameDay(currentDate, targetDate)) {
            return;
        }

        const direction: DateTransitionDirection = targetDate.getTime() >= currentDate.getTime() ? 'forward' : 'backward';
        startDateTransition(targetDate, direction);
    };

    const handleViewChange = (mode: ViewMode) => {
        if (mode === viewMode || viewTransition) {
            return;
        }

        const currentIndex = VIEW_ORDER.indexOf(viewMode);
        const nextIndex = VIEW_ORDER.indexOf(mode);
        const direction: DateTransitionDirection = nextIndex >= currentIndex ? 'forward' : 'backward';

        cancelDateTransition();
        cancelViewTransition();
        setViewTransition({
            fromMode: viewMode,
            toMode: mode,
            direction,
        });

        viewTransitionTimerRef.current = window.setTimeout(() => {
            setViewMode(mode);
            setViewTransition(null);
            viewTransitionTimerRef.current = null;
        }, VIEW_SWITCH_ANIMATION_MS);
    };

    useEffect(() => {
        void get_events();
    }, []);

    useEffect(() => {
        return () => {
            if (dateTransitionTimerRef.current !== null) {
                window.clearTimeout(dateTransitionTimerRef.current);
            }

            cancelViewTransition();
            clearTaskModalCloseTimer();
            clearTypeModalCloseTimer();
            clearAiModalCloseTimer();
            clearFilterRefreshAnimation();
        };
    }, []);

    useEffect(() => {
        cancelDateTransition();
    }, [viewMode]);

    useEffect(() => {
        saveTasksToTempDb(tasks);
    }, [tasks]);

    useEffect(() => {
        saveTaskTypesToTempDb(taskTypes);
    }, [taskTypes]);

    useEffect(() => {
        saveTaskTypeColorsToTempDb(taskTypeColors);
    }, [taskTypeColors]);

    useEffect(() => {
        if (!filtersButtonMeasureRef.current) {
            return;
        }

        const textWidth = Math.ceil(filtersButtonMeasureRef.current.getBoundingClientRect().width);
        setFiltersButtonWidth(textWidth + FILTER_BUTTON_HORIZONTAL_PADDING_PX + FILTER_BUTTON_BORDER_PX);
    }, [isHeaderToolsOpen]);

    useEffect(() => {
        if (!hasMountedFilterControlsRef.current) {
            hasMountedFilterControlsRef.current = true;
            return;
        }

        clearFilterRefreshAnimation();
        setIsFilterRefreshActive(false);

        filterRefreshRafRef.current = window.requestAnimationFrame(() => {
            setIsFilterRefreshActive(true);
            filterRefreshTimerRef.current = window.setTimeout(() => {
                setIsFilterRefreshActive(false);
                filterRefreshTimerRef.current = null;
            }, FILTER_REFRESH_ANIMATION_MS);
            filterRefreshRafRef.current = null;
        });
    }, [filterType, filterKeyword, searchScope]);

    const renderViewContent = (mode: ViewMode, displayDate: Date) => {
        if (mode === 'list') {
            return generateListViewDOM({
                listTaskGroups,
                listScrollTargetRef,
                getTaskStyle,
                openTaskModal,
            });
        }

        if (mode === 'day') {
            return generateDayViewDOM({
                currentDate: displayDate,
                getTasksForDay,
                getTaskStyle,
                openTaskModal,
            });
        }

        if (mode === 'week') {
            return generateWeekViewDOM({
                weekDays: generateWeekDays(displayDate),
                getTasksForDay,
                getTaskStyle,
                openTaskModal,
                handleDayClick,
            });
        }

        return generateMonthViewDOM({
            calendarDays: generateCalendarDays(displayDate),
            getTasksForDay,
            getTaskStyle,
            openTaskModal,
            handleDayClick,
        });
    };

    const filteredAndSortedTasks = filterAndSortTasks(tasks, filterType, filterKeyword, searchScope);

    const getTasksForDay = (day: CalendarDay) => {
        return getTasksForDayFromTasks(filteredAndSortedTasks, day);
    };

    const listTaskGroups = groupTasksByDate(filteredAndSortedTasks);

    useEffect(() => {
        if (viewMode !== 'list') {
            return;
        }

        const target = listScrollTargetRef.current;
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [viewMode]);

    useEffect(() => {
        const selectors = '.days, .day-view-tasks';
        const scrollElements = Array.from(document.querySelectorAll<HTMLElement>(selectors));
        if (scrollElements.length === 0) {
            return;
        }

        const cleanups: Array<() => void> = [];

        scrollElements.forEach((element) => {
            const isDayViewTasks = element.classList.contains('day-view-tasks');
            const indicatorHost = isDayViewTasks
                ? element.closest<HTMLElement>('.day-view')
                : element.parentElement;
            if (!indicatorHost) {
                return;
            }

            const updateIndicator = () => {
                const maxScroll = element.scrollHeight - element.clientHeight;
                let trackTopPx = 4;
                let trackBottomPx = 4;

                if (isDayViewTasks) {
                    const hostRect = indicatorHost.getBoundingClientRect();
                    const elementRect = element.getBoundingClientRect();
                    const dayTasksTop = elementRect.top - hostRect.top;
                    const dayTasksBottom = dayTasksTop + element.clientHeight;
                    trackTopPx = dayTasksTop + 4;
                    trackBottomPx = Math.max(4, indicatorHost.clientHeight - dayTasksBottom + 4);
                }

                const trackLength = Math.max(0, indicatorHost.clientHeight - trackTopPx - trackBottomPx);
                indicatorHost.style.setProperty('--scroll-indicator-track-top', `${trackTopPx}px`);
                indicatorHost.style.setProperty('--scroll-indicator-track-bottom', `${trackBottomPx}px`);

                if (maxScroll <= 1 || trackLength <= 0) {
                    indicatorHost.style.setProperty('--scroll-indicator-opacity', '0');
                    indicatorHost.style.setProperty('--scroll-indicator-size', '0px');
                    indicatorHost.style.setProperty('--scroll-indicator-offset', `${trackTopPx}px`);
                    return;
                }

                const minThumbSize = 22;
                const rawThumbSize = (element.clientHeight / element.scrollHeight) * trackLength;
                const thumbSize = Math.min(trackLength, Math.max(minThumbSize, rawThumbSize));
                const maxThumbTravel = Math.max(0, trackLength - thumbSize);
                const clampedScrollTop = Math.min(maxScroll, Math.max(0, element.scrollTop));
                const scrollProgress = maxScroll > 0 ? clampedScrollTop / maxScroll : 0;
                const clampedProgress = Math.min(1, Math.max(0, scrollProgress));
                const thumbTravel = Math.min(maxThumbTravel, Math.max(0, maxThumbTravel * clampedProgress));
                const thumbOffset = trackTopPx + thumbTravel;

                indicatorHost.style.setProperty('--scroll-indicator-opacity', '1');
                indicatorHost.style.setProperty('--scroll-indicator-size', `${thumbSize}px`);
                indicatorHost.style.setProperty('--scroll-indicator-offset', `${thumbOffset}px`);
            };

            const handleScroll = () => {
                updateIndicator();
            };

            indicatorHost.classList.add('has-custom-scroll-indicator');
            element.addEventListener('scroll', handleScroll, { passive: true });

            const resizeObserver = new ResizeObserver(() => {
                updateIndicator();
            });
            resizeObserver.observe(element);
            resizeObserver.observe(indicatorHost);

            updateIndicator();

            cleanups.push(() => {
                element.removeEventListener('scroll', handleScroll);
                resizeObserver.disconnect();
                indicatorHost.classList.remove('has-custom-scroll-indicator');
                indicatorHost.style.removeProperty('--scroll-indicator-opacity');
                indicatorHost.style.removeProperty('--scroll-indicator-size');
                indicatorHost.style.removeProperty('--scroll-indicator-offset');
                indicatorHost.style.removeProperty('--scroll-indicator-track-top');
                indicatorHost.style.removeProperty('--scroll-indicator-track-bottom');
            });
        });

        return () => {
            cleanups.forEach(cleanup => cleanup());
        };
    }, [viewMode, dateTransition, viewTransition, tasks, filterType, filterKeyword, searchScope]);

    const openTaskModal = (task: CalendarTask) => {
        clearTaskModalCloseTimer();
        setIsTaskModalClosing(false);
        setIsCreatingTask(false);
        setSelectedTaskId(task.id);
        setModalDraft({
            title: task.title,
            type: task.type,
            time: task.time,
            note: task.note,
        });
    };

    const openTaskModalFromPreview = (preview: AiTaskPreview) => {
        openTaskModal({
            id: preview.id,
            title: preview.title,
            date: preview.date,
            time: preview.time,
            type: preview.type,
            note: preview.note,
        });
    };

    const openCreateTaskModal = (date: Date) => {
        clearTaskModalCloseTimer();
        setIsTaskModalClosing(false);
        const defaultType = taskTypes[0] ?? 'work';
        setIsCreatingTask(true);
        setSelectedTaskId(null);
        console.log('Creating task for date:', date);
        setCreatingTaskDate(date);
        setModalDraft({
            title: '',
            type: defaultType,
            time: '09:00',
            note: '',
        });
    };

    const resetTypeModalState = () => {
        setTypeModalMode('create');
        setTypeEditingOriginalName(null);
        setTypeDraftName('');
        setTypeDraftColor('#4f7ef7');
    };

    const closeTypeModal = () => {
        if (!isTypeModalOpen || isTypeModalClosing) {
            return;
        }

        setIsTypeModalClosing(true);
        clearTypeModalCloseTimer();
        typeModalCloseTimerRef.current = window.setTimeout(() => {
            setIsTypeModalOpen(false);
            setIsTypeModalClosing(false);
            resetTypeModalState();
            typeModalCloseTimerRef.current = null;
        }, MODAL_CLOSE_ANIMATION_MS);
    };

    const closeTaskModal = () => {
        if (!modalDraft || isTaskModalClosing) {
            return;
        }

        if (isTypeModalOpen) {
            closeTypeModal();
        }

        setIsTaskModalClosing(true);
        clearTaskModalCloseTimer();
        taskModalCloseTimerRef.current = window.setTimeout(() => {
            clearTypeModalCloseTimer();
            setSelectedTaskId(null);
            setIsCreatingTask(false);
            setModalDraft(null);
            setIsTaskModalClosing(false);
            setIsTypeModalOpen(false);
            setIsTypeModalClosing(false);
            resetTypeModalState();
            taskModalCloseTimerRef.current = null;
        }, MODAL_CLOSE_ANIMATION_MS);
    };

    const openAiCreateModal = () => {
        clearAiModalCloseTimer();
        setIsAiModalClosing(false);
        setIsAiModalOpen(true);
        setIsAiSubmitting(false);
        setAiChatInput('');
    };

    const closeAiCreateModal = () => {
        if (!isAiModalOpen || isAiModalClosing) {
            return;
        }

        if (isAiSubmittingRef.current) {
            const shouldCancelAndClose = window.confirm('AI is still processing your request. Cancel and close this window?');
            if (!shouldCancelAndClose) {
                return;
            }

            cancelActiveAiRequest('AI request canceled because the chat window was closed.');
        }

        setIsAiModalClosing(true);
        clearAiModalCloseTimer();
        aiModalCloseTimerRef.current = window.setTimeout(() => {
            setIsAiModalOpen(false);
            setIsAiModalClosing(false);
            aiModalCloseTimerRef.current = null;
        }, MODAL_CLOSE_ANIMATION_MS);
    };

    const createNewAiThread = () => {
        const now = Date.now();
        const threadId = createAiThreadId();
        const newThread: AiChatThread = {
            id: threadId,
            title: 'New thread',
            messages: [
                {
                    id: createAiMessageId(),
                    role: 'assistant',
                    text: 'New thread started. Tell me what you want to schedule.',
                    createdAt: now,
                },
            ],
            createdAt: now,
            updatedAt: now,
        };
        setAiThreads(prev => [newThread, ...prev]);
        setActiveAiThreadId(threadId);
        setAiChatInput('');
    };

    const handleAiChatInputChange = (value: string) => {
        setAiChatInput(value);
    };

    const handleSendAiChatMessage = () => {
        if (isAiSubmitting) {
            return;
        }

        const userInput = aiChatInput.trim();
        if (!userInput) {
            enqueueSnackbar('Please enter a message first.', { variant: 'warning' });
            return;
        }

        const targetThreadId = activeAiThreadIdRef.current;
        appendMessageToThread(targetThreadId, 'user', userInput);
        updateThreadTitleFromFirstUserMessage(targetThreadId, userInput);
        setAiChatInput('');

        setIsAiSubmitting(true);
        pendingAiRequestThreadIdRef.current = targetThreadId;
        console.log('AI chat message:', userInput);

        const timeoutMs = AI_REQUEST_TIMEOUT_MS;
        aiRequestDeadlineRef.current = Date.now() + timeoutMs;

        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
            appendMessageToThread(targetThreadId, 'system', 'Unable to send because AI service is disconnected.');
            stopAiSubmitting();
            enqueueWsDisconnectedSnackbar();
            return;
        }

        ws.current?.send(`ai_message: ${JSON.stringify({
            message: userInput,
            thread_id: targetThreadId,
        })}`);

        aiResultPollTimerRef.current = window.setTimeout(() => {
            if (!isAiSubmittingRef.current) {
                return;
            }

            if (aiRequestDeadlineRef.current !== null && Date.now() > aiRequestDeadlineRef.current) {
                appendMessageToThread(targetThreadId, 'system', 'AI response timed out. Please try again.');
                stopAiSubmitting();
            }
        }, timeoutMs + 50);
    };

    const openTypeCreateModal = () => {
        clearTypeModalCloseTimer();
        setIsTypeModalClosing(false);
        setTypeModalMode('create');
        setTypeEditingOriginalName(null);
        setTypeDraftName('');
        setTypeDraftColor('#4f7ef7');
        setIsTypeModalOpen(true);
    };

    const openTypeEditModal = () => {
        if (!modalDraft?.type) {
            return;
        }

        clearTypeModalCloseTimer();
        setIsTypeModalClosing(false);
        const currentType = modalDraft.type;
        setTypeModalMode('edit');
        setTypeEditingOriginalName(currentType);
        setTypeDraftName(currentType);
        setTypeDraftColor(taskTypeColors[currentType] ?? '#dfe7ff');
        setIsTypeModalOpen(true);
    };

    const addTaskTypeWithColor = () => {
        const normalized = typeDraftName.trim().toLowerCase();
        if (!normalized || !isValidHexColor(typeDraftColor)) {
            return;
        }

        if (typeModalMode === 'edit' && typeEditingOriginalName) {
            const original = typeEditingOriginalName;
            if (normalized !== original && taskTypes.includes(normalized)) {
                return;
            }

            setTaskTypes(prev => prev.map(type => type === original ? normalized : type));
            setTaskTypeColors(prev => {
                const next = { ...prev };
                delete next[original];
                next[normalized] = typeDraftColor;
                return next;
            });
            setTasks(prev => prev.map(task => (
                task.type === original
                    ? { ...task, type: normalized }
                    : task
            )));

            if (modalDraft) {
                setModalDraft(prev => prev ? { ...prev, type: normalized } : prev);
            }

            if (filterType === original) {
                setFilterType(normalized);
            }

            closeTypeModal();
            return;
        }

        if (!taskTypes.includes(normalized)) {
            setTaskTypes(prev => [...prev, normalized]);
        }

        setTaskTypeColors(prev => ({
            ...prev,
            [normalized]: typeDraftColor,
        }));

        if (modalDraft) {
            setModalDraft(prev => prev ? { ...prev, type: normalized } : prev);
        }

        closeTypeModal();
    };

    const deleteTypeAndMoveToOther = () => {
        if (typeModalMode !== 'edit' || !typeEditingOriginalName) {
            return;
        }

        const targetType = typeEditingOriginalName;
        if (targetType === OTHER_TYPE) {
            return;
        }

        setTaskTypes(prev => {
            const next = prev.filter(type => type !== targetType);
            return next.includes(OTHER_TYPE) ? next : [...next, OTHER_TYPE];
        });

        setTaskTypeColors(prev => {
            const next = { ...prev };
            delete next[targetType];
            next[OTHER_TYPE] = prev[OTHER_TYPE] ?? defaultTypeColors[OTHER_TYPE];
            return next;
        });

        enqueueSnackbar(`Type "${targetType}" deleted. Tasks with this type have been moved to "${OTHER_TYPE}".`, { variant: 'error' });

        // Migrate all events with this type to `other`.
        setTasks(prev => prev.map(task => (
            task.type === targetType
                ? { ...task, type: OTHER_TYPE }
                : task
        )));

        if (modalDraft) {
            setModalDraft(prev => prev ? { ...prev, type: OTHER_TYPE } : prev);
        }

        if (filterType === targetType) {
            setFilterType(OTHER_TYPE);
        }

        closeTypeModal();
    };

    const getTaskStyle = (type: string) => {
        const backgroundColor = taskTypeColors[type] ?? (type === OTHER_TYPE ? defaultTypeColors[OTHER_TYPE] : '#dfe7ff');
        return {
            background: backgroundColor,
            color: getReadableTextColor(backgroundColor),
        };
    };

    const saveTaskModal = () => {
        if (!modalDraft || !modalDraft.title.trim()) {
            return;
        }

        if (isCreatingTask) {
            const dateForNewTask = creatingTaskDate;
            const newTask: CalendarTask = {
                id: nextTaskId,
                title: modalDraft.title.trim(),
                type: modalDraft.type,
                time: modalDraft.time,
                note: modalDraft.note,
                date: buildDateString(dateForNewTask),
            };
            setTasks(prev => [...prev, newTask]);
            enqueueSnackbar('Task created.', { variant: 'success' });
        } else if (selectedTask) {
            setTasks(prev => prev.map(task => (
                task.id === selectedTask.id
                    ? {
                        ...task,
                        title: modalDraft.title.trim(),
                        time: modalDraft.time,
                        note: modalDraft.note,
                        type: modalDraft.type,
                    }
                    : task
            )));
            enqueueSnackbar('Task updated.', { variant: 'success' });
        }

        closeTaskModal();
    };

    const deleteTask = () => {
        if (!selectedTask) {
            return;
        }

        setTasks(prev => prev.filter(task => task.id !== selectedTask.id));
        closeTaskModal();
        enqueueSnackbar('Task deleted.', { variant: 'error' });
    };

    const handleDayClick = (day: CalendarDay) => {
        // const dayTasks = getTasksForDay(day);
        const date = new Date(day.year, day.month, day.day);
        // if (dayTasks.length === 0) {
            openCreateTaskModal(date);
            return;
        // }
    };

    const displayDate = dateTransition?.nextDate ?? currentDate;
    const effectiveViewMode: ViewMode = viewTransition?.toMode ?? viewMode;
    const filtersButtonText = isHeaderToolsOpen ? 'hide filters' : 'filters';
    const activeAiThread = aiThreads.find(thread => thread.id === activeAiThreadId) ?? aiThreads[0] ?? null;
    const shouldElevateTaskModal = Boolean(isAiModalOpen && modalDraft);
    const shouldElevateTypeModal = Boolean(isAiModalOpen && isTypeModalOpen);

    useEffect(() => {
        if (!isAiModalOpen) {
            return;
        }
        aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [isAiModalOpen, activeAiThreadId, aiThreads]);

    return (
        <main className={`calendar-container ${viewMode === 'list' ? 'list-scroll-mode' : ''} ${isFilterRefreshActive ? 'filter-refresh-active' : ''}`}>
            <SnackbarProvider maxSnack={4}/>
            <div className="calendar-header sticky-header">
                <div className="header-top-row">
                    <div className="calendar-nav">
                        {effectiveViewMode !== 'list' && (
                            <>
                                <button className="nav-btn" onClick={handlePrevMonth} disabled={dateTransition !== null || viewTransition !== null}>&lt;</button>
                                <button className="nav-btn" onClick={handleNextMonth} disabled={dateTransition !== null || viewTransition !== null}>&gt;</button>
                            </>
                        )}
                        <button className="today-btn" onClick={handleToday} disabled={viewTransition !== null || (dateTransition !== null && effectiveViewMode !== 'list')}>today</button>
                        <span className="button-divider" aria-hidden="true" />
                        <button className="nav-btn nav-new-event-btn" onClick={() => openCreateTaskModal(new Date())}>new event</button>
                        <button className="nav-btn nav-ai-create-btn" onClick={openAiCreateModal}>ai chat</button>
                    </div>

                    <div className="calendar-title">
                        {effectiveViewMode === 'week'
                            ? getWeekTitle(displayDate)
                            : effectiveViewMode === 'day'
                                ? getDayTitle(displayDate)
                                : effectiveViewMode === 'list'
                                    ? 'Task List'
                                : `${displayDate.toLocaleString('default', { month: 'long' })} ${displayDate.getFullYear()}`}
                    </div>

                    <div className="view-selector">
                        <button className={`view-btn ${effectiveViewMode === 'month' ? 'active' : ''}`} onClick={() => handleViewChange('month')} disabled={viewTransition !== null}>month</button>
                        <button className={`view-btn ${effectiveViewMode === 'week' ? 'active' : ''}`} onClick={() => handleViewChange('week')} disabled={viewTransition !== null}>week</button>
                        <button className={`view-btn ${effectiveViewMode === 'day' ? 'active' : ''}`} onClick={() => handleViewChange('day')} disabled={viewTransition !== null}>day</button>
                        <button className={`view-btn ${effectiveViewMode === 'list' ? 'active' : ''}`} onClick={() => handleViewChange('list')} disabled={viewTransition !== null}>list</button>
                        <span className="button-divider" aria-hidden="true" />
                        <button
                            className={`view-btn view-btn-filters ${isHeaderToolsOpen ? 'active' : ''}`}
                            onClick={() => setIsHeaderToolsOpen(prev => !prev)}
                            style={filtersButtonWidth ? { width: `${filtersButtonWidth}px` } : undefined}
                        >
                            {filtersButtonText}
                        </button>
                        <span className="view-btn-filters-measure" ref={filtersButtonMeasureRef} aria-hidden="true">
                            {filtersButtonText}
                        </span>
                    </div>
                </div>

                <div className={`header-tools-collapsible ${isHeaderToolsOpen ? 'open' : ''}`}>
                    <div className="header-tools">
                        <div className="header-tools-group">
                            <div className="header-tools-group-label"><label htmlFor="filterType">TYPE</label></div>
                            <select id="filterType" value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                                <option value="all">All</option>
                                {taskTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div className="header-tools-group">
                            <div className="header-tools-group-label"><label htmlFor="filterKeyword">SEARCH</label></div>
                            <input
                                id="filterKeyword"
                                value={filterKeyword}
                                onChange={(event) => setFilterKeyword(event.target.value)}
                                placeholder=""
                            />
                        </div>
                        <div className="header-tools-group">
                            <div className="header-tools-group-label"><label htmlFor="searchScope">SCOPE</label></div>
                            <select id="searchScope" value={searchScope} onChange={(event) => setSearchScope(event.target.value as typeof searchScope)}>
                                <option value="all">All fields</option>
                                <option value="title">Title</option>
                                <option value="note">Note</option>
                                <option value="time">Time</option>
                                <option value="type">Type</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
            
            {viewTransition ? (
                <div className={`view-transition-viewport direction-${viewTransition.direction}`}>
                    <div className="view-transition-panel old-view">
                        {renderViewContent(viewTransition.fromMode, currentDate)}
                    </div>
                    <div className="view-transition-panel new-view">
                        {renderViewContent(viewTransition.toMode, currentDate)}
                    </div>
                </div>
            ) : viewMode === 'list' ? (
                renderViewContent('list', currentDate)
            ) : (
                <div className="calendar-transition-viewport">
                    {dateTransition ? (
                        <div className={`calendar-transition-track animating direction-${dateTransition.direction}`}>
                            <div className="calendar-transition-panel old-view">
                                {dateTransition.direction === 'backward'
                                    ? renderViewContent(viewMode, dateTransition.nextDate)
                                    : renderViewContent(viewMode, currentDate)}
                            </div>
                            <div className="calendar-transition-panel new-view">
                                {dateTransition.direction === 'backward'
                                    ? renderViewContent(viewMode, currentDate)
                                    : renderViewContent(viewMode, dateTransition.nextDate)}
                            </div>
                        </div>
                    ) : (
                        <div className="calendar-transition-single">
                            {renderViewContent(viewMode, currentDate)}
                        </div>
                    )}
                </div>
            )}

            {modalDraft && (
                <div
                    className={`task-modal-backdrop ${isTaskModalClosing ? 'closing' : ''} ${shouldElevateTaskModal ? 'modal-over-ai' : ''}`}
                    onClick={closeTaskModal}
                >
                    <div className={`task-modal ${isTaskModalClosing ? 'closing' : ''}`} onClick={(event) => event.stopPropagation()}>
                        <div className="task-modal-header">
                            <h2>{isCreatingTask ? 'Create Event' : 'Edit Event'}</h2>
                            <button className="task-modal-close" onClick={closeTaskModal}>x</button>
                        </div>
                        {!isCreatingTask && selectedTask && (
                            <div className="task-modal-meta">
                                {parseTaskDate(selectedTask.date).toLocaleDateString('default', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    year: 'numeric',
                                })}
                            </div>
                        )}

                        {isCreatingTask && (
                            <div className="task-modal-meta">
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

                        <label className="task-modal-label">Time</label>
                        <input
                            className="task-modal-input"
                            type="time"
                            value={modalDraft.time}
                            onChange={(event) => setModalDraft(prev => prev ? { ...prev, time: event.target.value } : prev)}
                        />

                        <label className="task-modal-label">Type</label>
                        <div className="type-select-row">
                            <select
                                className="task-modal-input"
                                value={modalDraft.type}
                                onChange={(event) => {
                                    const value = event.target.value as TaskType;
                                    if (value === ADD_TYPE_OPTION_VALUE) {
                                        openTypeCreateModal();
                                        return;
                                    }
                                    setModalDraft(prev => prev ? { ...prev, type: value } : prev);
                                }}
                            >
                                {taskTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                                <option value={ADD_TYPE_OPTION_VALUE}>+ add new type...</option>
                            </select>
                            <button className="task-modal-btn" onClick={openTypeEditModal}>edit</button>
                        </div>

                        <label className="task-modal-label">Note</label>
                        <textarea
                            className="task-modal-textarea"
                            value={modalDraft.note}
                            onChange={(event) => setModalDraft(prev => prev ? { ...prev, note: event.target.value } : prev)}
                        />

                        <div className="task-modal-actions">
                            {!isCreatingTask && (
                                <button className="task-modal-btn danger" onClick={deleteTask}>Delete</button>
                            )}
                            <button className="task-modal-btn" onClick={closeTaskModal}>Cancel</button>
                            <button className="task-modal-btn primary" onClick={saveTaskModal}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {isTypeModalOpen && (
                <div
                    className={`task-modal-backdrop ${isTypeModalClosing ? 'closing' : ''} ${shouldElevateTypeModal ? 'modal-over-ai' : ''}`}
                    onClick={closeTypeModal}
                >
                    <div className={`task-modal type-create-modal ${isTypeModalClosing ? 'closing' : ''}`} onClick={(event) => event.stopPropagation()}>
                        <div className="task-modal-header">
                            <h2>{typeModalMode === 'edit' ? 'Edit Type' : 'Create Type'}</h2>
                            <button className="task-modal-close" onClick={closeTypeModal}>x</button>
                        </div>

                        <label className="task-modal-label">Type Name</label>
                        <input
                            className="task-modal-input"
                            placeholder="e.g. study"
                            value={typeDraftName}
                            onChange={(event) => setTypeDraftName(event.target.value)}
                        />

                        <label className="task-modal-label">Type Color</label>
                        <div className="type-color-picker-row">
                            <input
                                className="type-color-input"
                                type="color"
                                value={isValidHexColor(typeDraftColor) ? typeDraftColor : '#4f7ef7'}
                                onChange={(event) => setTypeDraftColor(event.target.value)}
                            />
                            <input
                                className="task-modal-input"
                                value={typeDraftColor}
                                onChange={(event) => setTypeDraftColor(event.target.value)}
                            />
                        </div>

                        <div className="task-modal-actions">
                            {typeModalMode === 'edit' && typeEditingOriginalName !== OTHER_TYPE && (
                                <button className="task-modal-btn danger" onClick={deleteTypeAndMoveToOther}>
                                    Delete Type (move to other)
                                </button>
                            )}
                            <button className="task-modal-btn" onClick={closeTypeModal}>Cancel</button>
                            <button
                                className="task-modal-btn primary"
                                onClick={addTaskTypeWithColor}
                                disabled={!typeDraftName.trim() || !isValidHexColor(typeDraftColor)}
                            >
                                {typeModalMode === 'edit' ? 'Update Type' : 'Save Type'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isAiModalOpen && (
                <div className={`task-modal-backdrop ${isAiModalClosing ? 'closing' : ''}`} onClick={closeAiCreateModal}>
                    <div className={`task-modal ai-create-modal ${isAiModalClosing ? 'closing' : ''}`} onClick={(event) => event.stopPropagation()}>
                        <div className="task-modal-header">
                            <h2>AI Chat Assistant</h2>
                            <button className="task-modal-close" onClick={closeAiCreateModal}>x</button>
                        </div>

                        <div className="ai-chat-layout">
                            <div className="ai-thread-sidebar">
                                <div className="ai-thread-sidebar-header">
                                    <span>Threads</span>
                                    <button className="task-modal-btn" onClick={createNewAiThread} disabled={isAiSubmitting}>New</button>
                                </div>

                                <div className="ai-thread-list">
                                    {aiThreads.map(thread => {
                                        const latestMessage = thread.messages[thread.messages.length - 1];
                                        return (
                                            <button
                                                key={thread.id}
                                                className={`ai-thread-item ${thread.id === activeAiThreadId ? 'active' : ''}`}
                                                onClick={() => setActiveAiThreadId(thread.id)}
                                                disabled={isAiSubmitting}
                                            >
                                                <div className="ai-thread-item-title">{thread.title}</div>
                                                <div className="ai-thread-item-preview">{latestMessage?.text ?? 'No messages yet.'}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="ai-chat-main">
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
                                                            <span className="task-time">{message.taskPreview.time || '--:--'}</span>
                                                            <span className="task-divider" aria-hidden="true" />
                                                            {message.taskPreview.title || '(untitled task)'}
                                                        </div>
                                                        <div className="list-card-task-note">
                                                            {`${message.taskPreview.date} | ${message.taskPreview.type} | #${message.taskPreview.id}`}
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
                                                                <span className="task-time">{taskCard.time || '--:--'}</span>
                                                                <span className="task-divider" aria-hidden="true" />
                                                                {taskCard.title || '(untitled task)'}
                                                            </div>
                                                            <div className="list-card-task-note">
                                                                {`${taskCard.date} | ${taskCard.type} | #${taskCard.id}`}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    <div ref={aiMessagesEndRef} />
                                </div>

                                {isAiSubmitting && (
                                    <div className="ai-chat-processing">
                                        <span>AI is processing your request...</span>
                                        <button
                                            className="task-modal-btn"
                                            onClick={() => cancelActiveAiRequest('AI request canceled.')}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}

                                <div className="ai-chat-input-wrap">
                                    <textarea
                                        className="task-modal-textarea ai-chat-input"
                                        placeholder="Type a message, e.g. Schedule focused work blocks for tomorrow morning."
                                        value={aiChatInput}
                                        onChange={(event) => handleAiChatInputChange(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && !event.shiftKey) {
                                                event.preventDefault();
                                                handleSendAiChatMessage();
                                            }
                                        }}
                                        disabled={isAiSubmitting}
                                    />
                                    <button
                                        className="task-modal-btn primary"
                                        onClick={handleSendAiChatMessage}
                                        disabled={isAiSubmitting || !aiChatInput.trim() || !activeAiThread}
                                    >
                                        {isAiSubmitting ? 'Waiting...' : 'Send'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

function App() {
    return (
        <div className="App">
            <MainCalendar />
        </div>
    );
}

export default App;
