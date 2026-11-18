# Logiciels tiers livrés avec le navigateur

Le code propre à Sol est placé sous licence [MIT](LICENSE). Les composants tiers distribués avec l'application conservent leurs licences respectives résumées ci-dessous.

## Interface, rendu Markdown, formules et composants visuels

- **Dépendances npm de l'interface** : React, React Markdown, `remark-gfm`, `remark-math`, `rehype-raw`, `rehype-sanitize`, `rehype-highlight`, `rehype-katex`, `highlight.js`, `KaTeX`, `motion`, `qrcode.react`, `clsx`, `tailwind-merge` et les polices `@fontsource-variable/*` fournissent l'interface, le rendu CommonMark/GFM, l'assainissement HTML, la coloration syntaxique et les formules mathématiques. Les textes complets de leurs licences sont collectés automatiquement à chaque compilation et livrés dans `ui/licenses/third-party.txt`.
- **Composants et icônes intégrés** : composants d'agent **beUI** (licence MIT, <https://beui.dev>), blocs **Bencho** (licence MIT) et icônes **Lucide** (`lucide-react` sous licence ISC, `lucide-animated` sous licence MIT). Leurs notices figurent également dans `ui/licenses/third-party.txt`.

Sources principales : <https://github.com/remarkjs/react-markdown>, <https://github.com/remarkjs/remark-gfm>, <https://github.com/remarkjs/remark-math>, <https://github.com/rehypejs/rehype-sanitize>, <https://github.com/rehypejs/rehype-highlight>, <https://github.com/KaTeX/KaTeX>, <https://github.com/lucide-icons/lucide>.

## Éditeur de notes — Vditor

- `Vditor` 3.11.2, licence MIT, <https://github.com/Vanessa219/vditor>.
- Embarqué hors ligne pour l'édition riche des notes ; le texte complet de sa licence est livré dans `ui/vditor/LICENSE`.

## Mode lecteur — Mozilla Readability

- `@mozilla/readability`, licence Apache-2.0, <https://github.com/mozilla/readability>.
- Livré dans `inject/Readability.js` avec le texte de sa licence dans `inject/Readability-LICENSE.md` (et repris dans `ui/licenses/third-party.txt`).

## Installateur et mises à jour — Velopack

- `Velopack`, licence MIT, <https://github.com/velopack/velopack>.
- Assure l'empaquetage par utilisateur et la vérification des mises à jour des éditions hors Microsoft Store.

## Sol Voice — Exécution vocale locale (Windows x64)

Sur Windows x64, Sol inclut un moteur vocal local exécuté dans un processus séparé (`voice/`). L'inventaire complet des paquets, URLs et empreintes SHA-256 est détaillé dans **`voice/NOTICE.md`**, et la procédure complète de reconstruction figure dans **`voice/REBUILD.md`**.

- **Détection vocale et capture audio (hôte et runtime)** :
  - `Microsoft.ML.OnnxRuntime` 1.31.1, licence MIT (<https://github.com/microsoft/onnxruntime>) — notices livrées dans `voice/ONNXRuntime-LICENSE.txt` et `voice/ONNXRuntime-ThirdPartyNotices.txt`.
  - **NAudio** (`NAudio.WinMM` 2.2.1, Mark Heath), licence MIT (<https://github.com/naudio/NAudio/tree/v2.2.1>) — licence livrée dans `voice/NAudio-LICENSE.txt`.
  - **Silero VAD** v6.2.1 (Silero Team), licence MIT (<https://github.com/snakers4/silero-vad/tree/v6.2.1>) — modèle ONNX non modifié et licence livrés dans `voice/runtime/`.
- **Transcription locale et environnement Python embarqué** :
  - **Python** 3.13.9 embarqué, PSF License Agreement et licences incluses (<https://www.python.org/downloads/release/python-3139/>) — licence livrée dans `voice/runtime/LICENSE.txt`.
  - **`transcribe.cpp` et `ggml`** 0.4.1, licence MIT (<https://github.com/handy-computer/transcribe.cpp/tree/v0.4.1>), ainsi que la référence d'implémentation **Handy** sous licence MIT (<https://github.com/cjpais/Handy>, aucun exécutable Handy redistribué).
  - Bibliothèques Python du runtime (`NumPy`, `onnxruntime`, `protobuf`, `flatbuffers`, `pathvalidate`, `packaging`) : licences conservées dans les dossiers `*.dist-info/licenses` et verrouillées par SHA-256 dans `voice/runtime/licenses/runtime-lock.json`.
- **Synthèse vocale sous `GPL-3.0-or-later` (processus travailleur séparé)** :
  - **Piper** 1.8.0 (`piper-tts`, Open Home Foundation / Michael Hansen, <https://github.com/OHF-Voice/piper1-gpl/tree/v1.8.0>) et **espeak-ng** (commit `724808c5a83f9ef95fdd0db886ba7ba537ff224a`), distribués sous licence **`GPL-3.0-or-later`**.
  - Exécutés uniquement dans le processus travailleur séparé piloté par flux standard (`voice/worker.py` et `voice/engines.py`, livrés en code source). Les archives sources complètes de Piper v1.8.0 et d'espeak-ng ainsi que leurs fichiers `COPYING` sont livrés dans `voice/runtime/licenses/sources/` ; voir `voice/NOTICE.md` et `voice/REBUILD.md`.
- **Modèles vocaux téléchargés séparément (non inclus dans l'installateur)** :
  - Téléchargés à la demande depuis Hugging Face vers `%USERPROFILE%\.sol\voice-models` avec vérification SHA-256, sous licence **CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>) : **Parakeet Ultra** (`moondream/parakeet-ultra`, conversion GGUF `handy-computer/parakeet-ultra-gguf`) et voix Piper **fr_FR-siwis-medium** (SIWIS French Speech Synthesis Database, University of Edinburgh) / **en_US-lessac-medium** (`rhasspy/piper-voices`). Voir les attributions détaillées dans `voice/NOTICE.md`.

## Outils médias acquis à la demande (non redistribués avec Sol)

Lors d'un téléchargement vidéo ou d'une extraction audio initié par l'utilisateur, Sol peut télécharger à la demande depuis GitHub Releases (avec contrôle d'empreinte SHA-256) `yt-dlp` (Unlicense), `FFmpeg` (`FFmpeg-Builds` LGPL, licences conservées à l'extraction) et `Deno` (MIT). Aucun de ces binaires n'est inclus dans les paquets d'installation de Sol.
