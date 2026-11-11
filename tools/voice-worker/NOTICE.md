# Sol voice engines

Sol's existing code is MIT. The separate local voice runtime contains third-party components under their respective licenses. Their license texts are retained in each package's `.dist-info/licenses` directory and Python's LICENSE.txt. The exact wheel URLs and SHA-256 values are in `runtime/licenses/runtime-lock.json`.

- Handy (MIT), implementation reference: https://github.com/cjpais/Handy . No Handy application executable is redistributed.
- transcribe.cpp and ggml (MIT), 0.4.1: https://github.com/handy-computer/transcribe.cpp/tree/v0.4.1 . Engine license texts are included in the native provider package.
- Piper 1.8.0 (GPL-3.0-or-later), Open Home Foundation/Michael Hansen: https://github.com/OHF-Voice/piper1-gpl/tree/v1.8.0 . `runtime/licenses/sources/` contains both the published Python source distribution and the full v1.8.0 repository, including espeakbridge.c and CMakeLists.txt, plus espeak-ng at 724808c5a83f9ef95fdd0db886ba7ba537ff224a (the commit pinned by Piper's CMake build). Each archive is recorded by SHA-256. See REBUILD.md for reconstruction and each archive's COPYING for its notices.
- Python 3.13.9 (PSF and included licenses): https://www.python.org/downloads/release/python-3139/ . The embeddable distribution retains LICENSE.txt.
- NumPy, ONNX Runtime, pathvalidate, protobuf, flatbuffers and packaging retain their package notices. Versions and exact download locations are recorded in the runtime manifest.
- NAudio 2.2.1 (MIT), Mark Heath: https://github.com/naudio/NAudio/tree/v2.2.1 . See `NAudio-LICENSE.txt` alongside this notice.
- Silero VAD v6.2.1 (MIT), Silero Team: https://github.com/snakers4/silero-vad/tree/v6.2.1 . The unmodified 2.3 MB ONNX detector and license are bundled under `runtime/silero-vad-v6.2.1*`, with SHA-256 in the runtime lock. Microsoft ONNX Runtime 1.31.1 (MIT) supplies the desktop inference session; its NuGet notices apply. Detection stays on-device and is separate from ChatGPT reasoning.

Model weights are downloaded separately, with pinned revisions and SHA-256 verification:

- Parakeet Ultra, Moondream, based on NVIDIA Parakeet: CC BY 4.0. Conversion: handy-computer/parakeet-ultra-gguf at 39eeb55181f0d354fd934f06e92fd8d5037fed8e. https://huggingface.co/moondream/parakeet-ultra and https://huggingface.co/handy-computer/parakeet-ultra-gguf . No weight modifications.
- French siwis medium: rhasspy/piper-voices at e7229f7d33a10e145e109b886d661984201ac3c4; corpus attribution and CC BY 4.0: https://huggingface.co/rhasspy/piper-voices/blob/e7229f7d33a10e145e109b886d661984201ac3c4/fr/fr_FR/siwis/medium/MODEL_CARD . SIWIS French Speech Synthesis Database, University of Edinburgh: https://datashare.ed.ac.uk/handle/10283/2353 . No weight modifications.
- English lessac medium: same pinned voice repository; voice-specific attribution: https://huggingface.co/rhasspy/piper-voices/blob/e7229f7d33a10e145e109b886d661984201ac3c4/en/en_US/lessac/medium/MODEL_CARD . No weight modifications.
- CC BY 4.0 text: https://creativecommons.org/licenses/by/4.0/ . The model manifest ships with the voice worker; the pinned links above identify each voice card.

Audio is processed locally; only the transcription and ordinary conversation context are sent to ChatGPT. The voice output is synthetic. No OpenAI audio credential is passed to this runtime.
