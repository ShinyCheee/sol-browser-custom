"""Private inherited stdio protocol. No network, microphone, accounts or audio files."""
import base64
import json
import os
import sys
from pathlib import Path

# Native libraries must never corrupt the JSON protocol with diagnostic stdout.
protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
os.environ["OMP_NUM_THREADS"] = "4"
os.environ["OPENBLAS_NUM_THREADS"] = "4"
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))


def emit(request_id, kind, **payload):
    protocol.write(json.dumps({"id": request_id, "type": kind, **payload}, ensure_ascii=False) + "\n")
    protocol.flush()


def main():
    from engines import Engines
    engines = Engines()
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > 6_000_000:
                raise ValueError("request-too-large")
            request = json.loads(line)
            request_id = request["id"]
            if request["op"] == "warm":
                engines.warm(request["model"])
                emit(request_id, "done")
            elif request["op"] == "transcribe":
                raw = base64.b64decode(request["audio"], validate=True)
                if not 3200 <= len(raw) <= 120 * 16000 * 2 or len(raw) % 2:
                    raise ValueError("invalid-audio")
                text = engines.transcribe(request["model"], raw, request.get("language", "fr"))
                emit(request_id, "text", text=text)
            elif request["op"] == "speak":
                text = request["text"]
                if not isinstance(text, str) or not 0 < len(text) <= 4000:
                    raise ValueError("invalid-text")
                for rate, audio in engines.speak(request["voice"], text):
                    emit(request_id, "audio", rate=rate, audio=base64.b64encode(audio).decode("ascii"))
                emit(request_id, "done")
            else:
                raise ValueError("invalid-operation")
        except Exception as error:
            # Never log transcripts or paths, including third-party exception messages.
            print(type(error).__name__, file=sys.stderr, flush=True)
            emit(request_id, "error", error="engine")


if __name__ == "__main__":
    main()
