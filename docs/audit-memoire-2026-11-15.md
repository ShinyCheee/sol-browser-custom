# Audit mémoire de Sol — 15 novembre 2026

Audit du dépôt `E:\projet-navigateur`, branche `main`, commit `020d64d`, version source 1.2.12.
Application personnelle observée : MSIX 1.2.12.0. Aucun changement du code produit, des réglages ou des onglets personnels.

## Conclusion

L'objectif de 100 Mo pour l'ensemble de Sol n'est pas atteint. Deux facteurs distincts sont établis :

1. Un coût de base élevé, même avec une seule page locale simple et sans extensions personnelles.
2. Un pic transitoire dominé par des processus WebView2 démarrés en mode extension dans la session personnelle.

La politique actuelle économise des ressources, mais ne cherche pas à respecter un budget mémoire. Le nombre de vues conservées, les protections contre le déchargement et les extensions peuvent maintenir une consommation bien supérieure à la cible.

Cet audit ne démontre pas une fuite mémoire progressive : il faudrait des cycles reproductibles et des profils de tas pour l'établir. Il ne démontre pas non plus un minimum incompressible de WebView2. Une promesse de moins de 100 Mo en toute navigation n'est pas étayée.

## Mesures et méthode

Indicateur principal : somme de la mémoire privée **résidente** de Sol.exe et de ses descendants, fournie par `WorkingSetPrivate`. Le commit privé est relevé séparément. La somme des working sets totaux peut compter plusieurs fois des pages partagées ; elle n'est pas retenue comme indicateur principal.

Les unités ci-dessous sont des Mio (1 048 576 octets). Un budget strict de **100 Mo = 100 000 000 octets = 95,37 Mio** évite toute ambiguïté d'unité. Le compteur de la capture et ces relevés n'ont ni le même instant ni une équivalence d'affichage vérifiée.

| Observation | Mémoire privée résidente | Processus | Interprétation |
| --- | ---: | ---: | --- |
| Capture fournie | 249,6 « Mo » affichés | 15 | GPU 75,2 ; moteur 41,9 ; Sol 43,2 ; deux vues à 36,0 et 35,0 |
| Session personnelle, 10:46:39 | 122,9 Mio | 15 | Aucun processus vocal |
| Session personnelle, 10:46:55 | 145,1 Mio | 15 | Extensions : 2,3 Mio |
| Session personnelle, 10:47:11 | 444,3 Mio | 18 | Extensions : 244,1 Mio, répartis sur cinq processus |
| Session personnelle, 10:48:05–10:48:37 | 205,6–206,9 Mio | 14 | Retour à un processus d'extension, 2,7 Mio |
| Profil vierge, test de performance existant | 191,6 Mio | 9 | Une page locale active, autres onglets restaurés endormis ; CDP connecté |
| Autre profil vierge, CDP déconnecté depuis 25 s | 215,3 Mio | 9 | Une page locale, interface et worker de zoom Sol ; port de débogage encore activé |

Heures du Bénin, UTC+1. Les deux profils vierges sont des lancements indépendants : leur différence ne mesure pas l'effet causal de la déconnexion de CDP.

Au second lancement vierge : hôte 42,3 Mio ; processus moteur 43,6 ; GPU 57,0 ; deux renderers 49,1 au total ; extension 10,6 ; utilitaires et Crashpad 12,7. Les renderers ne sont pas attribués individuellement à une vue avec ces seuls compteurs.

Le pic personnel correspond à une hausse de 241,8 Mio pour la catégorie extension entre les deux derniers échantillons du premier relevé, contre une hausse totale de 299,2 Mio. L'association temporelle est forte ; elle ne permet pas de nommer l'extension ni de déterminer pourquoi ses processus ont démarré. Cette catégorie inclut potentiellement l'extension intégrée de Sol, pas seulement les extensions installées par l'utilisateur. Aucune extension personnelle n'a été désactivée.

Limites de mesure : échantillons espacés d'environ 16 secondes, session personnelle non contrôlée, aucune lecture de ses URL ou de ses contenus. Les CPU à zéro sur un échantillon ne prouvent pas un repos continu. La mémoire engagée personnelle était de 899,3 à 1 126,7 Mio sur le premier relevé : ce chiffre n'est pas de la RAM résidente supplémentaire à ajouter au total.

Machine : 8 007 Mio physiques ; 1 716,3 Mio disponibles au relevé d'environnement, après les essais. Windows 10.0.26300 ; un exécutable WebView2 présent lors de ce relevé indique 157.0.4341.46, sans attribution vérifiée au groupe Sol. Les essais vierges utilisent le binaire local 1.2.12.0 du 12 novembre, hors écran, sans identité MSIX. Son `Sol.dll` diffère de l'installation Store, même si `Sol.exe` et le bundle principal UI comparé ont les mêmes empreintes. Ils ne constituent donc pas une comparaison contrôlée Store/hors Store.

Preuves locales, sans URL personnelles :

- `bin/memory-audit-2026-11-15/live-samples.json`
- `bin/memory-audit-2026-11-15/live-followup.json`
- `bin/memory-audit-2026-11-15/clean-baseline.log`
- `bin/memory-audit-2026-11-15/disconnected-baseline.json`
- `bin/memory-audit-2026-11-15/environment.json`
- `bin/memory-audit-2026-11-15/disconnected-baseline.mjs`, scénario reproductible du second essai.

## Constats dans le code

### 1. Priorité haute — aucun pilotage par budget mémoire

Sources : `src/Browser.Core/TabMemoryPolicy.cs:5`, `src/Browser.App/PageHost.Memory.cs:16`, `src/Browser.App/PageHost.Memory.cs:58`.

La politique lit la RAM physique totale une seule fois. Elle ne consulte ni la RAM disponible pendant la session, ni la consommation du groupe Sol. Jusqu'à 8 Go, elle attend une minute avant la suspension et quinze minutes avant le déchargement ; au-delà, cinq et trente minutes. La boucle passe toutes les quinze secondes. Le navigateur peut donc dépasser largement 100 Mo sans avancer la libération.

Action : définir un budget global mesuré, puis une politique de libération des vues inactives selon leur dernière utilisation, la pression mémoire et la sûreté de leur état. Les seuils doivent être validés avec la latence de reprise et la conservation des brouillons. Un budget ne permet pas de forcer arbitrairement une page active à consommer moins.

### 2. Priorité haute — la coque nécessite elle-même du rendu web

Sources : `src/Browser.App/MainWindow.xaml:16`, `src/Browser.App/MainWindow.xaml.cs:110`, `src/Browser.App/UiBridge.cs:179`, `src/Browser.App/PageHost.NativeInitialization.cs:93`.

La barre et la sidebar sont une WebView2 React ; la page active est une autre vue. Le profil privilégié `SolInterface` est séparé des profils des sites. Chat, inspecteur, menus, capture, dock et onboarding ont aussi leurs contrôles, initialisés à la demande. Un contrôle déclaré en XAML n'implique pas à lui seul un renderer déjà créé ; de même, une vue ne correspond pas systématiquement à un processus distinct.

Le coût mesuré du scénario vierge dépasse déjà le budget. C'est un obstacle architectural, pas une preuve que React seul occupe les 215 Mio.

Action : comparer un prototype isolé de coque WinUI native, avec le même contenu web et le même matériel, avant de décider une migration. Préserver l'isolation de l'interface privilégiée. Ne pas désactiver la sandbox ou l'isolation des sites pour réduire le nombre de processus.

### 3. Priorité haute — extensions par session, y compris une extension obligatoire pour le zoom

Sources : `src/Browser.App/PageHost.ProfileStartup.cs:22`, `src/Browser.App/PageZoom.cs:35`, `src/Browser.App/PageZoom.cs:118`, `src/Browser.App/SharedExtensions.cs:62`.

Chaque profil de navigation préparé installe/active l'extension de zoom Sol et synchronise les extensions communes. Même sans extension personnelle, il existe donc un worker d'extension. Plusieurs sessions peuvent multiplier leurs instances. Le worker de zoom se réveille sur les événements de navigation et les demandes de rafraîchissement, dont certaines parcourent tous les onglets du profil.

Le pic personnel à cinq processus d'extension rend cette piste prioritaire, sans prouver qu'une extension précise est défectueuse.

Action : instrumenter le lien processus/profil/extension, compter les sessions réellement actives, mesurer les extensions séparément dans des profils jetables. Évaluer une autre intégration du zoom avec les API publiques adaptées, puis vérifier les clics dans les iframes, les PDF et les appareils simulés avant tout remplacement. Ne pas désactiver silencieusement le gestionnaire de mots de passe.

### 4. Priorité moyenne — déchargement volontairement conservateur

Sources : `src/Browser.App/PageHost.Memory.cs:70`, `src/Browser.App/PageHost.Memory.cs:128`, `src/Browser.App/PageHost.Memory.cs:132`.

La présence d'un iframe, d'un canvas, de sessionStorage, d'un éditeur ou d'un formulaire modifié suffit à conserver le document. Les onglets privés ne sont pas déchargés. Les appareils simulés, le son, les chargements et d'autres activités empêchent aussi certaines économies. Une page avec un simple iframe de publicité peut donc rester chargée longtemps sans brouillon utilisateur. `_discardProtected` reste posé jusqu'au retour sur l'onglet.

Action : distinguer les motifs de protection, en exposer les compteurs au diagnostic et revoir ceux qui sont trop larges. Ne pas supprimer les protections indistinctement : une restauration d'URL ne restaure pas tout l'état d'une application web.

### 5. Priorité moyenne — le chemin d'exception de suspension perd son repli mémoire basse

Sources : `src/Browser.App/PageHost.Memory.cs:90`, `src/Browser.App/PageHost.Memory.cs:95`, `src/Browser.App/UiViewRest.cs:35`.

`RestCoreAsync` remet la cible à `Normal` avant `TrySuspendAsync`. Si l'appel retourne `false`, le repli `Low` et `_suspendRefused` sont correctement appliqués. S'il lève une exception COM/InvalidOperationException, le gestionnaire externe journalise seulement : pas de retour à `Low`, pas de mémorisation du refus. Une vue encore valide peut rester à `Normal` et être réessayée à chaque passage. `UiViewRest` journalise également une exception sans tenter le repli.

Défaut établi par lecture du flot de contrôle ; fréquence réelle non reproduite pendant cet audit. Une vue déjà détruite ne peut naturellement pas être remise à `Low`.

Action : sur erreur de suspension, si la vue est encore valide, toujours tenter le repli bas et limiter les nouvelles tentatives ; tester aussi une réouverture pendant l'attente.

### 6. Priorité moyenne — fermer un panneau conserve sa WebView

Sources : `src/Browser.App/ChatHost.cs:26`, `src/Browser.App/ChatHost.cs:61`, `src/Browser.App/NetworkInspector.Requests.cs:129`, `src/Browser.App/PopupHost.cs:166`.

Les panneaux déjà utilisés sont masqués et mis au repos, sans fermeture de leur document. Le chat utilise explicitement `suspend: false` : `Low` et React Activity conservent état, DOM et mémoire applicative. Activity ne fige pas tout JavaScript ; le composant parent reste abonné aux messages. Cette conception privilégie les brouillons et la rapidité de réouverture.

Action : définir une durée de conservation, sauvegarder explicitement l'état nécessaire puis détruire les vues inactives quand cela est sûr. Les panneaux stateless comme certains menus sont les premiers candidats ; un chat en génération ou avec une approbation en cours exige un traitement distinct.

### 7. Priorité moyenne — travail de couleur coûteux et bundle commun

Sources : `src/Browser.App/UiAmbient.cs:65`, `src/Browser.App/UiAmbient.cs:75`, `src/Browser.App/UiEdge.cs:70`, `ui/src/main.tsx:3`.

Le timer appelle `SampleOnceAsync` toutes les secondes au premier plan et toutes les quatre secondes en arrière-plan. `LiveColor=false` coupe `ReadAmbientAsync`, mais pas ce premier sondage de thème. Quand les bords doivent être relus, la capture JPEG porte sur toute la zone visible, puis traverse JSON/base64, octets et décodeur pour lire deux filets de pixels. Elle n'est pas systématique chaque seconde : cache, stabilité et lecture unique limitent sa fréquence.

Cela peut produire des allocations temporaires et du travail graphique ; aucun nombre de Mo du pic ne lui est attribué par cet audit. Les gros coûts de capture restent une hypothèse à tester séparément, notamment avec une fenêtre à haute résolution.

Le point d'entrée importe également Workspace, Panel, Popup, Dock et Capture avant de choisir la vue par fragment. Le bundle principal construit fait 537 149 octets, avec des dépendances préchargées. Cette taille de fichier n'est pas une mesure de RAM et n'explique pas seule des centaines de Mo.

Action : rendre les sondages événementiels/autorisés selon la visibilité et les réglages ; comparer sans capture de bord. Séparer les entrées UI pour réduire les modules chargés inutilement, en tenant compte du chargement différé dans les vues masquées déjà documenté par le projet.

### 8. Priorité moyenne — capture réseau conservée et absence de test du budget

Sources : `src/Browser.App/NetworkInspector.cs:49`, `src/Browser.App/NetworkInspector.cs:105`, `src/Browser.App/BrowserController.DevicesLibrary.cs:49`, `tools/check-performance.mjs:27`.

Fermer l'inspecteur masque sa vue et remet `Shown` à null ; cela n'envoie ni `Network.disable` ni `Runtime.disable` aux pages précédemment inspectées. Les récepteurs et journaux restent actifs jusqu'à oubli de l'onglet. Le buffer réseau demandé est de 4 Mio par page inspectée, sans être une réservation intégrale garantie ; le journal conserve jusqu'à 400 requêtes et 200 messages console. Le nombre de messages est borné, mais pas leur longueur ni celle de tous les en-têtes.

Le test de performance mesure la RAM sans assertion de plafond. Les assertions portent notamment sur les vues initialisées, les messages de thème et les layouts ; un dépassement mémoire ne suffit donc pas à échouer ce test.

Action : arrêter les domaines et abonnements inutilisés hors capture explicite, conserver si souhaité un historique sérialisé borné en octets, et ajouter un critère mémoire sur plusieurs échantillons après stabilisation. Garder les mocks/répétitions actifs uniquement lorsqu'ils sont explicitement demandés.

## Ce qui fonctionne déjà

- Un environnement WebView2 est partagé : `src/Browser.App/AdBlock.cs:9`. Il n'y a pas ici un environnement complet créé pour chaque onglet.
- Les onglets restaurés endormis n'ont pas de vue avant activation : `src/Browser.App/PageHost.cs:117`.
- Le chargement du menu, du chat, du dock et d'autres panneaux est différé. Le test vierge ne voit qu'une cible d'interface avant leur première utilisation.
- Le déchargement ferme réellement la vue : `src/Browser.App/PageHost.Tabs.cs:34`. Il ne se limite pas à changer son apparence.
- Aucun moteur vocal Python dans les six échantillons personnels. Le worker est lancé à la demande et possède un délai d'arrêt après inactivité ; il reste néanmoins incompatible avec une promesse arbitraire de 100 Mo pendant l'inférence locale.
- Les transferts accélérés écrivent sur disque avec des buffers de 256 Kio par connexion, huit connexions par défaut (`src/Browser.Core/SegmentedTransfer.cs:20`). Ils ne chargent pas par conception le fichier entier en RAM.

## Ordre recommandé et critères de validation

1. **Mesurer correctement** : indicateur global privé résident, processus/profil/extension, vues vivantes/suspendues/détruites et raisons de protection. Pas de contenu personnel dans les relevés.
2. **Corriger les ressources conservées inutilement** : repli sur exception, écoute réseau hors panneau, durée de vie des vues UI, captures de couleur. Mesurer chaque changement séparément.
3. **Piloter les onglets selon un budget** : pression mémoire, dernière utilisation, délais plus courts pour les documents réellement sûrs. Régression obligatoire sur brouillons, connexion, média, téléchargements et vues scindées.
4. **Comparer une coque native et le coût du zoom** : prototype isolé, sans refonte générale préalable. Le coût vierge actuel justifie cette expérience.
5. **Installer un garde-fou reproductible** : même binaire, même version WebView2, même contenu, fenêtre visible puis réduite, plusieurs échantillons après stabilisation ; 1/10/30 onglets, cycles navigation/fermeture, ouverture/fermeture des panneaux, profils/extensions testés séparément. Vérifier aussi le commit privé, le CPU et le temps de reprise pour éviter un déplacement du coût vers le disque.

**Cible à accepter comme critère produit :** moins de 100 000 000 octets privés résidents pour un scénario défini de coque au repos et de page légère, si le prototype le confirme. Pour des sites arbitraires, plusieurs pages visibles, des extensions ou la voix locale, réduire autant que possible et publier les résultats par scénario ; aucune garantie universelle de 100 Mo n'est démontrée.

Ne pas utiliser `EmptyWorkingSet`, un GC périodique forcé ou des drapeaux désactivant les protections de Chromium pour afficher artificiellement un meilleur compteur.

## Références et validation de cet audit

- [Modèle de processus WebView2 — Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model) : moteur partagé, renderers, GPU et processus auxiliaires.
- [Gestion des performances WebView2 — Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance) : minimisation des vues, gestion de leur durée de vie et mesure.
- [MemoryUsageTargetLevel — Microsoft](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.memoryusagetargetlevel) et [TrySuspendAsync — Microsoft](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.trysuspendasync) : réduction de caches/suspension, sans plafond chiffré garanti.

Exécuté : six échantillons de la session personnelle et deux scénarios natifs hors écran à profils vierges. Le scénario existant a été exécuté avec `--baseline`, donc ses assertions fonctionnelles supplémentaires n'ont pas été exécutées. Les deux profils de test et leurs caches ont été supprimés par le harnais ; aucun dossier `sidebar-check-*` ne restait à la vérification. Aucun build, test unitaire, commit, push ou publication pendant cet audit.
