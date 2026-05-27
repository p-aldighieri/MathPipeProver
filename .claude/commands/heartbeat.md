---
description: Start a recurring orchestrator-pace loop that checks the browser and advances the pipeline at a fixed interval.
argument-hint: [interval like 15m, 30m, 1h — default 15m]
---

Sets up the orchestrator to wake itself on a fixed cadence and continue
driving the MathPipeProver pipeline without you needing to nudge it. The
loop checks the browser for the latest submission's state, fires the next
role if appropriate, keeps durable sources tidy, and recovers from glitches.

This is the **orchestrator-pace loop only** — it is unrelated to any
browser-agent telemetry or status-poll machinery (those layers were removed
during the heartbeat-deprecation pass; this skill survives because the loop
behavior is independently useful for long unattended runs).

**Interval:** use `$ARGUMENTS` if it is non-empty (e.g. `10m`, `1h`);
otherwise default to `15m`. Shorter intervals (≤5m) burn cache and cost
without much value — pick something that matches how often the next pipeline
state-change is actually expected.

Then invoke `/loop <interval> <prompt>` with this prompt:

This is an orchestrator-pace tick. You are the smart orchestrator of the
proof process, running the MathPipeProver pipeline. The first task is to
check the browser to see if the last submission is finished and then move
forward with the pipeline. All proofs MUST be followed by reviewer
submissions on a fresh session. Your task is also to keep the ChatGPT
project sources in the browser tidy and up-to-date. If you can't find the
tab or the browser, just open it again and be careful not to interfere
with other Chrome processes. The GPT session will keep running till
completion even if closed. If there is some glitch, your task is to fix
it and get the pipeline back on track. I am not here to babysit you if
you are getting this message, do not wait for me, act on your best
judgment on how to complete the proof. If the proof is truly complete,
you may cancel this loop, but be careful.
