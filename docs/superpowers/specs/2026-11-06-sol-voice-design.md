# Voix dans Sol AI

Date : 6 novembre 2026. Statut : validée par le propriétaire, développement autorisé. Relecture de préparation : aucune question importante restante pour établir le plan.

Correction explicite du propriétaire après l’implémentation : la vue vocale doit contenir uniquement l’orbe, sans commandes ni textes visibles. Il demande un seul raccourci composé de deux touches. Cette correction remplace les contrôles visibles et les gestes multiples décrits ci-dessous : Ctrl+M active/arrête la voix, les options et l’installation sont dans les paramètres. Le raccourci est libre dans Sol et son enregistrement a été vérifié puis libéré sur ce PC. Conversation avec réponse parlée est le défaut adapté à cette vue ; Consigne reste sélectionnable dans les paramètres. Les confirmations d’actions gardent leur interface explicite.

## Demande et résultat attendu

Le propriétaire veut donner des consignes à Sol AI à la voix et converser normalement avec lui, avec ou sans plusieurs actions. Il a choisi Parakeet Ultra d’environ 700 Mo, le dépôt Handy comme référence, le composant beUI Voice Orb et Piper pour les réponses vocales, sauf si l’API ChatGPT fournit cette possibilité dans le parcours de connexion actuel.

Deux modes partagent la discussion et les outils existants :

- **Consigne** : appuyer sur Parler, dicter une ou plusieurs instructions, terminer après une pause ou avec Terminer. Sol transcrit, envoie la demande et agit. L’écoute reste arrêtée après ce tour. La lecture de la réponse est activable.
- **Conversation** : démarrer explicitement, parler, laisser Sol répondre et agir, puis reprendre la parole lorsque l’écoute revient automatiquement. Plusieurs échanges conservent le contexte de cette discussion.

Les paragraphes suivants sont des choix proposés par l’agent, sauf lorsqu’ils reprennent explicitement la demande ci-dessus.

## État du code vérifié

- WinUI 3/.NET 10 et WebView2 ; panneau React dans `ui/src/SolChat.tsx`.
- `BrowserAi.Voice.cs` relie déjà la voix à `SendChatAsync`, aux confirmations et à la fermeture du panneau.
- `WindowsVoice.cs` utilise actuellement SAPI, avec une seule reconnaissance et une lecture après la réponse entière.
- `SolAiPermissions.VoiceAvailable` vaut `false` ; le parcours vocal est donc masqué.
- Le vrai composant beUI `VoiceOrb` et ses modules sont déjà installés sous `ui/src/components/agents/` ; pas de besoin de remplacer le panneau de discussion.
- `SolVoiceText` nettoie le Markdown et refuse les confirmations ambiguës ; ces protections doivent être conservées et adaptées au texte incrémental.
- Les outils et leurs permissions sont déjà gérés dans le contrôleur et `SolAiPermissions`.

## Choix des moteurs et sources vérifiées

### Transcription locale

Utiliser le moteur de Handy, **transcribe.cpp**, directement dans un service vocal de Sol. Ne pas demander l’installation de Handy et ne pas importer toute son application Tauri/Rust.

Modèle exact du catalogue Handy consulté le 6 novembre :

- Identifiant : `parakeet-ultra`, quantification `Q8_0`.
- Dépôt : `handy-computer/parakeet-ultra-gguf`.
- Révision : `39eeb55181f0d354fd934f06e92fd8d5037fed8e`.
- Fichier : `parakeet-ultra-Q8_0.gguf`.
- Taille exacte : `740363168` octets, soit environ 706 Mio (740 Mo décimaux).
- SHA-256 : `007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59`.
- 25 langues, dont le français ; entrée mono à 16 kHz. Le modèle n’effectue pas de transcription native en continu : on lui remet une séquence après détection de fin de parole.
- Licence indiquée par le catalogue : CC BY 4.0 ; moteur transcribe.cpp sous MIT.

La version publique transcribe.cpp v0.4.1 fournit une archive Windows x64 CPU/Vulkan. La capture ne doit pas imposer un GPU ; le chemin CPU doit fonctionner. L’accélération est facultative et ne sera activée qu’après vérification.

### Réponses parlées

OpenAI propose des API vocales en streaming. Toutefois Sol emploie un jeton OAuth de partage du forfait ChatGPT : la documentation vérifiée dirige ce parcours vers Responses ; elle ne confirme pas l’accès à Speech/Realtime avec ce jeton. Le propriétaire demande explicitement le 6 novembre de tester d’abord ces API audio officielles avec la connexion existante, puis de passer à Piper si elles ne fonctionnent pas. Tester uniquement une phrase synthétique, sans micro ni contenu personnel, sans exposer les jetons et sans ajouter de clé API ou de facturation.

Choix proposé : **Piper local** (`OHF-Voice/piper1-gpl`), qui documente une production de blocs PCM par `PiperVoice.synthesize`. Synthétiser les phrases de la réponse affichée au fur et à mesure, avec une file de lecture ordonnée. Ne pas attendre tout le texte avant de lancer la première phrase.

Piper est sous GPL v3. Son moteur et ses dépendances sont distribués séparément dans un auxiliaire vocal, avec notices, version, sources correspondantes et instructions de reconstruction. Ne pas modifier la licence MIT du code existant par omission ; préparer explicitement les éléments requis pour les composants redistribués. La séparation de processus est un choix technique, pas une conclusion juridique sur les licences.

Voix française proposée : `fr_FR-siwis-medium`, échantillonnage 22 050 Hz. La fiche indique un corpus CC BY 4.0. Épingler la révision, les fichiers ONNX/config, leurs empreintes et les mentions de la voix avant intégration. La voix anglaise et ses mentions seront choisies avec les mêmes critères techniques. Le choix exact d’une autre voix de qualité comparable reste au développeur si les fichiers ne conviennent pas à la redistribution.

## Parcours et interface

Le bouton micro actuel devient visible quand le service est pris en charge. Il ouvre un bloc compact dans le panneau Sol AI, sans changer l’agencement du navigateur.

- Premier accès : proposer **Installer la voix**, avec taille du modèle Parakeet et taille supplémentaire du moteur/voix distinguées. Aucun démarrage du micro à cette étape.
- Afficher progression, annulation, nouvelle tentative et état prêt. Une installation incomplète n’est jamais utilisable.
- Une fois prêt : choix **Consigne / Conversation**, bouton **Parler / Démarrer**, commande de lecture vocale et sélection du microphone si plusieurs périphériques sont présents.
- Utiliser le composant beUI déjà installé. Son activité reçoit le niveau réel de capture ou de lecture ; ses états correspondent à écoute, transcription, travail, réponse, pause et erreur. Le mouvement réduit et un repli visuel statique sont conservés.
- Afficher la transcription finale, puis la réponse textuelle habituelle. Parakeet Ultra n’offrant pas de flux natif, ne pas présenter une fausse transcription mot par mot.
- **Terminer** valide l’audio de la consigne en cours ; **Arrêter** abandonne l’audio ou la lecture et désarme la reprise automatique ; **Fermer** libère le micro et le service de ce panneau.
- Pendant une réponse, **Interrompre et parler** coupe la lecture et la tâche active avant de relancer le micro. Pas de double écoute pendant le haut-parleur dans cette première version.
- Les erreurs donnent une action utile : autoriser le micro Windows, sélectionner un périphérique, réessayer le téléchargement ou la reconnaissance. La discussion au clavier reste utilisable.

Valeurs initiales proposées : mode Consigne par défaut ; réponse parlée active en Conversation et désactivée en Consigne ; langue de l’interface comme indication pour la transcription et la voix ; français prioritaire pour les vérifications.

## Audio et enchaînement

Une session possède un identifiant de génération et un seul tour actif. États : fermé, installation, prêt, écoute, transcription, travail, confirmation, parole, pause, erreur.

1. Après un démarrage explicite, capturer le microphone et produire du PCM mono 16 kHz.
2. Détecter le début et la fin de parole avec préroulement pour préserver les premières syllabes. Distinguer silence et enregistrement trop court ; ne rien envoyer dans ces cas.
3. Point de départ ajustable après mesure : environ 1,2 seconde de pause après parole. Autoriser Terminer manuellement et borner la durée à deux minutes avec indication visible avant la limite.
4. À la fin de capture, arrêter le microphone, transcrire hors du fil UI, puis remettre le texte non vide à la discussion existante. Ne jamais lancer deux requêtes en parallèle pour le même tour.
5. Pendant travail et lecture, le microphone reste fermé pour éviter de reconnaître Sol ou les sons de l’ordinateur.
6. En Conversation, revenir à l’écoute après la fin de la tâche et de toute la file audio, uniquement si le mode est encore actif et aucune confirmation n’est en attente. En Consigne, rester prêt sans écouter.
7. Stop, fermeture, déconnexion ChatGPT, passage en privé et fermeture de fenêtre invalident les callbacks, annulent les opérations et ferment les périphériques. Une erreur ne réarme pas automatiquement le micro.

Le silence prolongé sans parole met l’écoute en pause avec Reprendre, plutôt que garder une session inattendue. La durée initiale proposée est 30 secondes. Aucun mot de réveil ni écoute au démarrage de Windows.

## Réponses en streaming et actions

Utiliser les deltas du texte utilisateur visible de la discussion, sans vocaliser raisonnement interne, paramètres d’outils, sorties techniques ou contenu de page non repris par la réponse.

Un accumulateur reconnaît les phrases complètes, retire le Markdown et attend les éléments incomplets (lien, bloc de code). La dernière phrase est vidée à la fin du message. Garder l’ordre exact, sans répétition entre le flux et la réponse finale. La file est bornée pour les longues réponses ; une interruption supprime immédiatement les blocs non lus. Une synthèse défaillante n’annule pas les actions déjà réalisées et n’efface pas la réponse écrite.

Les confirmations d’actions gardent leurs règles actuelles. Une phrase contenant plusieurs instructions part comme une seule demande à Sol AI et les outils gèrent la séquence. Ne pas transformer une détection sonore en permission générale. Pour une confirmation, afficher les détails, suspendre la conversation, proposer le bouton de réponse vocale existant et accepter uniquement une réponse explicite non ambiguë liée à la confirmation courante. Une phrase non reconnue laisse la confirmation en attente.

## Intégration et distribution

- Service vocal séparé du raisonnement ChatGPT et du rendu React : acquisition/VAD, adaptation transcribe.cpp, Piper/lecture, téléchargements et orchestration ont des responsabilités distinctes.
- Préférer un auxiliaire de processus persistant pour isoler les bibliothèques natives, charger les modèles une fois et pouvoir interrompre une inférence bloquée. Canal local hérité ou pipes privés, sans port HTTP exposé. Ne pas transmettre les jetons ChatGPT au moteur vocal.
- Fournir les exécutables/bibliothèques dans les artefacts de Sol ; le téléchargement dans le produit concerne uniquement les poids vocaux et leurs données, pas l’installation de scripts ou d’un environnement Python système. La méthode de construction de l’auxiliaire reste au développeur, avec dépendances épinglées et reproductibles.
- La disponibilité dépend d’une matrice réellement vérifiée. Cible initiale validable ici : Windows x64. Construire/tester les adaptations ARM64 et x86 disponibles avant de les annoncer ; si un moteur n’est pas disponible, indiquer clairement l’incompatibilité, sans substituer un autre modèle ou revenir silencieusement à SAPI.
- Ne pas empêcher les autres fonctions de Sol de démarrer sur une architecture sans moteur vocal.
- Modèle et voix téléchargés à la demande depuis les sources éditeur épinglées, avec taille, SHA-256, fichier temporaire et renommage atomique après validation ; téléchargement annulable et reprise/nouvelle tentative sans résultat partiel accepté.
- Stockage utilisateur dédié aux modèles, accessible aux installations classique et Store ; exclu des sauvegardes cloud de profil. Ne pas embarquer les 706 Mio dans chaque installateur ni recopier le modèle par fenêtre.
- Un verrou évite deux installations concurrentes ; les modèles validés sont partagés en lecture. Une seule fenêtre détient le microphone de conversation à la fois ; les autres affichent qu’il est occupé.
- Les fichiers audio restent locaux, en mémoire autant que possible. Si le moteur nécessite un fichier, utiliser un dossier temporaire privé et le supprimer à la fin, sur annulation et au démarrage après incident. Seuls le texte transcrit et le contexte habituel partent à ChatGPT.
- Les préférences vocales peuvent être conservées ; le micro et le mode Conversation ne redémarrent jamais automatiquement après relance du navigateur.
- Aucun changement CI/CD, publication Store, tag ou push n’est compris dans cette étape. Si la distribution exige de modifier un workflow, préparer le changement pour une autorisation distincte.

## Vérification et critères de livraison

- Tests de logique : transitions des deux modes, silence, bornes de durée, segmentation de phrases et Markdown fragmenté, file audio, annulation, callbacks périmés, confirmations et accès concurrent.
- Tests de téléchargement : empreinte invalide, interruption, fichiers partiels, manque d’espace, installations simultanées, suppression des fichiers temporaires et exclusion des sauvegardes.
- Test réel avec le fichier Parakeet Q8_0 exact et un audio français déterministe : sortie pertinente, CPU utilisable et absence de dépendance au moteur de dictée Windows.
- Test réel Piper : plusieurs phrases synthétisées et consommées avant la fin du texte complet, format PCM vérifié, arrêt effectif sans bloc audio en retard.
- Tests natifs Sol hors écran sur profil jetable : installation/annulation, erreurs micro, états de l’orbe, deux modes, deux tours successifs, confirmations, fermeture, bascule privée, déconnexion, réouverture sans écoute, plusieurs fenêtres et nettoyage. Captures claires/petites fenêtres et mouvement réduit.
- Mesurer et rapporter les temps de chargement, de première transcription et de première lecture sur cette machine ; ne pas promettre une latence universelle.
- Vérification micro/haut-parleur physique si le matériel est disponible ; ne pas confondre ce résultat avec un test WAV automatisé. Les éventuelles limites de matériel ou d’architecture sont rapportées explicitement.
- Build UI, application Release, tests Core et vérifications du pont existant ; ajuster les tests qui exigeaient auparavant la voix masquée.
- Tous les fichiers de code nouveaux ou modifiés restent à 300 lignes maximum, avec les fins de ligne existantes. Aucun profil personnel ni compte de production utilisé pour les tests.
- La fonctionnalité est livrable lorsque l’on peut dicter une demande, obtenir une action réelle et une réponse parlée, puis poursuivre un second tour en Conversation, sans capture après arrêt. Pas de façade « prête » si le moteur réel ne fonctionne pas.

## Références

- [Handy et son moteur](https://github.com/cjpais/Handy/blob/main/src-tauri/Cargo.toml)
- [Catalogue Handy, modèle exact et empreintes](https://github.com/cjpais/Handy/blob/main/src-tauri/src/catalog/catalog.json)
- [Parakeet Ultra dans transcribe.cpp](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet-ultra.md)
- [Binaires transcribe.cpp v0.4.1](https://github.com/handy-computer/transcribe.cpp/releases/tag/v0.4.1)
- [beUI Voice Orb](https://beui.dev/components/agents/voice-orb)
- [Piper et API de synthèse par blocs](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md)
- [Licence du moteur Piper](https://github.com/OHF-Voice/piper1-gpl/blob/main/COPYING)
- [Fiche de la voix siwis](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD)
- [OpenAI : synthèse vocale](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenAI : modèles et inférence avec le forfait ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [OpenAI : limites du parcours ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
