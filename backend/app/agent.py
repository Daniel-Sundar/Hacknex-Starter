"""Minimal tool-calling agent loop (Agentic AI track).

Add a tool: write a Python function, then add its JSON schema to TOOLS.
The loop: LLM picks tools -> we run them -> results go back -> repeat
until the LLM answers in plain text or MAX_STEPS is hit.
Every step is recorded in `trace` so the UI can show the agent "thinking".
"""
import ast
import datetime as dt
import json
import operator

from . import llm, rag

MAX_STEPS = 6

# ---------- tools ----------

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
        ast.Div: operator.truediv, ast.Pow: operator.pow, ast.USub: operator.neg, ast.Mod: operator.mod}


def _eval(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval(node.operand))
    raise ValueError("unsupported expression")


def calculator(expression: str) -> str:
    return str(_eval(ast.parse(expression, mode="eval").body))


def current_time() -> str:
    return dt.datetime.now().isoformat(timespec="minutes")


def search_docs(query: str) -> str:
    hits = rag.search(query, k=3)
    return json.dumps(hits) if hits else "No documents uploaded yet."


FUNCTIONS = {"calculator": calculator, "current_time": current_time, "search_docs": search_docs}

TOOLS = [
    {"type": "function", "function": {
        "name": "calculator", "description": "Evaluate an arithmetic expression, e.g. '12*(3+4)'.",
        "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}}},
    {"type": "function", "function": {
        "name": "current_time", "description": "Get the current local date and time.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "search_docs", "description": "Search the user's uploaded documents.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
]

SYSTEM = "You are a helpful agent. Use tools when they help. Be concise."

# ---------- loop ----------


def run(task: str) -> dict:
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": task}]
    trace = []
    for _ in range(MAX_STEPS):
        msg = llm.chat(messages, tools=TOOLS)
        if isinstance(msg, dict):  # mock provider: no tool calling
            return {"answer": msg["content"], "trace": trace}
        if not msg.tool_calls:
            return {"answer": msg.content, "trace": trace}
        messages.append(msg.model_dump(exclude_none=True))
        for call in msg.tool_calls:
            name = call.function.name
            try:
                args = json.loads(call.function.arguments or "{}")
                result = FUNCTIONS[name](**args)
            except Exception as e:
                args, result = call.function.arguments, f"error: {e}"
            trace.append({"tool": name, "args": args, "result": result})
            messages.append({"role": "tool", "tool_call_id": call.id, "content": str(result)})
    return {"answer": "Stopped after max steps.", "trace": trace}
