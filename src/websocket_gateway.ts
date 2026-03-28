import { createElement, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { closeSnackbar, enqueueSnackbar } from "notistack";
import { defaultTypeColors } from "./db_utils";
import { buildDateString, OTHER_TYPE } from "./calendar_logic";
import {
    getDefaultCommitmentCategoryForItemKind,
    isValidHexColor,
    normalizeTaskCommitmentCategory,
    type CalendarTask,
} from "./general_utils";
import type { AiChatRole, AiTaskPreview, AiThreadProgress } from "./ai_chat";

export interface GatewaySnackbarRefs {
    wsDisconnectedSnackbarIdRef: MutableRefObject<string | number | null>;
    wsReconnectingSnackbarIdRef: MutableRefObject<string | number | null>;
}

export interface WebSocketGatewayParams extends GatewaySnackbarRefs {
    ws: MutableRefObject<WebSocket | null>;
    createdTaskAckResult: MutableRefObject<string | null>;
    hasEverConnectedWsRef: MutableRefObject<boolean>;
    isUnmountingRef: MutableRefObject<boolean>;
    taskTypesRef: MutableRefObject<string[]>;
    tasksRef: MutableRefObject<CalendarTask[]>;
    taskTypeColorsRef: MutableRefObject<Record<string, string>>;
    nextTaskIdRef: MutableRefObject<number>;
    aiRequestDeadlineRef: MutableRefObject<number | null>;
    pendingAiRequestThreadIdRef: MutableRefObject<string | null>;
    activeAiThreadIdRef: MutableRefObject<string>;
    isManualWsCloseRef: MutableRefObject<boolean>;
    isAiSubmittingRef: MutableRefObject<boolean>;
    setTaskTypes: Dispatch<SetStateAction<string[]>>;
    setTasks: Dispatch<SetStateAction<CalendarTask[]>>;
    setTaskTypeColors: Dispatch<SetStateAction<Record<string, string>>>;
    setModalDraft: Dispatch<SetStateAction<Omit<CalendarTask, 'id' | 'date'> | null>>;
    setFilterType: Dispatch<SetStateAction<string>>;
    aiCalendarStagingRef: MutableRefObject<boolean>;
    registerAiCalendarMutation: (threadId: string | null) => void;
    setAiThreadProgress: (threadId: string, progress: AiThreadProgress) => void;
    stopAiSubmitting: (options?: { closeConnection?: boolean; reason?: 'completed' | 'failed' | 'canceled' | 'interrupted' }) => void;
    connectWebSocket: () => void;
    appendMessageToThread: (
        threadId: string,
        role: AiChatRole,
        text: string,
        options?: { taskPreview?: AiTaskPreview; taskCards?: AiTaskPreview[] },
    ) => void;
    appendTaskEventMessageToActiveThread: (message: string, task?: CalendarTask) => void;
    aiRequestTimeoutMs: number;
}

export function clearWsDisconnectedSnackbar(ref: MutableRefObject<string | number | null>) {
    if (ref.current !== null) {
        closeSnackbar(ref.current);
        ref.current = null;
    }
}

export function clearWsReconnectingSnackbar(ref: MutableRefObject<string | number | null>) {
    if (ref.current !== null) {
        closeSnackbar(ref.current);
        ref.current = null;
    }
}

export function enqueueWsReconnectingSnackbar(ref: MutableRefObject<string | number | null>) {
    if (ref.current !== null) {
        return;
    }

    const snackbarId = enqueueSnackbar('Reconnecting to AI service...', {
        variant: 'info',
        persist: true,
        onClose: () => {
            ref.current = null;
        },
    });

    ref.current = snackbarId;
}

export function enqueueWsDisconnectedSnackbar(params: {
    wsDisconnectedSnackbarIdRef: MutableRefObject<string | number | null>;
    wsReconnectingSnackbarIdRef: MutableRefObject<string | number | null>;
    connectWebSocket: () => void;
}) {
    const { wsDisconnectedSnackbarIdRef, wsReconnectingSnackbarIdRef, connectWebSocket } = params;

    if (wsDisconnectedSnackbarIdRef.current !== null) {
        return;
    }

    const snackbarId = enqueueSnackbar('WebSocket connection lost.', {
        variant: 'warning',
        persist: true,
        action: (id) => createElement(
            'div',
            { className: 'snackbar-action-group' },
            createElement(
                'button',
                {
                    className: 'task-modal-btn snackbar-action-btn snackbar-action-btn-reconnect',
                    onClick: () => {
                        closeSnackbar(id);
                        wsDisconnectedSnackbarIdRef.current = null;
                        enqueueWsReconnectingSnackbar(wsReconnectingSnackbarIdRef);
                        connectWebSocket();
                    },
                },
                'Reconnect',
            ),
            createElement(
                'button',
                {
                    className: 'task-modal-btn snackbar-action-btn snackbar-action-btn-dismiss',
                    onClick: () => {
                        closeSnackbar(id);
                        wsDisconnectedSnackbarIdRef.current = null;
                    },
                },
                'Dismiss',
            ),
        ),
        onClose: () => {
            wsDisconnectedSnackbarIdRef.current = null;
        },
    });

    wsDisconnectedSnackbarIdRef.current = snackbarId;
}

export async function requestServerShutdown(ws: MutableRefObject<WebSocket | null>) {
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
}

export function connectWebSocketGateway(params: WebSocketGatewayParams) {
    const {
        ws,
        createdTaskAckResult,
        hasEverConnectedWsRef,
        isUnmountingRef,
        taskTypesRef,
        tasksRef,
        taskTypeColorsRef,
        nextTaskIdRef,
        wsDisconnectedSnackbarIdRef,
        wsReconnectingSnackbarIdRef,
        aiRequestDeadlineRef,
        pendingAiRequestThreadIdRef,
        activeAiThreadIdRef,
        isManualWsCloseRef,
        isAiSubmittingRef,
        setTaskTypes,
        setTasks,
        setTaskTypeColors,
        setModalDraft,
        setFilterType,
        aiCalendarStagingRef,
        registerAiCalendarMutation,
        setAiThreadProgress,
        stopAiSubmitting,
        connectWebSocket,
        appendMessageToThread,
        appendTaskEventMessageToActiveThread,
        aiRequestTimeoutMs,
    } = params;

    const existing = ws.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const socket = new WebSocket('ws://localhost:8765');
    ws.current = socket;

    const isStagingCalendarChanges = () => aiCalendarStagingRef.current;

    const applyTaskTypes = (updater: (prev: string[]) => string[]) => {
        const next = updater(taskTypesRef.current);
        taskTypesRef.current = next;
        if (!isStagingCalendarChanges()) {
            setTaskTypes(next);
        }
        return next;
    };

    const applyTasks = (updater: (prev: CalendarTask[]) => CalendarTask[]) => {
        const next = updater(tasksRef.current);
        tasksRef.current = next;
        if (!isStagingCalendarChanges()) {
            setTasks(next);
        }
        return next;
    };

    const applyTaskTypeColors = (updater: (prev: Record<string, string>) => Record<string, string>) => {
        const next = updater(taskTypeColorsRef.current);
        taskTypeColorsRef.current = next;
        if (!isStagingCalendarChanges()) {
            setTaskTypeColors(next);
        }
        return next;
    };

    const applyModalDraftIfLive = (updater: (prev: Omit<CalendarTask, 'id' | 'date'> | null) => Omit<CalendarTask, 'id' | 'date'> | null) => {
        if (isStagingCalendarChanges()) {
            return;
        }
        setModalDraft(updater);
    };

    const applyFilterTypeIfLive = (updater: (prev: string) => string) => {
        if (isStagingCalendarChanges()) {
            return;
        }
        setFilterType(updater);
    };

    const registerMutationForCurrentThread = () => {
        const threadId = pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current ?? null;
        registerAiCalendarMutation(threadId);
    };

    const handleMessage = (event: MessageEvent) => {
        console.log('Received message from WebSocket:', event.data);

        if (typeof event.data === 'string' && event.data.startsWith('newing_task: ')) {
            const taskInfo = JSON.parse(event.data.substring('newing_task: '.length));
            const date = taskInfo.date ? new Date(taskInfo.date) : new Date();
            const title = taskInfo.title || '';

            let type = taskInfo.type || 'other';
            if (!taskTypesRef.current.includes(type)) {
                const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
                applyTaskTypes(prev => [...prev, type]);
                applyTaskTypeColors(prev => ({
                    ...prev,
                    [type]: randomColor,
                }));
            }

            const itemKind: CalendarTask['itemKind'] = taskInfo.itemKind === 'event' ? 'event' : 'task';
            const ddl = itemKind === 'task'
                ? String(taskInfo.ddl ?? taskInfo.time ?? '')
                : '';
            const startTime = itemKind === 'event'
                ? String(taskInfo.startTime ?? '')
                : '';
            const endTime = itemKind === 'event'
                ? String(taskInfo.endTime ?? '')
                : '';
            const commitmentCategory = normalizeTaskCommitmentCategory(taskInfo.commitmentCategory)
                ?? getDefaultCommitmentCategoryForItemKind(itemKind);
            const note = taskInfo.note || '';
            const computedTaskId = nextTaskIdRef.current;
            nextTaskIdRef.current = computedTaskId + 1;
            const newTask: CalendarTask = {
                id: computedTaskId,
                title,
                type,
                commitmentCategory,
                itemKind,
                ddl,
                virtualDeadlineDate: buildDateString(date),
                virtualDeadlineTime: ddl,
                startTime,
                endTime,
                note,
                date: buildDateString(date),
            };

            applyTasks(prev => [...prev, newTask]);
            if (isAiSubmittingRef.current) {
                aiRequestDeadlineRef.current = Date.now() + aiRequestTimeoutMs;
            }
            createdTaskAckResult.current = null;
            ws.current?.send(`created_task: ${JSON.stringify(newTask)}`);

            let resendAttempts = 0;
            const waitForAcknowledgement = () => {
                if (createdTaskAckResult.current === 'Acknowledged task creation result') {
                    createdTaskAckResult.current = null;
                    return;
                }
                if (resendAttempts >= 10) {
                    return;
                }
                resendAttempts++;
                ws.current?.send(`created_task: ${JSON.stringify(newTask)}`);
                setTimeout(waitForAcknowledgement, 2000);
            };
            waitForAcknowledgement();

            registerMutationForCurrentThread();
            appendTaskEventMessageToActiveThread(`AI created a new task: ${title || '(untitled task)'}`, newTask);
        }

        if (typeof event.data === 'string' && event.data.startsWith('ack_created_task: ')) {
            createdTaskAckResult.current = event.data.substring('ack_created_task: '.length);
        }

        if (typeof event.data === 'string' && event.data.startsWith('task_creation_result: ')) {
            const resultText = event.data.substring('task_creation_result: '.length);
            const targetThreadId = pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current;
            appendMessageToThread(targetThreadId, 'assistant', resultText || 'AI finished, but returned an empty result.');
            if (isAiSubmittingRef.current) {
                stopAiSubmitting({ reason: 'completed' });
            }
        }

        if (typeof event.data === 'string' && event.data.startsWith('ai_progress_update: ')) {
            const payloadText = event.data.substring('ai_progress_update: '.length);
            try {
                const payload = JSON.parse(payloadText) as {
                    thread_id?: string;
                    percent?: number;
                    status?: string;
                    is_active?: boolean;
                    mode?: 'sos' | 'chat';
                };

                const targetThreadId = payload.thread_id?.trim() || pendingAiRequestThreadIdRef.current || activeAiThreadIdRef.current;
                const clampedPercent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
                const statusText = (payload.status ?? '').trim() || 'AI is working...';
                const isActive = payload.is_active !== false;

                setAiThreadProgress(targetThreadId, {
                    percent: clampedPercent,
                    status: statusText,
                    isActive,
                    mode: payload.mode === 'sos' ? 'sos' : 'chat',
                });

                if (isAiSubmittingRef.current && targetThreadId === pendingAiRequestThreadIdRef.current) {
                    aiRequestDeadlineRef.current = Date.now() + aiRequestTimeoutMs;
                }
            } catch (error) {
                console.error('Failed to parse ai_progress_update payload:', error);
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
                    itemKind: task.itemKind,
                    commitmentCategory: task.commitmentCategory ?? getDefaultCommitmentCategoryForItemKind(task.itemKind),
                    ddl: task.ddl,
                    startTime: task.startTime,
                    endTime: task.endTime,
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
                    ...(payload.updates?.itemKind !== undefined
                        ? { itemKind: payload.updates.itemKind === 'event' ? 'event' : 'task' }
                        : {}),
                    ...(payload.updates?.title !== undefined ? { title: String(payload.updates.title) } : {}),
                    ...(payload.updates?.date !== undefined ? { date: String(payload.updates.date) } : {}),
                    ...(payload.updates?.type !== undefined ? { type: String(payload.updates.type) } : {}),
                    ...(payload.updates?.commitmentCategory !== undefined
                        ? {
                            commitmentCategory: normalizeTaskCommitmentCategory(payload.updates.commitmentCategory)
                                ?? getDefaultCommitmentCategoryForItemKind(
                                    payload.updates.itemKind === 'event'
                                        ? 'event'
                                        : payload.updates.itemKind === 'task'
                                            ? 'task'
                                            : existingTask.itemKind,
                                ),
                        }
                        : {}),
                    ...(payload.updates?.ddl !== undefined ? { ddl: String(payload.updates.ddl) } : {}),
                    ...(payload.updates?.startTime !== undefined ? { startTime: String(payload.updates.startTime) } : {}),
                    ...(payload.updates?.endTime !== undefined ? { endTime: String(payload.updates.endTime) } : {}),
                    ...(payload.updates && 'time' in payload.updates && (payload.updates as { time?: unknown }).time !== undefined
                        ? (
                            existingTask.itemKind === 'event'
                                ? { startTime: String((payload.updates as { time?: unknown }).time) }
                                : { ddl: String((payload.updates as { time?: unknown }).time) }
                        )
                        : {}),
                    ...(payload.updates?.note !== undefined ? { note: String(payload.updates.note) } : {}),
                };

                applyTasks(prev => prev.map(task => task.id === taskId ? updatedTask : task));

                if (!taskTypesRef.current.includes(updatedTask.type)) {
                    applyTaskTypes(prev => [...prev, updatedTask.type]);
                    applyTaskTypeColors(prev => ({
                        ...prev,
                        [updatedTask.type]: prev[updatedTask.type] ?? defaultTypeColors[OTHER_TYPE],
                    }));
                }

                registerMutationForCurrentThread();
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

                applyTasks(prev => prev.filter(task => task.id !== taskId));
                registerMutationForCurrentThread();
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
                    applyTaskTypes(prev => [...prev, taskType]);
                }

                applyTaskTypeColors(prev => ({
                    ...prev,
                    [taskType]: color,
                }));

                registerMutationForCurrentThread();

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

                applyTaskTypes(prev => prev.map(type => (type === oldType ? newType : type)));
                applyTaskTypeColors(prev => {
                    const next = { ...prev };
                    const previousColor = next[oldType] ?? defaultTypeColors[OTHER_TYPE];
                    delete next[oldType];
                    next[newType] = isValidHexColor(newColor) ? newColor : previousColor;
                    return next;
                });
                applyTasks(prev => prev.map(task => (
                    task.type === oldType
                        ? { ...task, type: newType }
                        : task
                )));
                applyModalDraftIfLive(prev => (
                    prev && prev.type === oldType
                        ? { ...prev, type: newType }
                        : prev
                ));
                applyFilterTypeIfLive(prev => (prev === oldType ? newType : prev));

                registerMutationForCurrentThread();

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

                applyTaskTypes(prev => {
                    const withoutDeleted = prev.filter(type => type !== targetType);
                    return withoutDeleted.includes(moveToType)
                        ? withoutDeleted
                        : [...withoutDeleted, moveToType];
                });
                applyTaskTypeColors(prev => {
                    const next = { ...prev };
                    delete next[targetType];
                    next[moveToType] = next[moveToType] ?? defaultTypeColors[OTHER_TYPE];
                    return next;
                });
                applyTasks(prev => prev.map(task => (
                    task.type === targetType
                        ? { ...task, type: moveToType }
                        : task
                )));
                applyModalDraftIfLive(prev => (
                    prev && prev.type === targetType
                        ? { ...prev, type: moveToType }
                        : prev
                ));
                applyFilterTypeIfLive(prev => (prev === targetType ? moveToType : prev));

                registerMutationForCurrentThread();

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
                    item_kind?: string;
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

                const kindFilter = (payload.item_kind ?? '').trim().toLowerCase();
                if (kindFilter === 'task' || kindFilter === 'event') {
                    candidates = candidates.filter(task => task.itemKind === kindFilter);
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
                    itemKind: task.itemKind,
                    ddl: task.ddl,
                    startTime: task.startTime,
                    endTime: task.endTime,
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

        // ── Batch create ──
        if (typeof event.data === 'string' && event.data.startsWith('batch_create_tasks: ')) {
            const payloadText = event.data.substring('batch_create_tasks: '.length);
            try {
                const payload = JSON.parse(payloadText) as {
                    request_id?: string;
                    items?: Array<{
                        title?: string;
                        date?: string;
                        type?: string;
                        itemKind?: string;
                        ddl?: string;
                        startTime?: string;
                        endTime?: string;
                        note?: string;
                        commitmentCategory?: string;
                    }>;
                };
                if (!payload.request_id) {
                    return;
                }

                const items = payload.items ?? [];
                if (!Array.isArray(items) || items.length === 0) {
                    ws.current?.send(`batch_create_tasks_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: false,
                        message: 'No items provided.',
                    })}`);
                    return;
                }

                const createdTasks: CalendarTask[] = [];

                for (const taskInfo of items) {
                    const date = taskInfo.date ? new Date(taskInfo.date) : new Date();
                    const title = taskInfo.title || '';
                    const type = taskInfo.type || 'other';

                    if (!taskTypesRef.current.includes(type)) {
                        const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
                        applyTaskTypes(prev => [...prev, type]);
                        applyTaskTypeColors(prev => ({ ...prev, [type]: randomColor }));
                    }

                    const itemKind: CalendarTask['itemKind'] = taskInfo.itemKind === 'event' ? 'event' : 'task';
                    const ddl = itemKind === 'task' ? String(taskInfo.ddl ?? '') : '';
                    const startTime = itemKind === 'event' ? String(taskInfo.startTime ?? '') : '';
                    const endTime = itemKind === 'event' ? String(taskInfo.endTime ?? '') : '';
                    const commitmentCategory = normalizeTaskCommitmentCategory(taskInfo.commitmentCategory)
                        ?? getDefaultCommitmentCategoryForItemKind(itemKind);
                    const note = taskInfo.note || '';
                    const computedTaskId = nextTaskIdRef.current;
                    nextTaskIdRef.current = computedTaskId + 1;

                    createdTasks.push({
                        id: computedTaskId,
                        title,
                        type,
                        commitmentCategory,
                        itemKind,
                        ddl,
                        virtualDeadlineDate: buildDateString(date),
                        virtualDeadlineTime: ddl,
                        startTime,
                        endTime,
                        note,
                        date: buildDateString(date),
                    });
                }

                applyTasks(prev => [...prev, ...createdTasks]);
                if (isAiSubmittingRef.current) {
                    aiRequestDeadlineRef.current = Date.now() + aiRequestTimeoutMs;
                }
                registerMutationForCurrentThread();

                const createdCards: AiTaskPreview[] = createdTasks.map(t => ({
                    id: t.id,
                    title: t.title,
                    date: t.date,
                    itemKind: t.itemKind,
                    ddl: t.ddl,
                    startTime: t.startTime,
                    endTime: t.endTime,
                    type: t.type,
                    note: t.note,
                }));
                appendMessageToThread(
                    pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current,
                    'system',
                    `AI created ${createdTasks.length} task(s) in batch`,
                    { taskCards: createdCards },
                );

                ws.current?.send(`batch_create_tasks_result: ${JSON.stringify({
                    request_id: payload.request_id,
                    ok: true,
                    tasks: createdTasks,
                })}`);
            } catch (error) {
                console.error('Failed to parse batch_create_tasks payload:', error);
            }
        }

        // ── Batch update ──
        if (typeof event.data === 'string' && event.data.startsWith('batch_update_tasks: ')) {
            const payloadText = event.data.substring('batch_update_tasks: '.length);
            try {
                const payload = JSON.parse(payloadText) as {
                    request_id?: string;
                    updates?: Array<{
                        task_id: number | string;
                        updates: Partial<CalendarTask>;
                    }>;
                };
                if (!payload.request_id) {
                    return;
                }

                const updateItems = payload.updates ?? [];
                if (!Array.isArray(updateItems) || updateItems.length === 0) {
                    ws.current?.send(`batch_update_tasks_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: false,
                        message: 'No updates provided.',
                    })}`);
                    return;
                }

                const results: Array<{ task_id: number; ok: boolean; task?: CalendarTask; message?: string }> = [];

                for (const item of updateItems) {
                    const taskId = Number(item.task_id);
                    if (!Number.isFinite(taskId) || !item.updates) {
                        results.push({ task_id: taskId, ok: false, message: 'Invalid task_id or updates.' });
                        continue;
                    }

                    const existingTask = tasksRef.current.find(t => t.id === taskId);
                    if (!existingTask) {
                        results.push({ task_id: taskId, ok: false, message: `Task ${taskId} not found.` });
                        continue;
                    }

                    const updatedTask: CalendarTask = {
                        ...existingTask,
                        ...(item.updates.itemKind !== undefined
                            ? { itemKind: item.updates.itemKind === 'event' ? 'event' as const : 'task' as const }
                            : {}),
                        ...(item.updates.title !== undefined ? { title: String(item.updates.title) } : {}),
                        ...(item.updates.date !== undefined ? { date: String(item.updates.date) } : {}),
                        ...(item.updates.type !== undefined ? { type: String(item.updates.type) } : {}),
                        ...(item.updates.commitmentCategory !== undefined
                            ? {
                                commitmentCategory: normalizeTaskCommitmentCategory(item.updates.commitmentCategory)
                                    ?? getDefaultCommitmentCategoryForItemKind(
                                        item.updates.itemKind === 'event'
                                            ? 'event'
                                            : item.updates.itemKind === 'task'
                                                ? 'task'
                                                : existingTask.itemKind,
                                    ),
                            }
                            : {}),
                        ...(item.updates.ddl !== undefined ? { ddl: String(item.updates.ddl) } : {}),
                        ...(item.updates.startTime !== undefined ? { startTime: String(item.updates.startTime) } : {}),
                        ...(item.updates.endTime !== undefined ? { endTime: String(item.updates.endTime) } : {}),
                        ...('time' in item.updates && (item.updates as { time?: unknown }).time !== undefined
                            ? (existingTask.itemKind === 'event'
                                ? { startTime: String((item.updates as { time?: unknown }).time) }
                                : { ddl: String((item.updates as { time?: unknown }).time) })
                            : {}),
                        ...(item.updates.note !== undefined ? { note: String(item.updates.note) } : {}),
                    };

                    applyTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));

                    if (!taskTypesRef.current.includes(updatedTask.type)) {
                        applyTaskTypes(prev => [...prev, updatedTask.type]);
                        applyTaskTypeColors(prev => ({
                            ...prev,
                            [updatedTask.type]: prev[updatedTask.type] ?? defaultTypeColors[OTHER_TYPE],
                        }));
                    }

                    results.push({ task_id: taskId, ok: true, task: updatedTask });
                }

                const successCount = results.filter(r => r.ok).length;
                if (successCount > 0) {
                    registerMutationForCurrentThread();

                    const updatedCards: AiTaskPreview[] = results
                        .filter(r => r.ok && r.task)
                        .map(r => {
                            const t = r.task!;
                            return {
                                id: t.id,
                                title: t.title,
                                date: t.date,
                                itemKind: t.itemKind,
                                ddl: t.ddl,
                                startTime: t.startTime,
                                endTime: t.endTime,
                                type: t.type,
                                note: t.note,
                            };
                        });
                    appendMessageToThread(
                        pendingAiRequestThreadIdRef.current ?? activeAiThreadIdRef.current,
                        'system',
                        `AI updated ${successCount} task(s) in batch`,
                        { taskCards: updatedCards },
                    );
                }
                if (isAiSubmittingRef.current) {
                    aiRequestDeadlineRef.current = Date.now() + aiRequestTimeoutMs;
                }

                ws.current?.send(`batch_update_tasks_result: ${JSON.stringify({
                    request_id: payload.request_id,
                    ok: true,
                    results,
                })}`);
            } catch (error) {
                console.error('Failed to parse batch_update_tasks payload:', error);
            }
        }

        // ── Batch delete ──
        if (typeof event.data === 'string' && event.data.startsWith('batch_delete_tasks: ')) {
            const payloadText = event.data.substring('batch_delete_tasks: '.length);
            try {
                const payload = JSON.parse(payloadText) as {
                    request_id?: string;
                    task_ids?: Array<number | string>;
                };
                if (!payload.request_id) {
                    return;
                }

                const taskIds = (payload.task_ids ?? []).map(Number).filter(Number.isFinite);
                if (taskIds.length === 0) {
                    ws.current?.send(`batch_delete_tasks_result: ${JSON.stringify({
                        request_id: payload.request_id,
                        ok: false,
                        message: 'No task ids provided.',
                    })}`);
                    return;
                }

                const idSet = new Set(taskIds);
                const deletedTasks = tasksRef.current.filter(t => idSet.has(t.id));
                const notFoundIds = taskIds.filter(id => !tasksRef.current.some(t => t.id === id));

                applyTasks(prev => prev.filter(t => !idSet.has(t.id)));

                if (deletedTasks.length > 0) {
                    registerMutationForCurrentThread();
                    appendTaskEventMessageToActiveThread(
                        `AI deleted ${deletedTasks.length} task(s) in batch: ${deletedTasks.map(t => t.title || '(untitled)').join(', ')}`,
                    );
                }
                if (isAiSubmittingRef.current) {
                    aiRequestDeadlineRef.current = Date.now() + aiRequestTimeoutMs;
                }

                ws.current?.send(`batch_delete_tasks_result: ${JSON.stringify({
                    request_id: payload.request_id,
                    ok: true,
                    deleted: deletedTasks,
                    not_found_ids: notFoundIds,
                })}`);
            } catch (error) {
                console.error('Failed to parse batch_delete_tasks payload:', error);
            }
        }
    };

    const handleOpen = () => {
        hasEverConnectedWsRef.current = true;
        clearWsDisconnectedSnackbar(wsDisconnectedSnackbarIdRef);
        clearWsReconnectingSnackbar(wsReconnectingSnackbarIdRef);
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

        clearWsReconnectingSnackbar(wsReconnectingSnackbarIdRef);

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
            stopAiSubmitting({ reason: 'failed' });
            enqueueSnackbar('Connection lost while waiting for AI response.', { variant: 'warning' });
        }

        if (!isUnmountingRef.current) {
            enqueueWsDisconnectedSnackbar({
                wsDisconnectedSnackbarIdRef,
                wsReconnectingSnackbarIdRef,
                connectWebSocket,
            });
        }
    };

    const handleError = () => {
        clearWsReconnectingSnackbar(wsReconnectingSnackbarIdRef);
        if (isAiSubmittingRef.current) {
            const pendingThreadId = pendingAiRequestThreadIdRef.current;
            if (pendingThreadId) {
                appendMessageToThread(pendingThreadId, 'system', 'Connection error occurred while waiting for AI response.');
            }
            stopAiSubmitting({ reason: 'failed' });
            enqueueSnackbar('Connection error while waiting for AI response.', { variant: 'warning' });
        }
        if (!isUnmountingRef.current) {
            enqueueWsDisconnectedSnackbar({
                wsDisconnectedSnackbarIdRef,
                wsReconnectingSnackbarIdRef,
                connectWebSocket,
            });
        }
    };

    socket.addEventListener('message', handleMessage);
    socket.addEventListener('open', handleOpen);
    socket.addEventListener('close', handleClose);
    socket.addEventListener('error', handleError);
}
