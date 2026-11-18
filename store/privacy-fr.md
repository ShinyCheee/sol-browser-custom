# Politique de confidentialité de Sol Navigateur

Date : 17 novembre 2026. Éditeur : Steven KOULO.
Contact : contact@stevencrdkoulo.space.

Sol Navigateur est un navigateur Windows reposant sur Microsoft WebView2. Cette politique décrit les traitements propres à Sol (version 1.2.13). Les sites visités, extensions installées et services externes appliquent également leurs propres politiques.

## Données conservées sur votre appareil

Sol conserve dans le profil Windows les paramètres, onglets et sessions isolées par onglet, favoris, historique, notes riches (avec pièces jointes et mémos), téléchargements et autorisations de sites. Le moteur WebView2 conserve notamment les cookies, caches et données des sites, ainsi que les mots de passe lorsque leur enregistrement est activé. Les jetons de connexion ChatGPT sont protégés au moyen du chiffrement Windows (DPAPI) lié au compte utilisateur. Les exports et sauvegardes locales sur fichier sont enregistrés à l’emplacement que vous choisissez et chiffrés avec la clé que vous fournissez (non conservée par Sol pour un export local).

Sur Windows x64, si vous installez la fonction vocale, les modèles de parole sont enregistrés localement dans `%USERPROFILE%\.sol\voice-models`. Lorsque vous utilisez le téléchargement vidéo ou audio, les outils requis sont conservés dans le dossier local des données de Sol.

Vous pouvez effacer l’historique et les données de sites depuis les réglages, gérer les profils et sessions, et révoquer les autorisations. Les fichiers téléchargés ou exportés, les modèles vocaux et les copies de sauvegarde doivent être supprimés séparément. La navigation privée ne rend pas votre activité invisible aux sites, à votre réseau ou aux services que vous utilisez.

## Navigation, téléchargements et services en ligne

Les adresses consultées et les données saisies dans les sites sont transmises aux services concernés. Votre moteur de recherche reçoit vos recherches. Si les suggestions en ligne sont activées, les caractères saisis dans la barre d’adresse sont envoyés au service de suggestions configuré ; cette option est activée par défaut et peut être désactivée. Google est le moteur et le service de suggestions par défaut.

La traduction d’une page par Google transmet son adresse à Google Traduction. Les fonds d’écran en ligne sont téléchargés depuis Picsum Photos lorsque vous utilisez cette fonction. L’installation et la mise à jour d’extensions peuvent contacter le Chrome Web Store ou Microsoft Edge Add-ons, et les extensions disposent des accès que vous leur accordez.

Pour accélérer les téléchargements HTTP compatibles, Sol peut ouvrir plusieurs connexions vers le serveur d’origine du fichier demandé. Lorsque vous lancez un téléchargement de vidéo ou d’audio en ligne, Sol télécharge à la demande depuis GitHub Releases (avec vérification SHA-256) les outils officiels `yt-dlp`, `FFmpeg` et `Deno` (selon l’architecture Windows), puis les exécute localement vers l’adresse média demandée. Microsoft WebView2 et les services Windows peuvent réaliser leurs propres traitements selon vos paramètres Microsoft. L’édition Microsoft Store confie ses mises à jour au Microsoft Store.

## Compte Sol et sauvegarde en ligne facultatifs

La création d’un compte Sol et la sauvegarde en ligne sont facultatives. Le service d’authentification Neon reçoit votre adresse e-mail et votre mot de passe de compte pour gérer la connexion. Sol conserve localement la session de connexion, protégée par le chiffrement Windows (DPAPI) lié à votre compte utilisateur.

Avant leur envoi au stockage cloud, les sauvegardes sont compressées et chiffrées sur votre appareil avec une clé de sauvegarde distincte du mot de passe du compte. Elles peuvent contenir vos réglages, onglets et sessions, favoris, historique, notes et pièces jointes, mots de passe exportables, extensions et autorisations. La clé de sauvegarde n’est jamais envoyée au serveur : sans elle, Sol ne peut pas déchiffrer une sauvegarde ni récupérer son contenu.

Le service conserve uniquement le fichier chiffré et des métadonnées techniques : identifiant du compte, nom de l’appareil, date et taille. Les cinq sauvegardes les plus récentes sont conservées par compte ; les anciennes versions et les envois abandonnés sont purgés par le nettoyage automatique du service. Vous pouvez supprimer vos sauvegardes en ligne depuis les réglages de Sol.

Après une sauvegarde cloud réussie (manuelle ou automatique) ou une restauration cloud sur cet ordinateur, Sol conserve localement la clé de chiffrement sous protection Windows DPAPI (liée à votre session utilisateur Windows) afin de permettre les sauvegardes suivantes et, si vous l’activez, la sauvegarde automatique toutes les 24 heures. Conservez une copie de votre clé pour restaurer vos données sur un autre appareil. La déconnexion du compte Sol efface immédiatement la session locale ainsi que la clé de chiffrement enregistrée sur l’ordinateur ; elle ne supprime pas les sauvegardes chiffrées déjà stockées en ligne.

## Assistant facultatif connecté à ChatGPT et voix locale (Windows x64)

La connexion à ChatGPT est facultative. L’authentification et les demandes d’IA utilisent les services OpenAI avec votre propre compte. Les messages, le contexte utile à votre demande et les résultats des outils de l’agent peuvent être transmis à OpenAI (titres et adresses d’onglets, contenu structuré des pages, formulaires ou tableaux, ou titres et domaines pour le classement facultatif de l’accueil).

Sur Windows x64, le mode vocal facultatif traite le son du microphone intégralement sur votre appareil : la détection de parole est assurée localement par Silero VAD et la transcription par Parakeet (`transcribe.cpp`), puis la réponse est lue localement par synthèse vocale Piper. À la première installation de la voix, Sol télécharge avec votre action les modèles nécessaires depuis Hugging Face (`huggingface.co`, vérifiés par empreinte SHA-256) dans `%USERPROFILE%\.sol\voice-models`. Aucun flux audio brut du microphone n’est envoyé à OpenAI ni à l’éditeur ; seul le texte transcrit (accompagné du contexte habituel de la discussion si vous êtes connecté à ChatGPT) est transmis à OpenAI.

Lorsque vous demandez un diagnostic développeur et l’autorisez, les erreurs console et détails réseau utiles peuvent être transmis à OpenAI (adresses, statuts, en-têtes et extraits de réponse). Sol masque des secrets connus et limite les extraits, sans pouvoir garantir l’absence de toute donnée privée : vérifiez le contexte avant d’autoriser son analyse.

Les actions de l’agent sont soumises aux autorisations de Sol, révocables à tout moment dans les réglages. Les demandes envoyées à OpenAI sont configurées avec `store: false`, sans préjudice des règles de traitement et de conservation appliquées par OpenAI à votre compte.

## Conservation, contrôle et contact

Les données locales restent sur l’appareil jusqu’à leur suppression ou au nettoyage du profil ; les sauvegardes en ligne, exports et services tiers suivent leurs propres durées de conservation. Se déconnecter de ChatGPT ou de Sol Cloud supprime les jetons et clés conservés localement sur le PC, sans supprimer les données déjà traitées en ligne.

Pour toute question ou demande relative aux traitements assurés par l’éditeur, contactez contact@stevencrdkoulo.space. N’envoyez jamais de mots de passe, de clés de sauvegarde ni de jetons d’accès dans une demande d’assistance. Cette politique évolue avec les fonctions de Sol ; sa date indique la dernière mise à jour.
