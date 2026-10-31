import ast
import contextlib
import io
import json
import os
import signal
import sys

MAX_CODE = 12000
MAX_OUTPUT = 4000
ALLOWED_IMPORTS = {"math", "random", "statistics", "string", "itertools", "functools", "collections"}
BLOCKED_CALLS = {"eval", "exec", "compile", "open", "__import__", "input", "breakpoint"}
EXPECTED = ["Hello, Python!", "Ada", "20", "Access granted", "0\n1\n2", "2"]

def validate(source):
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name.split(".")[0] for a in node.names] if isinstance(node, ast.Import) else [(node.module or "").split(".")[0]]
            if any(name not in ALLOWED_IMPORTS for name in names):
                raise ValueError("This library is not available in Python Quest")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ValueError("Special attributes are unavailable")
        if isinstance(node, ast.Name) and node.id in BLOCKED_CALLS:
            raise ValueError("This operation is unavailable")
    return tree

def grade(code, mission, mode, output, namespace, tree):
    if mode != "terminal" or mission not in range(1, 7):
        return {"verified": False, "reason": "This mode requires a separate trusted game-state evaluator"}
    checks = [
        namespace.get("message") == "Hello, Python!",
        namespace.get("explorer") == "Ada",
        namespace.get("energy") == 20 and not isinstance(namespace.get("energy"), bool),
        isinstance(namespace.get("access_level"), int) and namespace["access_level"] >= 2,
        True,
        namespace.get("inventory") == ["key", "map"],
    ]
    concept = [
        lambda n: isinstance(n, ast.Assign),
        lambda n: isinstance(n, ast.Assign),
        lambda n: isinstance(n, ast.BinOp) and isinstance(n.op, ast.Add),
        lambda n: isinstance(n, ast.If) and isinstance(n.test, ast.Compare),
        lambda n: isinstance(n, ast.For) and isinstance(n.iter, ast.Call) and isinstance(n.iter.func, ast.Name) and n.iter.func.id == "range",
        lambda n: isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "len",
    ]
    correct = output.strip() == EXPECTED[mission-1] and bool(checks[mission-1])
    used_concept = any(concept[mission-1](n) for n in ast.walk(tree))
    correctness = 40 if correct else 0
    concepts = 30 if used_concept else 0
    quality = 20 if code.strip() and all(len(line) <= 120 for line in code.splitlines()) else 0
    solving = 10 if correct and used_concept else 0
    total = correctness + concepts + quality + solving
    return {"verified": True, "correctness": correctness, "concepts": concepts, "quality": quality, "problemSolving": solving, "total": total, "passing": total >= 80, "feedback": ["Output and required values: " + ("passed" if correct else "check the expected output and variable values"), "Required syntax: " + ("demonstrated" if used_concept else "missing"), "Readability: " + ("passed" if quality else "keep lines short and include code"), "Try again or ask your teacher for help" if total < 80 else "Mission passed"]}

def main():
    request = json.loads(sys.stdin.read(16000))
    code = request.get("code")
    mission = request.get("mission")
    mode = request.get("mode")
    if not isinstance(code, str) or len(code) > MAX_CODE or type(mission) is not int or mission not in range(1, 7) or mode not in ("hybrid", "code", "terminal"):
        raise ValueError("Invalid submission")
    tree = validate(code)
    namespace = {"__name__": "__main__"}
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        exec(compile(tree, "<student>", "exec"), namespace)
    output = out.getvalue()[:MAX_OUTPUT]
    return {"ok": True, "output": output, "rubric": grade(code, mission, mode, output, namespace, tree)}

if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except BaseException as error:
        print(json.dumps({"ok": False, "error": str(error)[:500]}))
