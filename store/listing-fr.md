# Sol Navigateur

Naviguez, organisez vos espaces de travail et avancez sur vos tâches avec un navigateur léger et un assistant IA intégré.

Sol est un navigateur Windows avec onglets verticaux, groupes, profils, sessions isolées par onglet, notes riches hors ligne et affichage de pages côte à côte. Son interface suit les couleurs de la page affichée et prend en charge les extensions du Chrome Web Store, de Microsoft Edge Add-ons ainsi que le mode développeur.

Connectez facultativement votre propre compte ChatGPT pour interroger les pages ouvertes et confier des actions contrôlées à l’agent navigateur : suivre une documentation, vérifier ou remplir un formulaire, extraire un tableau, organiser des onglets ou préparer une synthèse. Sur Windows x64, échangez aussi à la voix (`Ctrl+M`) : le microphone est traité localement sur votre PC par Silero VAD et Parakeet (modèles téléchargés à la demande depuis Hugging Face dans `%USERPROFILE%\.sol\voice-models`), seul le texte transcrit est envoyé à ChatGPT et les réponses sont lues localement par Piper.

Retrouvez vos données grâce aux sauvegardes chiffrées locales ou via Sol Cloud (chiffrées sur votre appareil avant envoi, avec clé protégée localement par Windows DPAPI après une sauvegarde réussie et effacée à la déconnexion), profitez des téléchargements HTTP multi-connexions et récupérez vidéos ou pistes audio grâce aux outils officiels (`yt-dlp`, `FFmpeg`, `Deno`) téléchargés et vérifiés à la demande depuis GitHub Releases.

Pour le développement web, inspectez la console et le réseau, simulez plusieurs appareils côte à côte, testez des réponses HTTP simulées et demandez l’analyse d’erreurs avec votre accord explicite.

- Onglets verticaux, groupes, profils et sessions isolées par onglet.
- Extensions Chrome Web Store, Microsoft Edge Add-ons et mode développeur.
- Notes riches hors ligne, mode lecteur et vue scindée côte à côte.
- Sauvegarde chiffrée locale et Sol Cloud (clé protégée sur le PC par Windows DPAPI).
- Assistant ChatGPT facultatif, actions en page et voix locale sur Windows x64 (`Ctrl+M`).
- Téléchargements HTTP multi-connexions et vidéo/audio à la demande (`yt-dlp`, `FFmpeg`, `Deno`).
- Outils de développement, simulateur d’appareils, console et inspection réseau.
- Interface en français et en anglais.

Microsoft WebView2 Runtime est nécessaire. Une connexion Internet et un compte ChatGPT compatible sont requis pour les fonctions d’IA ; la conversation vocale locale nécessite Windows 64 bits (x64) et le téléchargement initial des modèles vocaux.
