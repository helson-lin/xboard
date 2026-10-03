"""Detached XBoard supervisor with automatic restart and a single-instance lock."""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
RUNTIME = BASE / "data" / "runtime"
RUNTIME.mkdir(parents=True, exist_ok=True)


def supervise():
    lock = (RUNTIME / "daemon.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    pidfile = RUNTIME / "daemon.pid"
    pidfile.write_text(str(os.getpid()))
    stopping = False
    child = None

    def stop(signum, frame):
        nonlocal stopping
        stopping = True
        if child is not None and child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not stopping:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "Starting XBoard", flush=True)
            child = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "app:app", "--host", "0.0.0.0",
                 "--port", os.environ.get("PORT", "8765"), "--log-level", "info"],
                cwd=BASE,
            )
            while child.poll() is None:
                if stopping:
                    try:
                        child.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                    break
                time.sleep(0.5)
            if not stopping:
                print("XBoard exited; restarting in 3 seconds", flush=True)
                time.sleep(3)
    finally:
        pidfile.unlink(missing_ok=True)


if __name__ == "__main__":
    if "--supervise" in sys.argv:
        supervise()
    else:
        with (RUNTIME / "service.log").open("ab", buffering=0) as log:
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "--supervise"],
                cwd=BASE, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                start_new_session=True,
            )
        print(f"Started supervisor launcher PID {process.pid}; log: {RUNTIME / 'service.log'}")
