import { useEffect, useRef, useState } from "react";
import "./App.css";
import "./styles/calendar-views.css";
import "./styles/ai-chat.css";
import "./styles/websocket-gateway.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    defaultTypeColors,
    loadGoogleEventTaskMapFromTempDb,
    loadTaskTypeColorsFromTempDb,
    loadTasksFromTempDb,
    loadTaskTypesFromTempDb,
    saveGoogleEventTaskMapToTempDb,
    saveTaskTypeColorsToTempDb,
    saveTasksToTempDb,
    saveTaskTypesToTempDb,
} from "./db_utils";
// import { migrateLocalStorageToFileStorage, clearLocalStorageData } from "./file_storage";
import { DayView } from "./calendar_views/DayView";
import { ListView } from "./calendar_views/ListView";
import { MonthView } from "./calendar_views/MonthView";
import { WeekView } from "./calendar_views/WeekView";
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
    type CalendarDay,
    type CalendarTask,
} from "./general_utils";
import { SnackbarProvider, closeSnackbar, enqueueSnackbar } from 'notistack';
import { AiChatSidebar, type AiChatRole, type AiChatThread, type AiTaskPreview, type AiThreadProgress } from "./ai_chat";
import { TaskModal } from "./task_modal";
import { TypeModal } from "./type_modal";
import { HeaderControls } from "./header_controls";
import {
    buildTaskFromGoogleEvent,
    type GoogleCalendarNormalizedEvent,
} from "./google_calendar";
import {
    clearWsDisconnectedSnackbar as clearWsDisconnectedSnackbarRef,
    clearWsReconnectingSnackbar as clearWsReconnectingSnackbarRef,
    connectWebSocketGateway,
    enqueueWsDisconnectedSnackbar as enqueueWsDisconnectedSnackbarRef,
    requestServerShutdown as requestServerShutdownGateway,
} from "./websocket_gateway";

const FILTER_REFRESH_ANIMATION_MS = 180;
const AI_REQUEST_TIMEOUT_MS = 180000;
const GOOGLE_SYNC_TYPE = 'google';
const GOOGLE_SYNC_TIMEOUT_MS = 120000;
const DEFAULT_SOS_USER_PROMPT = 'Please automatically reorganize my most important tasks for today and the near term, prioritize urgent high-impact work, and give me an actionable finish plan.';

interface GoogleCalendarSelectionItem {
    id: string;
    name: string;
}

interface GoogleCalendarSyncSession {
    accessToken: string;
    calendars: GoogleCalendarSelectionItem[];
}

interface SosPlannerDraft {
    userPrompt: string;
}

type AiSubmitSource = 'chat' | 'sos';

type StopAiSubmitReason = 'completed' | 'failed' | 'canceled' | 'interrupted';

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

    const buildDefaultSosPlannerDraft = (): SosPlannerDraft => ({
        userPrompt: DEFAULT_SOS_USER_PROMPT,
    });

    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [dateTransition, setDateTransition] = useState<DateTransitionState | null>(null);
    const [viewTransition, setViewTransition] = useState<ViewTransitionState | null>(null);
    const [tasks, setTasks] = useState<CalendarTask[]>([]);
    const [taskTypes, setTaskTypes] = useState<string[]>(['other']);
    const [taskTypeColors, setTaskTypeColors] = useState<Record<string, string>>(defaultTypeColors);
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
    const [isCreatingTask, setIsCreatingTask] = useState(false);
    const [creatingTaskDate, setCreatingTaskDate] = useState(new Date());
    const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);

    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isAiSubmitting, setIsAiSubmitting] = useState(false);
    const [isSosModalOpen, setIsSosModalOpen] = useState(false);
    const [sosPlannerDraft, setSosPlannerDraft] = useState<SosPlannerDraft>(() => buildDefaultSosPlannerDraft());
    const [aiChatInput, setAiChatInput] = useState('');
    const [aiThreads, setAiThreads] = useState<AiChatThread[]>(() => [createDefaultAiThread()]);
    const [activeAiThreadId, setActiveAiThreadId] = useState('default_thread');
    const [aiThreadProgressById, setAiThreadProgressById] = useState<Record<string, AiThreadProgress>>({});
    const [typeModalMode, setTypeModalMode] = useState<'create' | 'edit'>('create');
    const [typeEditingOriginalName, setTypeEditingOriginalName] = useState<string | null>(null);
    const [typeDraftName, setTypeDraftName] = useState('');
    const [typeDraftColor, setTypeDraftColor] = useState('#4f7ef7');
    const [filterType, setFilterType] = useState<string>('all');
    const [filterKeyword, setFilterKeyword] = useState('');
    const [searchScope, setSearchScope] = useState<SearchScope>('all');
    const [isGoogleSyncing, setIsGoogleSyncing] = useState(false);
    const [isGoogleCalendarPickerOpen, setIsGoogleCalendarPickerOpen] = useState(false);
    const [googleCalendarOptions, setGoogleCalendarOptions] = useState<GoogleCalendarSelectionItem[]>([]);
    const [selectedGoogleCalendarIds, setSelectedGoogleCalendarIds] = useState<string[]>([]);
    const [googleSyncSession, setGoogleSyncSession] = useState<GoogleCalendarSyncSession | null>(null);
    const [isHeaderToolsOpen, setIsHeaderToolsOpen] = useState(false);
    const [isFilterRefreshActive, setIsFilterRefreshActive] = useState(false);
    const [filtersButtonWidth, setFiltersButtonWidth] = useState<number | null>(null);
    const [modalDraft, setModalDraft] = useState<Omit<CalendarTask, 'id' | 'date'> | null>(null);
    const listScrollTargetRef = useRef<HTMLDivElement | null>(null);
    const dateTransitionTimerRef = useRef<number | null>(null);
    const viewTransitionTimerRef = useRef<number | null>(null);

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
    const googleSyncSnackbarIdRef = useRef<string | number | null>(null);
    const googleSyncCancelButtonIdRef = useRef<string | null>(null);
    const googleSyncCountdownTimerRef = useRef<number | null>(null);
    const googleSyncTimeoutTimerRef = useRef<number | null>(null);
    const googleSyncRequestIdRef = useRef<string | null>(null);
    const googleSyncAbortRejectRef = useRef<((error: Error) => void) | null>(null);
    const googleSyncCanceledByUserRef = useRef(false);
    const googleSyncTimedOutRef = useRef(false);
    const activeAiThreadIdRef = useRef(activeAiThreadId);
    const pendingAiRequestThreadIdRef = useRef<string | null>(null);
    const pendingAiRequestSourceRef = useRef<AiSubmitSource | null>(null);
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

    const createGoogleSyncRequestId = () => `google_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const clearGoogleSyncCountdownTimer = () => {
        if (googleSyncCountdownTimerRef.current !== null) {
            window.clearInterval(googleSyncCountdownTimerRef.current);
            googleSyncCountdownTimerRef.current = null;
        }
    };

    const clearGoogleSyncTimeoutTimer = () => {
        if (googleSyncTimeoutTimerRef.current !== null) {
            window.clearTimeout(googleSyncTimeoutTimerRef.current);
            googleSyncTimeoutTimerRef.current = null;
        }
    };

    const closeGoogleSyncSnackbar = () => {
        if (googleSyncSnackbarIdRef.current !== null) {
            closeSnackbar(googleSyncSnackbarIdRef.current);
            googleSyncSnackbarIdRef.current = null;
        }
        googleSyncCancelButtonIdRef.current = null;
    };

    const stopGoogleSyncProgressIndicators = () => {
        clearGoogleSyncCountdownTimer();
        clearGoogleSyncTimeoutTimer();
        closeGoogleSyncSnackbar();
    };

    const triggerGoogleSyncAbort = (reason: Error) => {
        const reject = googleSyncAbortRejectRef.current;
        if (reject) {
            googleSyncAbortRejectRef.current = null;
            reject(reason);
        }
    };

    const requestCancelGoogleSync = async (reason: 'user' | 'timeout') => {
        const syncRequestId = googleSyncRequestIdRef.current;

        if (reason === 'user') {
            googleSyncCanceledByUserRef.current = true;
        } else {
            googleSyncTimedOutRef.current = true;
        }

        if (syncRequestId) {
            try {
                await invoke('cancel_google_calendar_sync', { syncRequestId });
            } catch (cancelError) {
                console.error('Failed to request Google sync cancellation:', cancelError);
            }
        }

        triggerGoogleSyncAbort(
            reason === 'user'
                ? new Error('Google Calendar sync canceled by user.')
                : new Error('Google Calendar sync timed out.'),
        );
    };

    const updateGoogleSyncCancelButtonLabel = (remainingSeconds: number) => {
        if (!googleSyncCancelButtonIdRef.current) {
            return;
        }

        const buttonElement = document.getElementById(googleSyncCancelButtonIdRef.current);
        if (buttonElement) {
            buttonElement.textContent = `Cancel (${remainingSeconds}s)`;
        }
    };

    const showGoogleSyncSnackbar = (initialRemainingSeconds: number) => {
        closeGoogleSyncSnackbar();

        const buttonId = `google-sync-cancel-btn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        googleSyncCancelButtonIdRef.current = buttonId;

        googleSyncSnackbarIdRef.current = enqueueSnackbar(
            'Waiting for Google OAuth authorization...',
            {
                variant: 'info',
                persist: true,
                action: () => (
                    <button
                        id={buttonId}
                        type="button"
                        className="sync-snackbar-cancel-btn"
                        onClick={() => {
                            void requestCancelGoogleSync('user');
                        }}
                    >
                        {`Cancel (${initialRemainingSeconds}s)`}
                    </button>
                ),
            },
        );
    };

    const startGoogleSyncProgressIndicators = () => {
        const deadline = Date.now() + GOOGLE_SYNC_TIMEOUT_MS;
        const getRemainingSeconds = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

        showGoogleSyncSnackbar(getRemainingSeconds());

        clearGoogleSyncCountdownTimer();
        googleSyncCountdownTimerRef.current = window.setInterval(() => {
            updateGoogleSyncCancelButtonLabel(getRemainingSeconds());
        }, 1000);

        clearGoogleSyncTimeoutTimer();
        googleSyncTimeoutTimerRef.current = window.setTimeout(() => {
            void requestCancelGoogleSync('timeout');
        }, GOOGLE_SYNC_TIMEOUT_MS);
    };

    const clearAiResultPollTimer = () => {
        if (aiResultPollTimerRef.current !== null) {
            window.clearTimeout(aiResultPollTimerRef.current);
            aiResultPollTimerRef.current = null;
        }
    };

    const updateThreadProgress = (threadId: string, progress: AiThreadProgress) => {
        setAiThreadProgressById(prev => ({
            ...prev,
            [threadId]: progress,
        }));
    };

    const stopAiSubmitting = (options?: { closeConnection?: boolean; reason?: StopAiSubmitReason }) => {
        const reason = options?.reason ?? 'interrupted';
        const pendingThreadId = pendingAiRequestThreadIdRef.current;
        const pendingSource = pendingAiRequestSourceRef.current;

        clearAiResultPollTimer();
        aiRequestDeadlineRef.current = null;
        pendingAiRequestThreadIdRef.current = null;
        pendingAiRequestSourceRef.current = null;
        setIsAiSubmitting(false);

        if (pendingSource === 'sos' && pendingThreadId) {
            setAiThreadProgressById(prev => {
                const existing = prev[pendingThreadId];
                const basePercent = existing ? existing.percent : 0;
                const finalProgress: AiThreadProgress = {
                    percent: reason === 'completed' ? 100 : Math.min(100, Math.max(8, basePercent)),
                    status: reason === 'completed'
                        ? 'SOS plan ready. Continue chatting below to refine it.'
                        : reason === 'canceled'
                            ? 'SOS run canceled. You can restart from the SOS button anytime.'
                            : reason === 'failed'
                                ? 'SOS run failed. Please adjust the range or try again.'
                                : 'SOS run interrupted.',
                    isActive: false,
                    mode: 'sos',
                };

                return {
                    ...prev,
                    [pendingThreadId]: finalProgress,
                };
            });
        }

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
        stopAiSubmitting({ closeConnection: true, reason: 'canceled' });
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
                        itemKind: task.itemKind,
                        ddl: task.ddl,
                        startTime: task.startTime,
                        endTime: task.endTime,
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
        clearWsDisconnectedSnackbarRef(wsDisconnectedSnackbarIdRef);
    };

    const clearWsReconnectingSnackbar = () => {
        clearWsReconnectingSnackbarRef(wsReconnectingSnackbarIdRef);
    };

    const enqueueWsDisconnectedSnackbar = () => {
        enqueueWsDisconnectedSnackbarRef({
            wsDisconnectedSnackbarIdRef,
            wsReconnectingSnackbarIdRef,
            connectWebSocket,
        });
    };

    const requestServerShutdown = async () => {
        return await requestServerShutdownGateway(ws);
    };

    const connectWebSocket = () => {
        connectWebSocketGateway({
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
            setAiThreadProgress: updateThreadProgress,
            stopAiSubmitting,
            connectWebSocket,
            appendMessageToThread,
            appendTaskEventMessageToActiveThread,
            aiRequestTimeoutMs: AI_REQUEST_TIMEOUT_MS,
        });
    };

    useEffect(() => {
        isUnmountingRef.current = false;
        connectWebSocket();

        return () => {
            isUnmountingRef.current = true;
            stopAiSubmitting({ reason: 'interrupted' });
            stopGoogleSyncProgressIndicators();
            googleSyncRequestIdRef.current = null;
            googleSyncAbortRejectRef.current = null;
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

                stopAiSubmitting({ reason: 'interrupted' });
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

    const handleJumpToDate = (targetDate: Date) => {
        if (viewTransition) {
            return;
        }

        if (viewMode !== 'list' && dateTransition) {
            return;
        }

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
        return () => {
            if (dateTransitionTimerRef.current !== null) {
                window.clearTimeout(dateTransitionTimerRef.current);
            }

            cancelViewTransition();
            clearFilterRefreshAnimation();
            stopGoogleSyncProgressIndicators();
        };
    }, []);

    useEffect(() => {
        if (isDataLoaded) {
            return;
        }

        let isMounted = true;

        const loadData = async () => {
            try {
                // const migrationResult = await migrateLocalStorageToFileStorage();
                // if (migrationResult.success && migrationResult.migratedKeys.length > 0) {
                //     console.log('[Migration] Successfully migrated keys:', migrationResult.migratedKeys);
                // } else if (migrationResult.errors.length > 0) {
                //     console.error('[Migration] Migration errors:', migrationResult.errors);
                // }

                if (!isMounted) {
                    return;
                }

                const loadedTypes = await loadTaskTypesFromTempDb();
                const loadedColors = await loadTaskTypeColorsFromTempDb(loadedTypes);
                const loadedTasks = await loadTasksFromTempDb();

                setTaskTypes(loadedTypes);
                setTaskTypeColors(loadedColors);
                setTasks(loadedTasks);
                setIsDataLoaded(true);

                // if (migrationResult.success && migrationResult.migratedKeys.length > 0) {
                //     clearLocalStorageData();
                //     console.log('[Migration] LocalStorage data cleared after successful migration.');
                // }
            } catch (error) {
                console.error('[App] Failed to load data:', error);
                if (isMounted) {
                    setIsDataLoaded(true);
                }
            }
        };

        void loadData();

        return () => {
            isMounted = false;
        };
    }, [isDataLoaded]);

    useEffect(() => {
        if (!isDataLoaded) {
            return;
        }
        saveTasksToTempDb(tasks);
    }, [tasks, isDataLoaded]);

    useEffect(() => {
        if (!isDataLoaded) {
            return;
        }
        saveTaskTypesToTempDb(taskTypes);
    }, [taskTypes, isDataLoaded]);

    useEffect(() => {
        if (!isDataLoaded) {
            return;
        }
        saveTaskTypeColorsToTempDb(taskTypeColors);
    }, [taskTypeColors, isDataLoaded]);

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
            return (
                <ListView
                    listTaskGroups={listTaskGroups}
                    listScrollTargetRef={listScrollTargetRef}
                    getTaskStyle={getTaskStyle}
                    openTaskModal={openTaskModal}
                />
            );
        }

        if (mode === 'day') {
            return (
                <DayView
                    currentDate={displayDate}
                    getTasksForDay={getTasksForDay}
                    getTaskStyle={getTaskStyle}
                    openTaskModal={openTaskModal}
                />
            );
        }

        if (mode === 'week') {
            return (
                <WeekView
                    weekDays={generateWeekDays(displayDate)}
                    getTasksForDay={getTasksForDay}
                    getTaskStyle={getTaskStyle}
                    openTaskModal={openTaskModal}
                    handleDayClick={handleDayClick}
                />
            );
        }

        return (
            <MonthView
                calendarDays={generateCalendarDays(displayDate)}
                getTasksForDay={getTasksForDay}
                getTaskStyle={getTaskStyle}
                openTaskModal={openTaskModal}
                handleDayClick={handleDayClick}
            />
        );
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

    const closePanelSidebars = () => {
        setModalDraft(null);
        setSelectedTaskId(null);
        setIsCreatingTask(false);
        setIsTypeModalOpen(false);
        setIsGoogleCalendarPickerOpen(false);
    };

    const closeOverlaySidebars = () => {
        setIsAiModalOpen(false);
        setIsSosModalOpen(false);
    };

    const openTaskModal = (task: CalendarTask) => {
        closeOverlaySidebars();
        setIsCreatingTask(false);
        setSelectedTaskId(task.id);
        setModalDraft({
            title: task.title,
            type: task.type,
            itemKind: task.itemKind,
            ddl: task.ddl,
            startTime: task.startTime,
            endTime: task.endTime,
            note: task.note,
        });
    };

    const openTaskModalFromPreview = (preview: AiTaskPreview) => {
        openTaskModal({
            id: preview.id,
            title: preview.title,
            date: preview.date,
            itemKind: preview.itemKind,
            ddl: preview.ddl,
            startTime: preview.startTime,
            endTime: preview.endTime,
            type: preview.type,
            note: preview.note,
        });
    };

    const openCreateTaskModal = (date: Date) => {
        closeOverlaySidebars();
        const defaultType = taskTypes[0] ?? 'work';
        setIsCreatingTask(true);
        setSelectedTaskId(null);
        console.log('Creating task for date:', date);
        setCreatingTaskDate(date);
        setModalDraft({
            title: '',
            type: defaultType,
            itemKind: 'task',
            ddl: '09:00',
            startTime: '09:00',
            endTime: '10:00',
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
        setIsTypeModalOpen(false);
        resetTypeModalState();
    };

    const closeTaskModal = () => {
        if (isTypeModalOpen) {
            closeTypeModal();
        }
        setSelectedTaskId(null);
        setIsCreatingTask(false);
        setModalDraft(null);
    };

    const openAiCreateModal = () => {
        if (isAiModalOpen) {
            closeAiCreateModal();
            return;
        }
        closePanelSidebars();
        setIsSosModalOpen(false);
        setIsAiModalOpen(true);
        setAiChatInput('');
    };

    const openSosPlannerModal = () => {
        if (isSosModalOpen) {
            setIsSosModalOpen(false);
            return;
        }
        closePanelSidebars();
        setIsAiModalOpen(false);
        setSosPlannerDraft(prev => ({
            userPrompt: prev.userPrompt.trim() ? prev.userPrompt : DEFAULT_SOS_USER_PROMPT,
        }));
        setIsSosModalOpen(true);
    };

    const closeSosPlannerModal = () => {
        setIsSosModalOpen(false);
    };

    const sendAiRequest = (options: {
        threadId: string;
        userInput: string;
        source: AiSubmitSource;
    }) => {
        const { threadId, userInput, source } = options;
        setIsAiSubmitting(true);
        pendingAiRequestThreadIdRef.current = threadId;
        pendingAiRequestSourceRef.current = source;

        const timeoutMs = AI_REQUEST_TIMEOUT_MS;
        aiRequestDeadlineRef.current = Date.now() + timeoutMs;

        if (source === 'sos') {
            updateThreadProgress(threadId, {
                percent: 0,
                status: 'Waiting for AI progress updates...',
                isActive: true,
                mode: 'sos',
            });
        }

        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
            appendMessageToThread(threadId, 'system', 'Unable to send because AI service is disconnected.');
            stopAiSubmitting({ reason: 'failed' });
            enqueueWsDisconnectedSnackbar();
            return;
        }

        ws.current?.send(`ai_message: ${JSON.stringify({
            message: userInput,
            thread_id: threadId,
        })}`);

        aiResultPollTimerRef.current = window.setTimeout(() => {
            if (!isAiSubmittingRef.current) {
                return;
            }

            if (aiRequestDeadlineRef.current !== null && Date.now() > aiRequestDeadlineRef.current) {
                appendMessageToThread(threadId, 'system', 'AI response timed out. Please try again.');
                stopAiSubmitting({ reason: 'failed' });
            }
        }, timeoutMs + 50);
    };

    const runSosPlannerWithDraft = (draft: SosPlannerDraft) => {
        if (isAiSubmittingRef.current) {
            enqueueSnackbar('Please wait for the current AI request to finish.', { variant: 'info' });
            return;
        }

        const userIntent = draft.userPrompt.trim() || DEFAULT_SOS_USER_PROMPT;

        const threadId = createAiThreadId();
        const now = Date.now();
        const titleSnippet = userIntent.length > 18 ? `${userIntent.slice(0, 18)}...` : userIntent;
        const title = `SOS ${titleSnippet}`;
        const sosPrompt = [
            'SOS MODE: I need an emergency schedule rescue.',
            `User intent: ${userIntent}`,
            '',
            'Rules:',
            '- Fetch calendar tasks/events yourself via the available tools before planning.',
            '- Call update_ai_progress at major milestones with meaningful status text.',
            '- You must actively re-plan and re-arrange tasks/events, not just analyze them.',
            '- Do not return an analysis-only response.',
            '- Produce a concrete revised schedule with specific task order and time blocks.',
            '- Prioritize urgent and high-impact work first.',
            '- Resolve conflicts and provide realistic buffers.',
            '- Return a concise completion analysis with checkpoints, order, and estimated finish times.',
            '- Use markdown headings and a numbered action analysis.',
        ].join('\n');

        const newThread: AiChatThread = {
            id: threadId,
            title,
            messages: [
                {
                    id: createAiMessageId(),
                    role: 'assistant',
                    text: 'SOS planner started. I will rearrange your schedule based on your sentence and return an executable finish plan.',
                    createdAt: now,
                },
                {
                    id: createAiMessageId(),
                    role: 'user',
                    text: sosPrompt,
                    createdAt: now + 1,
                },
            ],
            createdAt: now,
            updatedAt: now + 1,
        };

        setAiThreads(prev => [newThread, ...prev]);
        setActiveAiThreadId(threadId);
        closeSosPlannerModal();

        setIsAiModalOpen(true);
        setAiChatInput('');

        sendAiRequest({
            threadId,
            userInput: sosPrompt,
            source: 'sos',
        });
    };

    const runSosPlanner = () => {
        runSosPlannerWithDraft(sosPlannerDraft);
    };

    const closeAiCreateModal = () => {
        if (!isAiModalOpen) {
            return;
        }

        if (isAiSubmittingRef.current) {
            const shouldCancelAndClose = window.confirm('AI is still processing your request. Cancel and close this window?');
            if (!shouldCancelAndClose) {
                return;
            }

            cancelActiveAiRequest('AI request canceled because the chat window was closed.');
        }

        setIsAiModalOpen(false);
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

    const deleteAiThread = (threadId: string) => {
        if (isAiSubmitting) {
            enqueueSnackbar('Cannot delete a thread while AI is processing.', { variant: 'warning' });
            return;
        }
        setAiThreads(prev => {
            const remaining = prev.filter(t => t.id !== threadId);
            if (remaining.length === 0) {
                const fallback = createDefaultAiThread();
                setActiveAiThreadId(fallback.id);
                return [fallback];
            }
            if (threadId === activeAiThreadId) {
                setActiveAiThreadId(remaining[0].id);
            }
            return remaining;
        });
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

        sendAiRequest({
            threadId: targetThreadId,
            userInput,
            source: 'chat',
        });
    };

    const openTypeCreateModal = () => {
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
                itemKind: modalDraft.itemKind,
                ddl: modalDraft.itemKind === 'task' ? modalDraft.ddl : '',
                startTime: modalDraft.itemKind === 'event' ? modalDraft.startTime : '',
                endTime: modalDraft.itemKind === 'event' ? modalDraft.endTime : '',
                note: modalDraft.note,
                date: buildDateString(dateForNewTask),
            };
            setTasks(prev => [...prev, newTask]);
            enqueueSnackbar('Item created.', { variant: 'success' });
        } else if (selectedTask) {
            setTasks(prev => prev.map(task => (
                task.id === selectedTask.id
                    ? {
                        ...task,
                        title: modalDraft.title.trim(),
                        itemKind: modalDraft.itemKind,
                        ddl: modalDraft.itemKind === 'task' ? modalDraft.ddl : '',
                        startTime: modalDraft.itemKind === 'event' ? modalDraft.startTime : '',
                        endTime: modalDraft.itemKind === 'event' ? modalDraft.endTime : '',
                        note: modalDraft.note,
                        type: modalDraft.type,
                    }
                    : task
            )));
            enqueueSnackbar('Item updated.', { variant: 'success' });
        }

        closeTaskModal();
    };

    const deleteTask = () => {
        if (!selectedTask) {
            return;
        }

        setTasks(prev => prev.filter(task => task.id !== selectedTask.id));
        closeTaskModal();
        enqueueSnackbar('Item deleted.', { variant: 'error' });
    };

    const handleDayClick = (day: CalendarDay) => {
        // const dayTasks = getTasksForDay(day);
        const date = new Date(day.year, day.month, day.day);
        // if (dayTasks.length === 0) {
            openCreateTaskModal(date);
            return;
        // }
    };

    const getSyncErrorMessage = (error: unknown) => {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }

        if (typeof error === 'string' && error.trim()) {
            return error;
        }

        if (error && typeof error === 'object') {
            const maybeMessage = (error as { message?: unknown }).message;
            if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
                return maybeMessage;
            }

            const maybeError = (error as { error?: unknown }).error;
            if (typeof maybeError === 'string' && maybeError.trim()) {
                return maybeError;
            }

            try {
                const serialized = JSON.stringify(error);
                if (serialized && serialized !== '{}') {
                    return serialized;
                }
            } catch {
                // Ignore serialization failures and fall through to default message.
            }
        }

        return 'Unknown sync error';
    };

    const closeGoogleCalendarPicker = (clearSession = true) => {
        setIsGoogleCalendarPickerOpen(false);
        setGoogleCalendarOptions([]);
        setSelectedGoogleCalendarIds([]);
        if (clearSession) {
            setGoogleSyncSession(null);
        }
    };

    const toggleGoogleCalendarSelection = (calendarId: string) => {
        setSelectedGoogleCalendarIds(prev => (
            prev.includes(calendarId)
                ? prev.filter(id => id !== calendarId)
                : [...prev, calendarId]
        ));
    };

    const syncGoogleCalendar = async () => {
        if (isGoogleSyncing || isGoogleCalendarPickerOpen) {
            return;
        }

        setIsGoogleSyncing(true);
        googleSyncCanceledByUserRef.current = false;
        googleSyncTimedOutRef.current = false;
        googleSyncRequestIdRef.current = null;

        const abortPromise = new Promise<never>((_, reject) => {
            googleSyncAbortRejectRef.current = (error: Error) => reject(error);
        });

        startGoogleSyncProgressIndicators();
        try {
            const beginOAuthPromise = invoke<GoogleCalendarSyncSession>('begin_google_calendar_sync');
            // Keep an attached rejection handler to avoid unhandled rejection when UI cancellation wins the race.
            void beginOAuthPromise.catch(() => undefined);

            const session = await Promise.race([
                beginOAuthPromise,
                abortPromise,
            ]);

            if (session.calendars.length === 0) {
                enqueueSnackbar('No importable Google calendars found in this account.', { variant: 'warning' });
                return;
            }

            setGoogleSyncSession(session);
            setGoogleCalendarOptions(session.calendars);
            setSelectedGoogleCalendarIds(session.calendars.map(calendar => calendar.id));
            closeOverlaySidebars();
            setIsGoogleCalendarPickerOpen(true);
        } catch (error) {
            if (googleSyncTimedOutRef.current) {
                enqueueSnackbar('Google OAuth timed out and was canceled.', { variant: 'warning' });
            } else if (googleSyncCanceledByUserRef.current) {
                enqueueSnackbar('Google OAuth canceled.', { variant: 'info' });
            } else {
                console.error('Google Calendar sync setup failed:', error);
                const message = getSyncErrorMessage(error);
                enqueueSnackbar(`Google Calendar sync setup failed: ${message}`, { variant: 'error' });
            }
        } finally {
            stopGoogleSyncProgressIndicators();
            googleSyncAbortRejectRef.current = null;
            googleSyncRequestIdRef.current = null;
            googleSyncCanceledByUserRef.current = false;
            googleSyncTimedOutRef.current = false;
            setIsGoogleSyncing(false);
        }
    };

    const confirmGoogleCalendarImport = async () => {
        if (isGoogleSyncing || !googleSyncSession) {
            return;
        }

        const selectedIds = [...selectedGoogleCalendarIds];
        if (selectedIds.length === 0) {
            enqueueSnackbar('Please select at least one calendar to import.', { variant: 'warning' });
            return;
        }

        setIsGoogleCalendarPickerOpen(false);
        setIsGoogleSyncing(true);

        const syncRequestId = createGoogleSyncRequestId();
        googleSyncRequestIdRef.current = syncRequestId;

        try {
            const googleEvents = await invoke<GoogleCalendarNormalizedEvent[]>('sync_google_calendar_events', {
                accessToken: googleSyncSession.accessToken,
                selectedCalendarIds: selectedIds,
                syncRequestId,
            });

            const existingMap = await loadGoogleEventTaskMapFromTempDb();

            let nextId = nextTaskIdRef.current;
            const nextTaskById = new Map<number, CalendarTask>();
            const nextTaskOrder: number[] = [];
            for (const task of tasksRef.current) {
                nextTaskById.set(task.id, task);
                nextTaskOrder.push(task.id);
            }

            const nextMap: Record<string, number> = {};
            for (const googleEvent of googleEvents) {
                const mappedTaskId = existingMap[googleEvent.eventKey];
                const reusableTaskId = Number.isInteger(mappedTaskId) && nextTaskById.has(mappedTaskId)
                    ? mappedTaskId
                    : null;

                const taskId = reusableTaskId ?? nextId;
                if (reusableTaskId === null) {
                    nextId += 1;
                    nextTaskOrder.push(taskId);
                }

                nextMap[googleEvent.eventKey] = taskId;
                nextTaskById.set(taskId, buildTaskFromGoogleEvent(googleEvent, taskId));
            }

            const staleTaskIds = new Set(
                Object.entries(existingMap)
                    .filter(([eventKey]) => !Object.prototype.hasOwnProperty.call(nextMap, eventKey))
                    .map(([, taskId]) => taskId)
                    .filter(taskId => Number.isInteger(taskId)),
            );

            const mergedTasks = nextTaskOrder
                .filter(taskId => !staleTaskIds.has(taskId))
                .map(taskId => nextTaskById.get(taskId))
                .filter((task): task is CalendarTask => Boolean(task));

            tasksRef.current = mergedTasks;
            setTasks(mergedTasks);
            await saveGoogleEventTaskMapToTempDb(nextMap);

            setTaskTypes(prev => prev.includes(GOOGLE_SYNC_TYPE) ? prev : [...prev, GOOGLE_SYNC_TYPE]);
            setTaskTypeColors(prev => ({
                ...prev,
                [GOOGLE_SYNC_TYPE]: prev[GOOGLE_SYNC_TYPE] ?? '#8ac7ff',
            }));

            enqueueSnackbar(`Google Calendar sync completed: ${googleEvents.length} events imported.`, {
                variant: 'success',
            });
        } catch (error) {
            console.error('Google Calendar sync failed:', error);
            const message = getSyncErrorMessage(error);
            if (message.toLowerCase().includes('canceled by user')) {
                enqueueSnackbar('Google Calendar sync canceled.', { variant: 'info' });
            } else {
                enqueueSnackbar(`Google Calendar sync failed: ${message}`, { variant: 'error' });
            }
        } finally {
            googleSyncRequestIdRef.current = null;
            setGoogleSyncSession(null);
            setGoogleCalendarOptions([]);
            setSelectedGoogleCalendarIds([]);
            setIsGoogleSyncing(false);
        }
    };

    const displayDate = dateTransition?.nextDate ?? currentDate;
    const effectiveViewMode: ViewMode = viewTransition?.toMode ?? viewMode;
    const displayTitle = effectiveViewMode === 'week'
        ? getWeekTitle(displayDate)
        : effectiveViewMode === 'day'
            ? getDayTitle(displayDate)
            : effectiveViewMode === 'list'
                ? 'Item List'
                : `${displayDate.toLocaleString('default', { month: 'long' })} ${displayDate.getFullYear()}`;
    const filtersButtonText = isHeaderToolsOpen ? 'hide filters' : 'filters';
    const activeAiThread = aiThreads.find(thread => thread.id === activeAiThreadId) ?? aiThreads[0] ?? null;
    const activeThreadProgress = aiThreadProgressById[activeAiThreadId] ?? null;


    useEffect(() => {
        if (!isAiModalOpen) {
            return;
        }
        aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [isAiModalOpen, activeAiThreadId, aiThreads]);

    return (
        <main className={`calendar-container ${viewMode === 'list' ? 'list-scroll-mode' : ''} ${isFilterRefreshActive ? 'filter-refresh-active' : ''}`}>
            <SnackbarProvider maxSnack={4}/>
            <HeaderControls
                effectiveViewMode={effectiveViewMode}
                displayTitle={displayTitle}
                currentDisplayDate={displayDate}
                dateTransitionActive={dateTransition !== null}
                viewTransitionActive={viewTransition !== null}
                isHeaderToolsOpen={isHeaderToolsOpen}
                filtersButtonWidth={filtersButtonWidth}
                filtersButtonText={filtersButtonText}
                filtersButtonMeasureRef={filtersButtonMeasureRef}
                filterType={filterType}
                filterKeyword={filterKeyword}
                searchScope={searchScope}
                taskTypes={taskTypes}
                onPrev={handlePrevMonth}
                onNext={handleNextMonth}
                onToday={handleToday}
                onJumpToDate={handleJumpToDate}
                onOpenCreateEvent={() => openCreateTaskModal(new Date())}
                onOpenAiChat={openAiCreateModal}
                onOpenSosPlanner={openSosPlannerModal}
                onSyncGoogleCalendar={syncGoogleCalendar}
                isGoogleSyncing={isGoogleSyncing || isGoogleCalendarPickerOpen}
                onViewChange={handleViewChange}
                onToggleFilters={() => setIsHeaderToolsOpen(prev => !prev)}
                onFilterTypeChange={setFilterType}
                onFilterKeywordChange={setFilterKeyword}
                onSearchScopeChange={setSearchScope}
            />
            
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

            <TaskModal
                    modalDraft={modalDraft}
                    isCreatingTask={isCreatingTask}
                    selectedTask={selectedTask}
                    creatingTaskDate={creatingTaskDate}
                    taskTypes={taskTypes}
                    addTypeOptionValue={ADD_TYPE_OPTION_VALUE}
                    onClose={closeTaskModal}
                    onOpenTypeCreateModal={openTypeCreateModal}
                    onOpenTypeEditModal={openTypeEditModal}
                    onDeleteTask={deleteTask}
                    onSaveTask={saveTaskModal}
                    setModalDraft={setModalDraft}
                />

            <TypeModal
                isOpen={isTypeModalOpen}
                mode={typeModalMode}
                editingOriginalName={typeEditingOriginalName}
                draftName={typeDraftName}
                draftColor={typeDraftColor}
                otherType={OTHER_TYPE}
                onClose={closeTypeModal}
                onSave={addTaskTypeWithColor}
                onDeleteAndMoveToOther={deleteTypeAndMoveToOther}
                setDraftName={setTypeDraftName}
                setDraftColor={setTypeDraftColor}
            />

            <aside className={`panel-sidebar ${isGoogleCalendarPickerOpen ? 'open' : ''}`}>
                <div className="panel-sidebar-header">
                    <h2>Select calendars to import</h2>
                    <button className="ai-sidebar-close" onClick={() => closeGoogleCalendarPicker()} aria-label="Close">✕</button>
                </div>

                <div className="panel-sidebar-body">
                    <p className="task-modal-meta">
                        Selected {selectedGoogleCalendarIds.length} of {googleCalendarOptions.length} calendars.
                    </p>

                    <div className="google-calendar-picker-actions-row">
                        <button type="button" className="task-modal-btn" onClick={() => setSelectedGoogleCalendarIds(googleCalendarOptions.map(calendar => calendar.id))}>
                            Select all
                        </button>
                        <button type="button" className="task-modal-btn" onClick={() => setSelectedGoogleCalendarIds([])}>
                            Clear all
                        </button>
                    </div>

                    <div className="google-calendar-picker-list" role="group" aria-label="Google calendars">
                        {googleCalendarOptions.map(calendar => (
                            <label key={calendar.id} className="google-calendar-picker-item">
                                <input
                                    type="checkbox"
                                    checked={selectedGoogleCalendarIds.includes(calendar.id)}
                                    onChange={() => toggleGoogleCalendarSelection(calendar.id)}
                                />
                                <span className="google-calendar-picker-name">{calendar.name}</span>
                            </label>
                        ))}
                    </div>

                    <div className="panel-sidebar-actions">
                        <button type="button" className="task-modal-btn" onClick={() => closeGoogleCalendarPicker()}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="task-modal-btn primary"
                            onClick={confirmGoogleCalendarImport}
                            disabled={selectedGoogleCalendarIds.length === 0}
                        >
                            Import selected calendars
                        </button>
                    </div>
                </div>
            </aside>

            <aside className={`sos-sidebar ${isSosModalOpen ? 'open' : ''}`}>
                    <div className="sos-sidebar-header">
                        <h2>SOS Schedule Rescue</h2>
                        <button className="ai-sidebar-close" onClick={closeSosPlannerModal} aria-label="Close SOS sidebar">✕</button>
                    </div>

                    <div className="sos-sidebar-body">
                        <p className="sos-sidebar-description">
                            Enter one sentence to tell AI how to auto-plan your schedule. You can also run with the default prompt.
                        </p>

                        <label className="task-modal-label" htmlFor="sos-user-prompt">One-line request (optional)</label>
                        <textarea
                            id="sos-user-prompt"
                            className="task-modal-textarea sos-sidebar-textarea"
                            value={sosPlannerDraft.userPrompt}
                            placeholder={DEFAULT_SOS_USER_PROMPT}
                            onChange={(event) => setSosPlannerDraft(prev => ({ ...prev, userPrompt: event.target.value }))}
                            disabled={isAiSubmitting}
                        />

                        <div className="sos-sidebar-actions">
                            <button className="task-modal-btn" onClick={closeSosPlannerModal} disabled={isAiSubmitting}>Cancel</button>
                            <button className="task-modal-btn primary" onClick={runSosPlanner} disabled={isAiSubmitting}>Run SOS Plan</button>
                        </div>
                    </div>
                </aside>

            <AiChatSidebar
                isOpen={isAiModalOpen}
                isSubmitting={isAiSubmitting}
                aiThreads={aiThreads}
                activeAiThreadId={activeAiThreadId}
                activeAiThread={activeAiThread}
                activeThreadProgress={activeThreadProgress}
                aiChatInput={aiChatInput}
                aiMessagesEndRef={aiMessagesEndRef}
                onClose={closeAiCreateModal}
                onCreateThread={createNewAiThread}
                onDeleteThread={deleteAiThread}
                onSwitchThread={setActiveAiThreadId}
                onInputChange={handleAiChatInputChange}
                onSendMessage={handleSendAiChatMessage}
                onCancelRequest={() => cancelActiveAiRequest('AI request canceled.')}
                openTaskModalFromPreview={openTaskModalFromPreview}
                getTaskStyle={getTaskStyle}
            />
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
