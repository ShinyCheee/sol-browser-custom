# Identité de Sol

Les quatre PNG d’origine sont conservés à l’identique.

- `logo-transparent.png` alimente l’icône Windows, le logo du nouvel onglet et le logo de la configuration.
- `logo-original.png` est la version sur fond argenté utilisée à l’ouverture de la configuration.
- `wallpaper-original.png` et `wallpaper-dark-original.png` sont les fonds Sol clair et sombre du nouvel onglet.

`tools/sync-brand.ps1 -BrowserOnly` régénère les visuels du navigateur, les vignettes des réglages, les icônes multirésolution et l’image de l’installateur. `Sol.ico` utilise le logo transparent pour l’application et la barre des tâches. `SolFile.ico` reprend le logo sur fond clair pour les fichiers associés à Sol. Le paquet Microsoft Store applique la même distinction. `logo-windows.png` sert aux visuels de présentation.

Sans `-BrowserOnly`, le script synchronise aussi le logo des README et du film de lancement. `-LandingDirectory` permet de synchroniser les logos, les icônes et le fond du site dans son dépôt séparé.
