"""
Python reconciler worker — calls BleedStop POST /reconcile on a timer.

Off the /decide hot path. Same job as Node `npm run worker:reconciler`.

  npm start                 # control plane must be up
  npm run worker:reconciler:py

Or:
  python apps/protected-saas-python/worker/reconciler_worker.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Allow `from bleedstop_client import ...` when run as a script
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

load_dotenv(dotenv_path=ROOT.parents[1] / ".env")

from bleedstop_client import BleedStopClient  # noqa: E402


async def tick(client: BleedStopClient) -> None:
    report = await client.reconcile({})
    results = report.get("results") or []
    ghosts = [r for r in results if r.get("ghostDetected")]
    print(
        f"[py-reconciler] checked={len(results)} ghosts={len(ghosts)}",
        flush=True,
    )
    for g in ghosts:
        print(
            f"  ghost key={g.get('keyId')} gap=${g.get('ghostSpend')} "
            f"action={g.get('action')} status={g.get('keyStatus')}",
            flush=True,
        )


async def main() -> None:
    interval_ms = int(os.getenv("RECONCILE_INTERVAL_MS") or "30000")
    interval_s = max(5, interval_ms / 1000)
    client = BleedStopClient()
    print(
        f"BleedStop Python reconciler starting "
        f"(every {interval_s:.0f}s → {client.base_url}/reconcile)",
        flush=True,
    )
    while True:
        try:
            await tick(client)
        except Exception as err:  # noqa: BLE001 — worker must keep looping
            print(f"[py-reconciler] error: {err}", flush=True)
        await asyncio.sleep(interval_s)


if __name__ == "__main__":
    asyncio.run(main())
