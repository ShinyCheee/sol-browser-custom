"""Persistent, serial CPU engines; the parent terminates this process on cancellation."""
import os


class Engines:
    def __init__(self):
        self.model = None
        self.model_path = None
        self.session = None
        self.voice = None
        self.voice_path = None

    def warm(self, path):
        from transcribe_cpp import Model
        if not os.path.isfile(path):
            raise FileNotFoundError("model")
        if self.model_path != path:
            if self.session is not None:
                self.session.close()
            if self.model is not None:
                self.model.close()
            self.model = Model(path, backend="cpu")
            self.session = self.model.session(n_threads=4)
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
