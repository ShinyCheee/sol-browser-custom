"""Real STT/TTS smoke; synthetic WAV input only, no microphone or account."""
import base64
import json
import pathlib
import subprocess
import sys
import time
import wave

root = pathlib.Path(__file__).resolve().parents[2]
runtime, models, wav = map(pathlib.Path, sys.argv[1:4])
worker_path = pathlib.Path(sys.argv[4]) if len(sys.argv) > 4 else root / "tools/voice-worker/worker.py"
started = time.monotonic()
diagnostic = open(root / "bin/voice-evidence/worker-stderr.log", "w", encoding="utf-8")
worker = subprocess.Popen(
    [str(runtime / "python.exe"), "-I", "-u", str(worker_path)],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=diagnostic,
    text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW,
)
try:
    with wave.open(str(wav)) as source:
        assert source.getframerate() == 16000 and source.getnchannels() == 1
        pcm = source.readframes(source.getnframes())
    worker.stdin.write(json.dumps({"id": 1, "op": "transcribe", "model": str(models / "parakeet-ultra-Q8_0.gguf"), "audio": base64.b64encode(pcm).decode(), "language": "fr"}) + "\n")
    worker.stdin.flush()
    line = worker.stdout.readline()
    assert line, "Worker must accept an utterance and return a transcript"
    result = json.loads(line)
    assert result["type"] == "text", result
    assert "page" in result["text"].lower(), result
    print("PASS real Parakeet French:", result["text"], "seconds", round(time.monotonic() - started, 2))
    worker.stdin.write(json.dumps({"id": 2, "op": "speak", "voice": str(models / "fr_FR-siwis-medium.onnx"), "text": "Bonjour. La page est ouverte. Vous pouvez continuer."}) + "\n")
    worker.stdin.flush()
    packets, size = 0, 0
    while True:
        result = json.loads(worker.stdout.readline())
        assert result["id"] == 2
        assert result["type"] != "error", result
        if result["type"] == "done":
            break
        assert result["type"] == "audio" and result["rate"] == 22050
        size += len(base64.b64decode(result["audio"]))
        packets += 1
    assert packets > 1 and size > 44100, (packets, size)
    print("PASS real Piper streamed PCM:", packets, "packets", size, "bytes")
finally:
    worker.kill()
    worker.wait(timeout=10)
    diagnostic.close()
