# Correctifs mémoire et sauvegardes — 15 novembre 2026

## Périmètre

Corrections dans le dépôt `E:\projet-navigateur`, sur `main`, sans refonte de la coque, désactivation d'extensions personnelles, modification de la CI ou changement de profil utilisateur. La version installée du Store n'a pas été remplacée. Le service corrigé a été testé sur une branche Neon jetable, pas déployé en production.

## Mémoire

- Une suspension WebView2 qui lève une exception revient maintenant au niveau mémoire bas lorsque la vue est encore cachée et valide. Une réponse tardive ne remet pas un panneau rouvert en veille.
- L'économiseur consulte la mémoire disponible à chaque passage. Sous pression (moins de 12,5 % de la RAM, seuil borné entre 256 et 1 024 Mio), il demande la suspension après 15 secondes et le déchargement sûr après deux minutes. Les délais ordinaires sont conservés hors pression.
- Les protections des brouillons, formulaires modifiés, sessions privées, médias, téléchargements, vues scindées et appareils simulés sont conservées.
- Fermer l'inspecteur désactive ses domaines réseau et runtime, libère ses buffers de capture et arrête la collecte. Les journaux bornés restent consultables à la réouverture. Les anciennes entrées console du moteur ne sont pas réinjectées dans l'historique comme si elles avaient été capturées pendant la fermeture.
- Les textes de console et les en-têtes sont bornés aussi en taille, et plus seulement en nombre d'entrées.
- La sauvegarde compresse les fichiers d'extension directement depuis le disque. Elle ne conserve plus en mémoire une copie intégrale de toutes les extensions décompressées. Le chiffrement évite également une copie supplémentaire du ZIP en mémoire.

Il n'y a ni GC périodique forcé, ni `EmptyWorkingSet`, ni suppression de protections Chromium. Le seuil global de 100 Mo n'est pas garanti par ces corrections : la coque WebView2 et les pages actives conservent un coût de base élevé. La détection de couleur et la durée de conservation du chat ne sont pas modifiées dans ce lot, afin de préserver leur comportement.

Le dernier scénario vierge mesure **221 057 024 octets privés résidents, soit 210,8 Mio / 221,1 Mo**, avec neuf processus et une seule cible d'interface initialisée. Le commit privé vaut 303 517 696 octets et n'est pas additionné à la RAM résidente. Ce relevé confirme que la cible de 100 Mo reste non atteinte ; les échantillons avant/après ne constituent pas une comparaison suffisamment contrôlée pour annoncer un pourcentage de gain. Preuve : `bin/memory-audit-2026-11-15/performance-after.log`.

## Cause de l'échec des sauvegardes

Le journal personnel contenait plusieurs erreurs locales `InvalidDataException` : contenu supérieur à la taille restaurable. L'ancien message présentait à tort ce problème comme un refus du service.

Les fichiers candidats représentaient environ 648,5 Mio, dont 646,4 Mio dans les extensions. L'archive prenait notamment des dossiers `store-<guid>`, des copies `<extension>-previous-<guid>` et des index de règles générés par WebView2. Le filtrage ramène les fichiers d'extensions concernés à environ 360,6 Mio, sans rien effacer sur le disque. Cette estimation porte sur les fichiers avant compression, pas sur une mesure de RAM ni sur la taille chiffrée finale.

Le collecteur écarte uniquement ces copies temporaires et les index générés ; les sources des extensions, leurs règles et les autorisations de session sont conservées. Les plafonds de taille, le chiffrement et les contrôles de restauration restent actifs. Une erreur de taille locale affiche désormais un message adapté.

## Clé et sauvegarde existante

- La clé d'une sauvegarde cloud réussie est conservée dans le fichier de session protégé par Windows/DPAPI, pour le compte Windows courant.
- « Sauvegarder maintenant » réutilise cette clé. Activer l'automatique la réutilise aussi.
- Désactiver l'automatique arrête sa planification et conserve la clé pour les sauvegardes manuelles, y compris après redémarrage.
- Les anciens fichiers contenant uniquement `AutoKey` restent compatibles.
- Une expiration d'authentification conserve la clé protégée ; une reconnexion au même compte la reprend. Une déconnexion explicite efface la session locale.
- Une clé refusée ne remplace pas la sauvegarde existante ; elle est retirée des tentatives automatiques afin de permettre une nouvelle saisie.
- Le mot de passe du compte reste interdit comme clé de chiffrement.

La sauvegarde est unique **par compte et appareil**. Le client corrigé conserve son identifiant lors des mises à jour automatiques ou manuelles. Le nouveau contenu est envoyé dans un objet temporaire, vérifié, puis publié par une mise à jour transactionnelle du pointeur de stockage. Une validation refusée laisse l'ancienne sauvegarde lisible.

La colonne nullable `backups.object_id` permet de séparer l'identité stable de la sauvegarde de celle de son contenu. Les anciennes lignes sans pointeur restent lisibles. Le protocole stable est activé explicitement par les nouveaux clients ; les versions antérieures gardent leur protocole pour éviter qu'elles suppriment la sauvegarde qu'elles viennent de mettre à jour. Une erreur d'effacement des anciens objets après validation ne fait plus échouer un envoi déjà publié ; le nettoyage planifié les récupère.

Le profil courant constitue la nouvelle image de sauvegarde : les anciens fichiers disparus ne sont plus réintroduits depuis l'archive précédente. Les mots de passe précédemment sauvegardés restent fusionnés selon le mécanisme existant. Leur lecture est limitée à leur entrée ZIP, sans décompresser toutes les anciennes extensions ; cela permet aussi de récupérer cette entrée dans une ancienne archive dont l'expansion totale excède les plafonds actuels, sans ouvrir cette archive à une restauration intégrale non bornée.

Une restauration provenant d'un autre appareil n'autorise plus la suppression de la sauvegarde de cet autre appareil lors de l'envoi suivant.

## Validation

- Build interface TypeScript/Vite : réussi ; avertissement préexistant sur la taille des bundles.
- Build Release Windows x64 : réussi, six avertissements de nullabilité existants, aucune erreur lors du dernier build.
- Cœur : **565 tests réussis**. Un test de transfert sensible au timing a échoué pendant un premier passage ; il a réussi isolément puis dans la suite complète.
- Service cloud local : **10 tests réussis**, dont identité stable, refus d'un remplacement invalide, compatibilité des anciennes lignes/anciens clients et nettoyage différé après erreur de stockage.
- Harnais de suspension : exception native → mémoire basse, réouverture pendant une suspension en cours → vue éveillée.
- Sol natif : mise en veille/déchargement/reprise des onglets avec conservation des six catégories de documents protégés.
- Sol natif : chat et menu réouverts avec document et brouillon conservés ; zéro tick du menu suspendu pendant l'intervalle contrôlé. Le chat conserve son repli mémoire basse et n'est pas présenté comme un gel de tout JavaScript.
- Sol natif : fermeture de l'inspecteur sans collecte cachée, conservation de l'historique et reprise à la réouverture ; diagnostics HTTP/console, masquage des secrets et simulations de réponse/délai réussis.
- Branche Neon jetable : isolation des comptes, upload signé de 24 Mio, restauration identique à l'octet près, trois mises à jour successives gardant le même identifiant et une seule entrée, répétition de la validation et quotas vérifiés.
- Sol contre la branche jetable : clé réutilisée pour les sauvegardes manuelles et l'automatique, conservation après désactivation et redémarrage, clé absente en clair du fichier protégé, identifiant inchangé et mauvaise clé de restauration refusée.
- Restauration native complète : archive de **14 687 850 octets**, fermeture, redémarrage automatique, fichiers d'extension et données retrouvés à l'identique.

Les essais natifs utilisent des fenêtres hors écran et des profils jetables. Les comptes de test sont créés uniquement sur la branche vérifiée non productive. Le harnais cloud attend désormais la première peinture des paramètres, la fin réelle des synchronisations et l'arrêt de l'ancien runtime avant sa relance.

La branche de test et son fichier d'accès temporaire ont été supprimés ; le contexte Neon a été remis sur `production` sans déploiement sur cette branche. La capture des paramètres de sauvegarde est dans `bin/memory-evidence/backup-settings.png`.

## Activation

Au moment des essais du 15 novembre, les changements étaient disponibles dans le binaire local de développement et la branche Neon de test. Ces essais n’ont pas porté sur l’installation Microsoft Store ni sur la fonction de production.
