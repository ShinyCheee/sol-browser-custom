# Voix Sol AI

Implémentation : Parakeet Ultra Q8_0 (740363168 octets / 706 Mio), moteur transcribe.cpp 0.4.1 utilisé par Handy, réponse vocale Piper 1.8.0, composant beUI Voice Orb existant.

## Utilisation

**Ctrl+M** démarre ou arrête la voix quand Sol est actif : un seul raccourci, deux touches. L’orbe est le seul élément visible de la vue parlée ; il change de palette et possède un anneau de traitement. Bleu : écoute, ambre : transcription, violet : réflexion, bleu soutenu : action, vert : réponse. Cliquer sur l’orbe termine la prise de parole ou interrompt pour parler à nouveau. Les noms d’état restent accessibles aux lecteurs d’écran et au survol. Les confirmations explicites restent lisibles dans la discussion. Les erreurs reviennent dans le chat avec leur explication.

Le premier accès sans modèle ouvre Paramètres → Sol, où figurent l’installation et les options vocales. Le modèle et la voix française ou anglaise représentent environ 767 Mio. Installer n’ouvre pas le micro ; Ctrl+M active ensuite la voix. Le téléchargement peut être annulé depuis ces paramètres. Les modèles sont vérifiés par SHA-256 et partagés entre profils dans `%USERPROFILE%\.sol\voice-models`, hors sauvegardes cloud.

- **Un seul échange naturel**, sans sélecteur Consigne/Conversation : le texte reconnu est envoyé à `SendChatAsync`, avec le même historique, contexte de page, outils et confirmations que le chat écrit. Sol répond ou agit selon la demande, puis réarme l’écoute. Le micro est fermé pendant la réponse. Ctrl+M arrête la voix et la tâche vocale, puis rétablit la discussion existante ou referme le panneau qu’il avait ouvert.
- Le microphone et la lecture restent réglables pendant un tour. Changer le microphone pendant l’écoute ferme l’ancien et relance la capture ; couper la lecture vide le tampon audio et affiche les réponses écrites dans le chat, avec une petite orbe. L’écoute reprend aussi après une réponse muette.
- Un second appui pendant l’initialisation annule aussi le démarrage. Le micro ne redémarre pas après relance du navigateur, erreur, déconnexion ou passage en privé. Une seule fenêtre détient une session micro.
- Les confirmations des actions restent explicites et ne sont pas accordées par une simple détection de parole.

La capture utilise Silero VAD v6.2.1 (MIT, ONNX de 2,3 Mo inclus dans le runtime), avec 300 ms de préroulement, environ une seconde sans parole pour envoyer, 20 secondes sans parole pour mettre en pause et 30 secondes maximum par prise. Le volume ne décide plus si un bruit est une consigne. Parakeet charge en parallèle de la capture et son processus est conservé pour les tours suivants et les réactivations proches, puis libéré après deux minutes sans requête. Une requête au moteur expire en 60 secondes ; un tour capture/transcription en 75 secondes. Les premières activations peuvent rester plus lentes qu’une transcription à chaud.

## Essai OpenAI demandé

Le 6 novembre 2026, essai réel autorisé avec la connexion ChatGPT existante, sans micro ni texte personnel :

- Liste des modèles : HTTP 200, connexion valide.
- Speech `gpt-4o-mini-tts` : HTTP 401, `no_matching_rule`.
- Realtime `gpt-realtime-2.1-mini` : connexion WebSocket HTTP 101, puis réponse `failed`, code `unknown`, 0 octet audio.

Le parcours Sol utilise donc Piper local. Ce résultat ne signifie pas que les API vocales OpenAI sont indisponibles avec d’autres modes d’authentification. Aucun achat/crédit/clé API n’a été ajouté.

Reproduction explicite de la sonde : `dotnet run --project tools/audio-openai-probe -- <dossier du compte autorisé> <dossier de résultats>`. Ce programme utilise la logique existante de renouvellement OAuth, protège les secrets et produit uniquement des métriques et une phrase de test.

## Construction

Charger `tools/env.ps1`, puis `npm --prefix ui run build` et `dotnet build src/Browser.App -c Release -p:Platform=x64`. Le projet prépare le runtime Windows x64 épinglé via `tools/prepare-voice-runtime.ps1` ; caches dans `E:\dev\voice-wheels`, sortie dans `bin/voice-runtime`, copie sous `voice/runtime` de Sol. Aucun Python système ni installation de Handy n’est requis chez l’utilisateur.

Le manifeste `tools/voice-worker/runtime-lock.json` épingle chaque archive par SHA-256. Les bibliothèques sont fournies avec Sol ; seul le téléchargement des poids est proposé dans le produit. `worker.py` reçoit du JSON sur stdin et émet du JSON sur stdout ; les diagnostics natifs sont séparés sur stderr. L’inférence est séquentielle et l’annulation termine son processus privé.

Les licences restent dans les paquets. Le runtime inclut le sdist Python, le dépôt Piper v1.8.0 complet avec le pont C et CMake, et espeak-ng au commit exact de ce build. Lire `tools/voice-worker/NOTICE.md` et `REBUILD.md` ; une nouvelle compilation native n’a pas été effectuée. Les sources du composant et du script de préparation font partie du dépôt Sol. Aucun workflow CI/CD n’a été modifié.

La disponibilité est limitée à Windows x64 avec le runtime présent. Les autres installations affichent un message explicite, sans empêcher le fonctionnement du navigateur. ARM64 et Windows 32 bits nécessitent des moteurs adaptés et des essais matériels avant activation.

## Vérification

- Tests Core : `dotnet test tests/Browser.Core.Tests` ; segmentation Markdown fragmentée, limites, silence, générations périmées, téléchargements corrompus/annulés/verrouillés.
- Moteurs seuls : `bin/voice-runtime/python.exe -I tools/voice-worker/check.py bin/voice-runtime <modèles de test> <WAV français 16 kHz mono PCM16>`.
- Service réel : `dotnet run --project tools/voice-check -- <modèles de test> <WAV français>` ; deux tours avec Parakeet et Piper réels, capture WAV injectée et audio consommé en mémoire. Ne capture pas la pièce et ne joue aucun son.
- Interface native : `node tools/check-sol-voice.mjs <Sol.exe>` ; vraies fenêtres hors écran, profils jetables, états vocaux simulés et compte fixture sans inférence. Captures dans `bin/voice-evidence`.
- Régression des permissions : `node tools/check-ai-permissions.mjs`.

Les mesures du 6 novembre sur cette machine : première transcription synthétique française 6,41 s (chargement inclus) ; Piper a produit 20 paquets PCM / 149504 octets. Ce n’est pas une garantie de latence pour d’autres machines.

Au 7 novembre, 549 tests Core passent. Le harnais de service vérifie les vrais moteurs, l’absence de requête sur bruit continu, une phrase française normale et atténuée sous ronflement/souffle, deux tours, la reprise après une réponse muette, un seul processus persistant, la fermeture de la capture avant lecture, la concurrence micro, l’annulation et la reprise après confirmation. Détection de fin à 4,70/4,77 s dans le fichier bruité (rejeu CPU 225/205 ms). Transcription à chaud mesurée à 2254 ms ; le premier tour a pris 29,6 s pendant les constructions. Un essai isolé ultérieur a mesuré 5,02 s de chargement et 3,89 s de première inférence : aucune garantie de latence matérielle.

Les contrôles natifs passent pour l’entrée vocale, la présence réelle du moteur, le blocage sans modèle, l’installation annulée, les modes et l’orbe à 220/380/520 pixels, les thèmes, le mouvement réduit, la fermeture/réouverture sans capture et le passage en privé. La régression des confirmations vérifie persistance, révocation et carte périmée. Les captures sont conservées ; les profils jetables sont supprimés.

La vérification automatisée n’utilise pas le microphone ou le haut-parleur physiques, ni de vraie action ChatGPT pendant les tests fixture. Ces limites doivent rester distinctes d’un essai vocal manuel et d’une activation du paquet Microsoft Store.
