# Rebuilding the separate Piper component

The bundled wheel is the upstream Windows x64 `piper-tts==1.8.0` artifact identified by SHA-256 in `runtime/licenses/runtime-lock.json`. Sol has not modified that wheel. The source bundle retains the Python sdist **and** the full Piper v1.8.0 repository; the sdist alone omits the native bridge and must not be used alone to reconstruct it.

`runtime/licenses/sources/` also contains the espeak-ng source archive at commit `724808c5a83f9ef95fdd0db886ba7ba537ff224a`, the `GIT_TAG` in Piper v1.8.0/CMakeLists.txt. This includes the statically linked espeak-ng/ucd code and the data build inputs. All source versions, URLs and hashes are recorded in the runtime manifest. Piper's COPYING, espeak-ng's COPYING and their source notices are retained in those archives.

On a Windows x64 build machine with the Visual Studio C/C++ tools, Python 3.9+ development headers, CMake 3.26+ and Ninja:

1. Extract `piper1-gpl-v1.8.0.tar.gz` and the espeak source archive in a build directory. Read the upstream `docs/BUILDING.md`, `CMakeLists.txt`, `setup.py` and `pyproject.toml` in that Piper tree.
2. Create a build-only Python environment. Install `build`, `scikit-build`, `cmake>=3.26,<4` and `ninja` in it. Do not install these tools on the end user's machine.
3. From a Visual Studio developer shell, run `python -m pip wheel . --no-deps --wheel-dir dist` in the full Piper source tree. Its CMake ExternalProject clones espeak-ng at the pinned commit. For an offline build, replace the ExternalProject's `GIT_REPOSITORY`/`GIT_TAG` entries with `SOURCE_DIR` pointing to the included extracted espeak source and `DOWNLOAD_COMMAND ""` / `UPDATE_COMMAND ""`; retain the original CMAKE_ARGS and build flags.
4. This compiles `src/piper/espeakbridge.c`, links the static espeak-ng and ucd libraries and builds/copies espeak-ng-data. The source tree's setup metadata identifies the same 1.8.0 Python module and includes its GPL notices. Read its platform build workflow for upstream compiler details when binary-level reproducibility is needed.
5. Install your rebuilt wheel into a fresh private runtime with the dependencies listed in Sol's lock file; for distribution of a rebuilt artifact, update the lock hash and retain your exact modified source/build instructions. `tools/prepare-voice-runtime.ps1` intentionally rejects a replacement wheel with the old hash.

Sol's stdio adapter sources are `worker.py` and `engines.py`; their copies ship next to this document and are also in Sol's source repository. Python itself is the unmodified official embeddable build with LICENSE.txt. Native transcribe.cpp is MIT and retains its package notices; its source is linked by exact version in NOTICE.md.

The prepared runtime and supplied source files have been verified and exercised using the actual upstream wheel. A new native compilation from these archives has not been performed in this feature check; no claim of bit-identical rebuild is made.
