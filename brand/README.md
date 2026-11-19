# Identité de Sol

Les quatre PNG d’origine sont conservés à l’identique.

- `logo-transparent.png` alimente l’icône Windows, le logo du nouvel onglet et le logo de la configuration.
- `logo-original.png` est la version sur fond argenté utilisée à l’ouverture de la configuration.
- `wallpaper-original.png` et `wallpaper-dark-original.png` sont les fonds Sol clair et sombre du nouvel onglet.

`tools/sync-brand.ps1 -BrowserOnly` régénère les images du navigateur, les vignettes des réglages, l’icône multirésolution et l’image de l’installateur. L’icône inclut un fond argenté avec des coins transparents pour rester lisible sur la barre des tâches. Son export 256 px, `logo-windows.png`, sert à générer les variantes Microsoft Store.

Sans `-BrowserOnly`, le script synchronise aussi le logo des README et du film de lancement. `-LandingDirectory` permet de synchroniser les logos, les icônes et le fond du site dans son dépôt séparé.
