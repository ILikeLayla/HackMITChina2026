import { useEffect, useRef, useState } from "react";
import "./App.css";
import "./styles/calendar-views.css";
import "./styles/ai-chat.css";
import "./styles/websocket-gateway.css";
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
import { SnackbarProvider, enqueueSnackbar } from 'notistack';
import { AiChatModal, type AiChatRole, type AiChatThread, type AiTaskPreview } from "./ai_chat";
import { TaskModal } from "./task_modal";
import { TypeModal } from "./type_modal";
import { HeaderControls } from "./header_controls";
import {
    clearWsDisconnectedSnackbar as clearWsDisconnectedSnackbarRef,
    clearWsReconnectingSnackbar as clearWsReconnectingSnackbarRef,
    connectWebSocketGateway,
    enqueueWsDisconnectedSnackbar as enqueueWsDisconnectedSnackbarRef,
    requestServerShutdown as requestServerShutdownGateway,
} from "./websocket_gateway";

async function get_events() {
    console.log(await invoke('get_events'));
}

const MODAL_CLOSE_ANIMATION_MS = 180;
const FILTER_REFRESH_ANIMATION_MS = 180;
const AI_REQUEST_TIMEOUT_MS = 180000;

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
    const displayTitle = effectiveViewMode === 'week'
        ? getWeekTitle(displayDate)
        : effectiveViewMode === 'day'
            ? getDayTitle(displayDate)
            : effectiveViewMode === 'list'
                ? 'Task List'
                : `${displayDate.toLocaleString('default', { month: 'long' })} ${displayDate.getFullYear()}`;
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
            <HeaderControls
                effectiveViewMode={effectiveViewMode}
                displayTitle={displayTitle}
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
                onOpenCreateEvent={() => openCreateTaskModal(new Date())}
                onOpenAiChat={openAiCreateModal}
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

            {modalDraft && (
                <TaskModal
                    modalDraft={modalDraft}
                    isTaskModalClosing={isTaskModalClosing}
                    shouldElevateTaskModal={shouldElevateTaskModal}
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
            )}

            <TypeModal
                isOpen={isTypeModalOpen}
                isClosing={isTypeModalClosing}
                shouldElevate={shouldElevateTypeModal}
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

            <AiChatModal
                isOpen={isAiModalOpen}
                isClosing={isAiModalClosing}
                isSubmitting={isAiSubmitting}
                aiThreads={aiThreads}
                activeAiThreadId={activeAiThreadId}
                activeAiThread={activeAiThread}
                aiChatInput={aiChatInput}
                aiMessagesEndRef={aiMessagesEndRef}
                onBackdropClose={closeAiCreateModal}
                onCreateThread={createNewAiThread}
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
