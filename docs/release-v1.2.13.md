# Sol 1.2.13

- **Sauvegardes sans nouvelle saisie de clé** : la clé est conservée protégée par Windows et réutilisée pour les sauvegardes manuelles et automatiques, y compris après redémarrage. Désactiver l'automatique conserve la clé pour les envois manuels.
- **Mise à jour de la sauvegarde existante** : une seule sauvegarde par appareil, avec un identifiant conservé. Le nouvel envoi est vérifié avant remplacement ; un échec conserve la sauvegarde précédente. Les sauvegardes des autres appareils sont préservées.
- **Archives allégées** : exclusion des copies temporaires d'installation et des index d'extensions générés par WebView2. Les fichiers sont compressés depuis le disque pour éviter de charger toutes les extensions en mémoire. Les limites de restauration restent actives et les erreurs locales sont mieux expliquées.
- **Économie mémoire plus réactive** : mise en veille et déchargement sûr anticipés lorsque Windows manque de mémoire, avec conservation des protections des brouillons, médias et téléchargements. Une erreur native de suspension utilise le niveau mémoire bas.
- **Inspecteur réseau au repos** : la fermeture arrête la collecte et libère les buffers du moteur ; l'historique conservé est retrouvé à la réouverture. Les textes et en-têtes des diagnostics sont bornés en taille.

Cette version ne garantit pas une consommation totale inférieure à 100 Mo : celle-ci dépend aussi du moteur WebView2, des pages actives et des extensions.
