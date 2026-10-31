# Python Quest sandbox prototype

This directory contains a **prototype**, not a production-safe student code runner.

It runs a Python subprocess with a five-second timeout and restricts imports at the AST level. Those checks **do not constitute a security boundary**. Python can escape language-level restrictions, and the HTTP server is not authenticated.

Before accepting student submissions:
- Run each submission in a separate disposable container or microVM, not merely a subprocess in a shared long-running container.
- Disable outbound network access; set non-root UID, read-only filesystem, no secrets, no host mounts, and strict CPU/memory/PID limits.
- Add authenticated private Worker-to-container service binding and response validation.
- Enforce output and memory limits at the OS level; a five-second subprocess timeout alone is insufficient.
- Never expose the HTTP port publicly.
- Independently test the runner against malicious and resource-exhaustion payloads.
- Implement server-verified game-state evaluation for Hybrid and Code modes; only terminal-mode checks are sketched here.
- Run the real code tests and inspect the grading rubric for fairness before enabling advancement.

**Do not deploy this prototype as an exposed or shared execution service.** Existing teacher approval fallback remains available.
