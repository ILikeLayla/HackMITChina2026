from langchain.tools import tool
from langchain.agents import create_agent
from langchain.messages import SystemMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver  

import getpass
import os

if not os.getenv("DEEPSEEK_API_KEY"):
    os.environ["DEEPSEEK_API_KEY"] = input("Enter your DeepSeek API key: ")


import asyncio
import websockets
import json
import logging
import os
import sys
import uuid

HEALTH_CHECK_HOST = "127.0.0.1"
HEALTH_CHECK_PORT = 8766

# Toggle this in code to enable/disable process auto-restart after websocket disconnect.
AUTO_RESTART_ON_DISCONNECT = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("langchain-server")

task_creation_results = asyncio.Queue()
calendar_query_results: dict[str, asyncio.Future] = {}
active_websocket = None
allow_restart_on_disconnect = AUTO_RESTART_ON_DISCONNECT
shutdown_event = asyncio.Event()

from langchain_deepseek import ChatDeepSeek

model = ChatDeepSeek(
    model="deepseek-chat",
    temperature=0,
    max_tokens=None,
    timeout=None,
    max_retries=2,
    # other params...
)


def restart_current_process(reason: str):
    logger.warning("Restarting server process: %s", reason)
    python_executable = sys.executable
    argv = [python_executable, *sys.argv]
    os.execv(python_executable, argv)


async def send_frontend_request(prefix: str, payload: dict, timeout_seconds: float = 15.0):
    if active_websocket is None:
        return {"ok": False, "message": "No active websocket client connection."}

    request_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    result_future = loop.create_future()
    calendar_query_results[request_id] = result_future

    try:
        request_payload = {
            **payload,
            "request_id": request_id,
        }
        await active_websocket.send(f"{prefix}: {json.dumps(request_payload)}")
        result_payload = await asyncio.wait_for(result_future, timeout=timeout_seconds)
        return result_payload
    except asyncio.TimeoutError:
        logger.warning("Timeout waiting for frontend response (%s)", prefix)
        return {"ok": False, "message": "No response from calendar app."}
    finally:
        calendar_query_results.pop(request_id, None)

@tool
async def create_calendar_task(title: str, date: str, taskType: str, time: str, notes: str):
    """Creates a calendar task with the given details.
    Args:
        title: The title of the task.
        date: The date of the task in YYYY-MM-DD format.
        taskType: The type of the task (e.g., "meeting", "reminder").
        time: The time of the task in HH:MM format.
        notes: Additional notes for the task.
    Returns:
        A confirmation message about the task creation result.
    """
    logger.info(
        "create_calendar_task called with title=%s date=%s type=%s time=%s",
        title,
        date,
        taskType,
        time,
    )

    task_json = json.dumps({
        "title": title,
        "date": date,
        "type": taskType,
        "time": time,
        "note": notes
    })
    logger.info("Task payload serialized: %s", task_json)

    if active_websocket is None:
        logger.error("No active websocket client is available for task creation")
        return "Failed to create task: No active websocket client connection."

    logger.info("Sending task creation request over websocket")
    await active_websocket.send(f"newing_task: {task_json}")

    # wait for the result from the calendar system
    try:
        logger.info("Waiting for task creation result from queue")
        result_info = await asyncio.wait_for(task_creation_results.get(), timeout=50)
        logger.info("Received task creation result recieved successfully: %s", result_info)
        return f"Task creation result: {result_info}"
    except TimeoutError:
        logger.warning("Timeout waiting for task creation result")
        return "Failed to create task: No response from calendar system."

@tool
async def get_all_tasks():
    """Returns lightweight task summaries (id, title, date, time, type) without notes."""
    logger.info("get_all_tasks called")

    result_payload = await send_frontend_request("get_all_tasks", {}, timeout_seconds=15)
    if not result_payload.get("ok", True):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to get tasks: {message}"

    tasks = result_payload.get("tasks", [])
    logger.info("get_all_tasks received %s tasks", len(tasks))
    return tasks


@tool
async def get_task_by_id(task_id: int):
    """Returns a single task by its numeric id."""
    logger.info("get_task_by_id called with task_id=%s", task_id)

    result_payload = await send_frontend_request("get_task_by_id", {"task_id": task_id}, timeout_seconds=15)
    if not result_payload.get("ok", True):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to get task: {message}"

    task = result_payload.get("task")
    if task is None:
        logger.info("Task id=%s not found", task_id)
        return f"Task with id {task_id} was not found."
    return task


@tool
async def update_calendar_task(
    task_id: int,
    title: str = "",
    date: str = "",
    taskType: str = "",
    time: str = "",
    notes: str = "",
):
    """Updates one calendar task by id. Empty string fields are ignored."""
    logger.info("update_calendar_task called with task_id=%s", task_id)

    updates = {}
    if title:
        updates["title"] = title
    if date:
        updates["date"] = date
    if taskType:
        updates["type"] = taskType
    if time:
        updates["time"] = time
    if notes:
        updates["note"] = notes

    if not updates:
        return "No updates were provided."

    result_payload = await send_frontend_request(
        "update_task",
        {
            "task_id": task_id,
            "updates": updates,
        },
        timeout_seconds=15,
    )

    if not result_payload.get("ok", False):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to update task: {message}"

    updated_task = result_payload.get("task")
    return f"Task updated successfully: {updated_task}"


@tool
async def delete_calendar_task(task_id: int):
    """Deletes one calendar task by id."""
    logger.info("delete_calendar_task called with task_id=%s", task_id)

    result_payload = await send_frontend_request("delete_task", {"task_id": task_id}, timeout_seconds=15)
    if not result_payload.get("ok", False):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to delete task: {message}"

    deleted_task = result_payload.get("task")
    return f"Task deleted successfully: {deleted_task}"


@tool
async def update_task_type_color(taskType: str, color: str):
    """Updates a task type color (hex color like #4f7ef7)."""
    logger.info("update_task_type_color called with taskType=%s color=%s", taskType, color)

    result_payload = await send_frontend_request(
        "update_task_type_color",
        {
            "task_type": taskType,
            "color": color,
        },
        timeout_seconds=15,
    )
    if not result_payload.get("ok", False):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to update type color: {message}"

    return f"Type color updated successfully: {result_payload.get('task_type')} -> {result_payload.get('color')}"


@tool
async def rename_task_type(old_task_type: str, new_task_type: str, new_color: str = ""):
    """Renames a task type and optionally sets a new color."""
    logger.info(
        "rename_task_type called with old_task_type=%s new_task_type=%s",
        old_task_type,
        new_task_type,
    )

    result_payload = await send_frontend_request(
        "rename_task_type",
        {
            "old_task_type": old_task_type,
            "new_task_type": new_task_type,
            "new_color": new_color,
        },
        timeout_seconds=15,
    )
    if not result_payload.get("ok", False):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to rename type: {message}"

    return (
        "Type renamed successfully: "
        f"{result_payload.get('old_task_type')} -> {result_payload.get('new_task_type')}, "
        f"moved {result_payload.get('moved_count')} task(s)."
    )


@tool
async def delete_task_type(task_type: str, move_to_type: str = "other"):
    """Deletes a task type and moves affected tasks to another type."""
    logger.info("delete_task_type called with task_type=%s move_to_type=%s", task_type, move_to_type)

    result_payload = await send_frontend_request(
        "delete_task_type",
        {
            "task_type": task_type,
            "move_to_type": move_to_type,
        },
        timeout_seconds=15,
    )
    if not result_payload.get("ok", False):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to delete type: {message}"

    return (
        f"Type {result_payload.get('task_type')} deleted. "
        f"Moved {result_payload.get('moved_count')} task(s) to {result_payload.get('move_to_type')}."
    )


@tool
async def get_all_task_type_colors():
    """Returns all task type colors as a mapping of type name to hex color."""
    logger.info("get_all_task_type_colors called")

    result_payload = await send_frontend_request("get_task_type_colors", {}, timeout_seconds=15)
    if not result_payload.get("ok", True):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to get task type colors: {message}"

    return result_payload.get("colors", {})


@tool
async def show_task_cards(
    task_ids: str = "",
    task_type: str = "",
    date: str = "",
    limit: int = 6,
    intro: str = "",
):
    """Ask the frontend to render a task-card message in chat.

    Args:
        task_ids: Optional comma-separated task ids, e.g. "1,2,8".
        task_type: Optional task type filter.
        date: Optional date filter in YYYY-MM-DD.
        limit: Maximum number of cards to show (1-12).
        intro: Optional message shown above the cards.
    """
    logger.info(
        "show_task_cards called with task_ids=%s task_type=%s date=%s limit=%s",
        task_ids,
        task_type,
        date,
        limit,
    )

    result_payload = await send_frontend_request(
        "show_task_cards",
        {
            "task_ids": task_ids,
            "task_type": task_type,
            "date": date,
            "limit": limit,
            "intro": intro,
        },
        timeout_seconds=15,
    )
    if not result_payload.get("ok", False):
        message = result_payload.get("message", "Unknown error")
        return f"Failed to show task cards: {message}"

    return f"Displayed {result_payload.get('count', 0)} task card(s) in chat."
    
@tool
def get_time_now():
    """Returns the current time in YYYY-MM-DD HH:MM format."""
    from datetime import datetime
    now = datetime.now()
    current_time = now.strftime("%Y-%m-%d %H:%M")
    logger.info("get_time_now called, returning current time: %s", current_time)
    return current_time


task_creation_agent = create_agent(
    model,
    tools=[
        create_calendar_task,
        get_all_tasks,
        get_task_by_id,
        update_calendar_task,
        delete_calendar_task,
        update_task_type_color,
        rename_task_type,
        delete_task_type,
        get_all_task_type_colors,
        show_task_cards,
        get_time_now,
    ],
    checkpointer=InMemorySaver(),
)

# async def create_tasks_with_agent(task_description):
#     logger.info("create_tasks_with_agent called with description: %s", task_description)

#     system_prompt = f"You are a helpful assistant that creates calendar tasks based on user descriptions. The user will provide a description of the tasks they want to create, and you will plan and create the tasks accordingly. Here is the task description: {task_description}"

#     procedural_prompt = f"Based on the task description, first generate a plan of several calendar tasks that need to be created. Describe each task in detail, including the title, date, type (e.g., work, personal), time (note that the time should be in HH:MM format, no duration format), and medium detailed notes to describe the task. Use the get_time_now tool if you need to reference the current time for any of the tasks."

#     initial_messages = [SystemMessage(content=system_prompt), HumanMessage(content=procedural_prompt)]
#     logger.info("Invoking task creation agent")
#     response = await task_creation_agent.ainvoke(input={"messages": initial_messages})
    
#     logger.info("Raw procedural response: %s", response)
    
#     follow_up_prompt = "Now that you have generated the plan, use the create_calendar_task tool to create each of the tasks you outlined. Provide a confirmation message for each task creation result."
#     logger.info("Invoking task creation agent for task execution")
#     further_response = await task_creation_agent.ainvoke(input={"messages": response['messages'] + [HumanMessage(content=follow_up_prompt)]})

#     response_content = further_response['messages'][-1].content if 'messages' in further_response and len(further_response['messages']) > 0 else str(further_response)
#     logger.info("Extracted response content: %s", response_content)
#     return response_content

async def calendar_agent(user_message, current_thread_id):
    logger.info("calendar_agent called with user message: %s", user_message)

    system_prompt = f"You are a helpful assistant that lives in a calendar application. You will answer user questions related to their calendar and create calendar tasks based on user requests. Note to check if the type color of the newly created task is appropriate after creation. When deleting tasks, check if the task type associated with the task can be deleted (if it is not being used by any other tasks)."

    initial_messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_message)]
    logger.info("Invoking calendar agent")
    response = await task_creation_agent.ainvoke({"messages": initial_messages}, {"configurable": {"thread_id": current_thread_id}})

    response_content = response['messages'][-1].content if 'messages' in response and len(response['messages']) > 0 else str(response)
    logger.info("Extracted calendar agent response content: %s", response_content)
    return response_content


async def handle_ai_request(websocket, message, current_thread_id):
    try:
        logger.info("Processing ai_message payload: %s", message)
        result = await calendar_agent(message, current_thread_id)
        logger.info("Sending task processing result back to client")
        await websocket.send(f"task_creation_result: {result}")
    except Exception as exc:
        logger.exception("AI task processing failed: %s", exc)
        if not websocket.closed:
            await websocket.send("task_creation_result: Failed to process AI task request.")



async def listen(websocket):
    global active_websocket
    global allow_restart_on_disconnect
    active_websocket = websocket
    background_tasks = set()
    logger.info("Client connected")
    try:
        async for message in websocket:
            logger.info("Incoming websocket message")
            if message.startswith("ai_message: "):
                message_json = message[len("ai_message: "):]
                # parse the message to extract the task description and thread ID
                try:
                    message_data = json.loads(message_json)
                    message = message_data.get("message", "")
                    thread_id = message_data.get("thread_id", "default_thread")
                    logger.info("Received AI message for thread %s: %s", thread_id, message)
                except json.JSONDecodeError:
                    logger.error("Failed to decode AI message as JSON: %s", message_json)
                    continue
                task = asyncio.create_task(handle_ai_request(websocket, message, thread_id))
                background_tasks.add(task)
                task.add_done_callback(background_tasks.discard)
            if message == "shutdown_server" or message.startswith("shutdown_server:"):
                shutdown_reason = "client_request"
                if message.startswith("shutdown_server:"):
                    shutdown_reason = message[len("shutdown_server:"):].strip() or "client_request"
                logger.info("Received graceful shutdown request (%s)", shutdown_reason)
                allow_restart_on_disconnect = False
                await websocket.send("shutdown_ack")
                shutdown_event.set()
                break
            if message.startswith("created_task: "):
                await active_websocket.send("ack_created_task: Acknowledged task creation result")
                result_info = message[len("created_task: "):]
                logger.info("Received task creation callback")
                task_creation_results.put_nowait(result_info)
                logger.info("Task creation result put into queue: %s", task_creation_results.qsize())
            if message.startswith("all_tasks_result: "):
                result_json = message[len("all_tasks_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("all_tasks_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode all_tasks_result JSON: %s", result_json)
            if message.startswith("task_by_id_result: "):
                result_json = message[len("task_by_id_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("task_by_id_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode task_by_id_result JSON: %s", result_json)
            if message.startswith("update_task_result: "):
                result_json = message[len("update_task_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("update_task_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode update_task_result JSON: %s", result_json)
            if message.startswith("delete_task_result: "):
                result_json = message[len("delete_task_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("delete_task_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode delete_task_result JSON: %s", result_json)
            if message.startswith("update_task_type_color_result: "):
                result_json = message[len("update_task_type_color_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("update_task_type_color_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode update_task_type_color_result JSON: %s", result_json)
            if message.startswith("task_type_colors_result: "):
                result_json = message[len("task_type_colors_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("task_type_colors_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode task_type_colors_result JSON: %s", result_json)
            if message.startswith("rename_task_type_result: "):
                result_json = message[len("rename_task_type_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("rename_task_type_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode rename_task_type_result JSON: %s", result_json)
            if message.startswith("delete_task_type_result: "):
                result_json = message[len("delete_task_type_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("delete_task_type_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode delete_task_type_result JSON: %s", result_json)
            if message.startswith("show_task_cards_result: "):
                result_json = message[len("show_task_cards_result: "):]
                try:
                    result_payload = json.loads(result_json)
                    request_id = result_payload.get("request_id")
                    if not request_id:
                        logger.warning("show_task_cards_result missing request_id")
                        continue
                    waiter = calendar_query_results.get(request_id)
                    if waiter and not waiter.done():
                        waiter.set_result(result_payload)
                except json.JSONDecodeError:
                    logger.error("Failed to decode show_task_cards_result JSON: %s", result_json)
    finally:
        for task in background_tasks:
            task.cancel()
        if background_tasks:
            await asyncio.gather(*background_tasks, return_exceptions=True)
        if active_websocket is websocket:
            active_websocket = None
        logger.info("Client disconnected")
        if allow_restart_on_disconnect:
            restart_current_process("websocket client disconnected")
        else:
            logger.info("Graceful shutdown requested; skip restart")


async def handle_health_check(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        try:
            await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=1.0)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            pass

        body = b"ok"
        response = (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/plain; charset=utf-8\r\n"
            + f"Content-Length: {len(body)}\r\n".encode("ascii")
            + b"Connection: close\r\n\r\n"
            + body
        )
        writer.write(response)
        await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def main():
    logger.info("Starting websocket server on 0.0.0.0:8765")
    logger.info("Starting health check server on %s:%s", HEALTH_CHECK_HOST, HEALTH_CHECK_PORT)
    logger.info(
        "Auto restart on disconnect is %s (AUTO_RESTART_ON_DISCONNECT in file)",
        "enabled" if AUTO_RESTART_ON_DISCONNECT else "disabled",
    )
    health_server = await asyncio.start_server(handle_health_check, HEALTH_CHECK_HOST, HEALTH_CHECK_PORT)
    async with health_server, websockets.serve(listen, "0.0.0.0", 8765):
        logger.info("Websocket server and health check server started; entering event loop")
        await shutdown_event.wait()
    logger.info("Websocket server shutdown complete")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        logger.info("Server process exiting")
        # This helper process is dedicated to the websocket server; force exit
        # so background library threads cannot keep it alive after shutdown.
        os._exit(0)
