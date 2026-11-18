"""Persistent, serial CPU engines; the parent terminates this process on cancellation."""
import os


class Engines:
    def __init__(self):
        self.model = None
        self.model_path = None
        self.session = None
        self.voice = None
        self.voice_path = None

    def _close_asr(self):
        session, model = self.session, self.model
        self.session = None
        self.model = None
        self.model_path = None
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
        if model is not None:
            try:
                model.close()
            except Exception:
                pass

    def close(self):
        self._close_asr()
        self.voice = None
        self.voice_path = None

    def warm(self, path):
        from transcribe_cpp import Model
        if not os.path.isfile(path):
            raise FileNotFoundError("model")
        if self.model_path != path or self.session is None or self.model is None:
            self._close_asr()
            model = Model(path, backend="cpu")
            try:
                session = model.session(n_threads=4)
            except Exception:
                try:
                    model.close()
                except Exception:
                    pass
                raise
            self.model = model
            self.session = session
            self.model_path = path

    def transcribe(self, path, pcm, language):
        import numpy as np
        self.warm(path)
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        return self.session.run(samples, language=language, timestamps="none").text.strip()

    def speak(self, path, text):
        import json
        import onnxruntime as ort
        from piper import PiperVoice, PiperConfig
        if not os.path.isfile(path):
            raise FileNotFoundError("voice")
        if self.voice_path != path:
            self.voice = None
            self.voice_path = None
            # Avoid a spinning pool on every logical core while Parakeet is working.
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            options.add_session_config_entry("session.intra_op.allow_spinning", "0")
            with open(path + ".json", encoding="utf-8") as source:
                config = PiperConfig.from_dict(json.load(source))
            self.voice = PiperVoice(config=config, session=ort.InferenceSession(path, sess_options=options, providers=["CPUExecutionProvider"]))
            self.voice_path = path
        for chunk in self.voice.synthesize(text):
            if chunk.sample_channels != 1 or chunk.sample_width != 2:
                raise ValueError("audio-format")
            raw = chunk.audio_int16_bytes
            for offset in range(0, len(raw), 8192):
                yield chunk.sample_rate, raw[offset:offset + 8192]
