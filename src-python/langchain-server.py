from langchain.tools import tool
from langchain.agents import create_agent
from langchain.messages import SystemMessage, HumanMessage
from langchain_ollama import ChatOllama
import asyncio
import websockets
import json
import queue
import logging
from dataclasses import dataclass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("langchain-server")

task_creation_results = queue.Queue()
active_websocket = None
server_loop = None

model = ChatOllama(model="qwen2:7b")

@tool
def create_calendar_task(title: str, date: str, taskType: str, time: str, notes: str):
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
        "notes": notes
    })
    logger.info("Task payload serialized: %s", task_json)

    if active_websocket is None or server_loop is None:
        logger.error("No active websocket client is available for task creation")
        return "Failed to create task: No active websocket client connection."

    logger.info("Sending task creation request over websocket")
    send_future = asyncio.run_coroutine_threadsafe(
        active_websocket.send(f"newing_task: {task_json}"),
        server_loop,
    )
    send_future.result(timeout=5)

    # wait for the result from the calendar system
    try:
        logger.info("Waiting for task creation result from queue")
        result_info = task_creation_results.get(timeout=50)
        logger.info("Received task creation result: %s", result_info)
        return f"Task creation result: {result_info}"
    except queue.Empty:
        logger.warning("Timeout waiting for task creation result")
        return "Failed to create task: No response from calendar system."


task_creation_agent = create_agent(model, tools=[create_calendar_task])

async def create_tasks_with_agent(task_description):
    logger.info("create_tasks_with_agent called with description: %s", task_description)

    system_prompt = f"You are a helpful assistant that creates calendar tasks based on user descriptions. The user will provide a description of the tasks they want to create, and you will plan and create the tasks accordingly. Here is the task description: {task_description}"

    procedural_prompt = f"Based on the task description, plan several calendar tasks that need to be created. For each task, provide the title, date (in YYYY-MM-DD format), type (e.g., 'meeting', 'reminder'), time (in HH:MM format), and any additional notes. Use the create_calendar_task tool to create each task."

    initial_messages = [SystemMessage(content=system_prompt), HumanMessage(content=procedural_prompt)]
    logger.info("Invoking task creation agent")
    response = await task_creation_agent.ainvoke(input={"messages": initial_messages})
    logger.info("Task creation agent response received")
    logger.info("Raw response: %s", response)

    response_content = response['messages'][-1].content if 'messages' in response and len(response['messages']) > 0 else str(response)
    logger.info("Extracted response content: %s", response_content)
    return response_content



async def listen(websocket):
    global active_websocket
    active_websocket = websocket
    logger.info("Client connected")
    try:
        async for message in websocket:
            logger.info("Incoming websocket message: %s", message)
            if message.startswith("ai_task_description: "):
                task_info = message[len("ai_task_description: "):]
                logger.info("Processing ai_task_description payload: %s", task_info)
                result = await create_tasks_with_agent(task_info)
                logger.info("Sending task processing result back to client")
                await active_websocket.send(f"task_creation_result: {result}")
            if message.startswith("created_task: "):
                result_info = message[len("created_task: "):]
                logger.info("Received task creation callback: %s", result_info)
                task_creation_results.put(result_info)
                logger.info("Task creation result put into queue: %s", task_creation_results.qsize())
    finally:
        if active_websocket is websocket:
            active_websocket = None
        logger.info("Client disconnected")


async def main():
    global server_loop
    server_loop = asyncio.get_running_loop()
    logger.info("Starting websocket server on 0.0.0.0:8765")
    async with websockets.serve(listen, "0.0.0.0", 8765):
        logger.info("Websocket server started; entering event loop")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
