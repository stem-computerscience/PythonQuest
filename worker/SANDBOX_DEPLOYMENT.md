# Python Quest sandbox deployment contract

The Cloudflare Worker remains the authentication and progress authority. A separate isolated Python runtime is required for trusted automatic grading.

Security requirements:
- One disposable isolated runtime per submission; no shared filesystem or Python process.
- No network access, host mounts, credentials, or writable host paths.
- Non-root user, read-only root filesystem, temporary memory-backed scratch space.
- Strict CPU, memory, process-count, and wall-clock limits.
- Reject oversized submissions and excessive output.
- Return structured execution evidence to the Worker over an authenticated service-to-service channel.
- The Worker must verify the service response and bind it to the authenticated student, mission, and submission ID before marking serverVerified.
- Never accept a browser-supplied serverVerified field.

The existing browser Pyodide worker remains suitable for practice but is not a trusted grading authority.

Teacher fallback: grade a recorded attempt at 80/100 or higher, then approve it with a reason. Approval is stored with the teacher identity and timestamp. This allows advancement without claiming server verification.

Deployment status: the isolated runtime is NOT yet implemented or deployed. Do not set SANDBOX_URL until the service and authentication are configured and tested.
