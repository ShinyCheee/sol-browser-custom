# Sol 1.2.15

- La fermeture d’un onglet en arrière-plan conserve l’onglet affiché. Après fermeture de l’onglet actif, Sol privilégie un onglet déjà chargé du même groupe, puis un onglet libre, et évite de réveiller les onglets en veille.
- La navigation privée s’ouvre dans un onglet isolé au sein de la fenêtre existante. La fermeture lance le nettoyage de son profil même si le moteur tarde à effacer ses données.
- Le lecteur vidéo flottant reste redimensionnable sans créer d’entrée supplémentaire dans la barre des tâches ou Alt+Tab. Sol évite de déclencher automatiquement ce lecteur sur une page autorisée à utiliser le micro ou la caméra. Les commandes de partage d’écran restent accessibles.
