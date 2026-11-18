"""Private inherited stdio protocol. No network, microphone, accounts or audio files."""
import base64
import binascii
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


class InvalidInputError(ValueError):
    """Client input error that does not invalidate the loaded native models."""


def emit(request_id, kind, **payload):
    protocol.write(json.dumps({"id": request_id, "type": kind, **payload}, ensure_ascii=False) + "\n")
    protocol.flush()


def main():
    from engines import Engines
    engines = Engines()
    try:
        for line in sys.stdin:
            request_id = None
            try:
                if len(line) > 6_000_000:
                    raise InvalidInputError("request-too-large")
                try:
                    request = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise InvalidInputError("invalid-json") from exc
                if not isinstance(request, dict):
                    raise InvalidInputError("invalid-request")
                request_id = request.get("id")
                if not isinstance(request_id, int) or isinstance(request_id, bool):
                    raise InvalidInputError("invalid-id")
                op = request.get("op")
                if op == "warm":
                    model = request.get("model")
                    if not isinstance(model, str) or not model:
                        raise InvalidInputError("invalid-model")
                    engines.warm(model)
                    emit(request_id, "done")
                elif op == "transcribe":
                    model = request.get("model")
                    encoded = request.get("audio")
                    if not isinstance(model, str) or not model or not isinstance(encoded, str):
                        raise InvalidInputError("invalid-audio")
                    try:
                        raw = base64.b64decode(encoded, validate=True)
                    except (binascii.Error, ValueError) as exc:
                        raise InvalidInputError("invalid-audio") from exc
                    if not 3200 <= len(raw) <= 120 * 16000 * 2 or len(raw) % 2:
                        raise InvalidInputError("invalid-audio")
                    text = engines.transcribe(model, raw, request.get("language", "fr"))
                    emit(request_id, "text", text=text)
                elif op == "speak":
                    voice = request.get("voice")
                    text = request.get("text")
                    if not isinstance(voice, str) or not voice or not isinstance(text, str) or not 0 < len(text.strip()) <= 4000:
                        raise InvalidInputError("invalid-text")
                    for rate, audio in engines.speak(voice, text):
                        emit(request_id, "audio", rate=rate, audio=base64.b64encode(audio).decode("ascii"))
                    emit(request_id, "done")
                else:
                    raise InvalidInputError("invalid-operation")
            except (BrokenPipeError, EOFError):
                break
            except Exception as error:
                kind = "invalid-input" if isinstance(error, InvalidInputError) else "engine"
                try:
                    # Never log transcripts or paths, including third-party exception messages.
                    print(type(error).__name__, file=sys.stderr, flush=True)
                    if isinstance(request_id, int) and not isinstance(request_id, bool):
                        emit(request_id, "error", error=kind)
                except OSError:
                    break
    finally:
        engines.close()


if __name__ == "__main__":
    main()
