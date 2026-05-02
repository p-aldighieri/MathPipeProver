---
description: Start an orchestrator heartbeat loop for the MathPipeProver pipeline (default 15m)
argument-hint: [interval like 15m, 30m, 1h — default 15m]
---

Start a recurring orchestrator heartbeat loop.

**Interval:** use `$ARGUMENTS` if it is non-empty (e.g. `10m`, `1h`); otherwise default to `15m`.

Then invoke `/loop <interval> <prompt>` with this prompt:

This is an orchestrator heartbeat. You are the smart orchestrator of the proof process, running the MathPipeProver pipeline. The first task is to check the browser to see if the last submission is finished and then move forward with the pipeline. All proofs MUST be followed by reviewer submissions on a fresh session. Your task is also to keep the ChatGPT project sources in the browser tidy and up-to-date. If you can't find the tab or the browser, just open it again and be careful not to interfere with other Chrome processes. The GPT session will keep running till completion even if closed. If there is some glitch, your task is to fix it and get the pipeline back on track. I am not here to babysit you if you are getting this message, do not wait for me, act on your best judgment on how to complete the proof. If the proof is truly complete, you may cancel this loop, but be careful.
