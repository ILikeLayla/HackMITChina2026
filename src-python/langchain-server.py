from langchain.tools import tool
from langchain.agents import create_agent
from langchain.messages import SystemMessage, HumanMessage

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

HEALTH_CHECK_HOST = "127.0.0.1"
HEALTH_CHECK_PORT = 8766

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("langchain-server")

task_creation_results = asyncio.Queue()
active_websocket = None
allow_restart_on_disconnect = True
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
def get_time_now():
    """Returns the current time in YYYY-MM-DD HH:MM format."""
    from datetime import datetime
    now = datetime.now()
    current_time = now.strftime("%Y-%m-%d %H:%M")
    logger.info("get_time_now called, returning current time: %s", current_time)
    return current_time


task_creation_agent = create_agent(model, tools=[create_calendar_task, get_time_now])

async def create_tasks_with_agent(task_description):
    logger.info("create_tasks_with_agent called with description: %s", task_description)

    system_prompt = f"You are a helpful assistant that creates calendar tasks based on user descriptions. The user will provide a description of the tasks they want to create, and you will plan and create the tasks accordingly. Here is the task description: {task_description}"

    procedural_prompt = f"Based on the task description, first generate a plan of several calendar tasks that need to be created. Describe each task in detail, including the title, date, type (e.g., work, personal), time (note that the time should be in HH:MM format, no duration format), and medium detailed notes to describe the task. Use the get_time_now tool if you need to reference the current time for any of the tasks."

    initial_messages = [SystemMessage(content=system_prompt), HumanMessage(content=procedural_prompt)]
    logger.info("Invoking task creation agent")
    response = await task_creation_agent.ainvoke(input={"messages": initial_messages})
    
    logger.info("Raw procedural response: %s", response)
    
    follow_up_prompt = "Now that you have generated the plan, use the create_calendar_task tool to create each of the tasks you outlined. Provide a confirmation message for each task creation result."
    logger.info("Invoking task creation agent for task execution")
    further_response = await task_creation_agent.ainvoke(input={"messages": response['messages'] + [HumanMessage(content=follow_up_prompt)]})

    response_content = further_response['messages'][-1].content if 'messages' in further_response and len(further_response['messages']) > 0 else str(further_response)
    logger.info("Extracted response content: %s", response_content)
    return response_content


async def handle_ai_request(websocket, task_info):
    try:
        logger.info("Processing ai_task_description payload: %s", task_info)
        result = await create_tasks_with_agent(task_info)
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
            if message == "ping":
                await websocket.send("pong")
                continue
            if message.startswith("ping: "):
                ping_payload = message[len("ping: "):]
                await websocket.send(f"pong: {ping_payload}")
                continue
            if message.startswith("ping_json: "):
                raw_payload = message[len("ping_json: "):]
                try:
                    payload = json.loads(raw_payload)
                except json.JSONDecodeError:
                    await websocket.send("pong_json: {\"ok\": false, \"error\": \"invalid_json\"}")
                    continue

                response_payload = {
                    "ok": True,
                    "echo": payload,
                }
                await websocket.send(f"pong_json: {json.dumps(response_payload, ensure_ascii=False)}")
                continue
            if message.startswith("ai_task_description: "):
                task_info = message[len("ai_task_description: "):]
                task = asyncio.create_task(handle_ai_request(websocket, task_info))
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
