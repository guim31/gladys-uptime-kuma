# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/hub.test.js              # one file
node --test --test-name-pattern "down"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/app.js registers the handlers before connect()
src/app.js                        every SDK handler -> the hub (also used by the tests)
src/hub.js                        instances, reading timer, states, transitions -> scene events, views
src/devices.js                    one device per monitor: identity, features, names (4 languages), values
src/kuma/client.js                GET /metrics with the API key, errors by kind
src/kuma/metrics.js               Prometheus text parser, monitors of Uptime Kuma 1.x and 2.x
src/kuma/http.js                  node:http/https request (self-signed certificates on request)
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    dashboard widget `uptime_kuma` (manifest `widgets`)
src/texts.js                      connection, error, state, report and action texts (4 languages)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/store.js                      /data/uptime-kuma-state.json (last states, certificates, 1.x aliases)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
                                  and helpers/fakeKuma.js (checked against test/fixtures/kuma)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in English, French, German and Spanish: action
  messages, widget content, feature names, scene outputs, manifest texts, and
  `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync
  (`test/i18n.test.js` checks the languages and the doc sections).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  Issue GladysAssistant/Gladys#3198 (correctif #3199 non publié) : les appareils déjà créés sans
  `should_poll` ne seront jamais sondés, même après correction : ne jamais dépendre du seul `onPoll`
  (ici, minuteur interne du hub, vérifié par le test « the internal timer reads Uptime Kuma… »).
- **Logs** : le niveau info ne garde que le cycle de vie (démarrage, instance qui ne répond plus /
  répond à nouveau, service qui tombe / revient, certificat, une ligne par action). Les erreurs
  répétées à chaque cycle (refus du cœur, boucle de lecture, `/data`) passent par `src/problems.js`
  (`ProblemLog` : une ligne au début, une au rétablissement, `debug` entre les deux) ; une instance
  en échec est déjà dédupliquée par `record.error`. Le détail : `LOG_LEVEL=debug`. Un test vérifie
  qu'un cycle normal n'écrit rien en info.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

**Store et formulaires**

- Un champ `secret` du `config_schema` **ne peut pas avoir de `default`** : le validateur du store
  rejette le manifeste (« not allowed for secret fields »).
- Un champ à `source: "devices"` **ne peut pas avoir de `default`** non plus (schéma du cœur dès
  la 5.1.0). `multi_select` + `source: "devices"` est accepté dès la 5.1.0 dans les réglages de
  widget et les filtres de déclencheur (vérifié dans `manifest.schema.json` de `v5.1.0`).

## Uptime Kuma (propre à ce dépôt)

- **API lue : `GET /metrics`** (Prometheus), seule API de lecture stable et documentée, celle de
  Home Assistant (`pythonkuma`). Authentification `apiAuth` de `server/auth.js` : Basic, utilisateur
  vide, **clé d'API** en mot de passe (`uk<id>_<clé>`). Dès qu'une clé existe
  (`apiKeysEnabled`), le mot de passe de l'utilisateur ne suffit plus ; « Désactiver
  l'authentification » ouvre `/metrics` sans rien.
- **Limite de 60 requêtes d'API par minute**, partagée par tous les clients (`apiRateLimiter`) ;
  au-delà, la réponse est un **401 identique à une mauvaise clé**. Le texte d'erreur le dit.
- Séries par moniteur (`server/prometheus.js`, identique en 2.5.X et sur `master` 3.0.0-beta) :
  `monitor_status` (0 hors service, 1 en service, 2 en attente, 3 maintenance),
  `monitor_response_time` (ms, **-1** quand le test n'a rien mesuré), `monitor_cert_days_remaining`
  et `monitor_cert_is_valid` (sondes HTTPS seulement, **même avec « ignorer les erreurs TLS »**),
  et en 2.x `monitor_uptime_ratio` / `monitor_response_time_seconds` par `window` (1d, 30d, 365d).
  Libellés : `monitor_name`, `monitor_type`, `monitor_url`, `monitor_hostname`, `monitor_port`,
  **chaîne `"null"`** pour un champ vide, et **`"https://"`** (valeur par défaut du formulaire) comme
  URL d'une sonde non HTTP. `app_version{version,major,minor,patch}` donne la version.
- **1.x n'a pas de `monitor_id`** : identité = hachage du nom (deux sondes homonymes départagées
  par type et cible). **2.x** ajoute `monitor_id` et **un libellé par étiquette** (connue au
  démarrage d'Uptime Kuma seulement : une étiquette créée ensuite n'apparaît qu'après un
  redémarrage), d'où des séries d'une même sonde avec des jeux de libellés différents : regrouper
  par `monitor_id`. Un appareil créé sous 1.x garde son identité en 2.x (alias dans `/data`, posé
  quand l'appareil 1.x existe dans Gladys et pas celui de l'id).
- Une sonde **en pause n'a aucune série** (`stop()` appelle `prometheus.remove()`) ; une
  modification la retire puis la remet. Absente ≠ hors service : aucun événement.
- Uptime Kuma 2 **sans base configurée** répond une page HTML en 200 sur toute adresse, `/metrics`
  compris : traité comme « aucun Uptime Kuma à cette adresse ».
- Les **transitions** se calculent sur l'état « posé » (en service, hors service, maintenance) :
  « en attente » (nouvelle tentative) ne change rien. Premier passage : on enregistre sans
  annoncer. États et certificats annoncés gardés dans `/data/uptime-kuma-state.json`.
- Le **temps de réponse change à chaque test** : publié au plus une fois par minute et par sonde,
  et seulement pour les appareils ajoutés, pour tenir sous les 300 états par minute.
- Interface française d'Uptime Kuma : « Sondes », « Paramètres → Clés API », « En pause » ; les
  textes français de l'intégration disent « sonde ».
- Écrire (pause, reprise) passe par l'API Socket.IO de l'interface, avec identifiant, mot de passe
  et 2FA de l'administrateur : **écarté**, l'intégration est en lecture seule.

## Vérifié sur un vrai Uptime Kuma

Le 12/10/2026, image Docker de l'intégration lancée avec les contraintes du bac à sable de Gladys
(`--cap-drop ALL --security-opt no-new-privileges --read-only --memory 256m --pids-limit 256`,
volume `/data`, réseau en pont) contre `louislam/uptime-kuma:1` (1.23.17) et `:2` (2.5.6), avec
six sondes chacun : HTTP, HTTPS auto-signé (certificat de 10 jours, « ignorer TLS »), port TCP
ouvert, port fermé, mot-clé (nom avec guillemets), groupe vide ; étiquette sur une sonde en 2.x.

- **Sans Gladys** : reconnexion du SDK en backoff, pas de plantage, aucun secret dans les logs,
  ~19 Mo au repos, arrêt propre sur SIGTERM (code 0).
- **Client réel** : bonne clé (1.x et 2.x), mauvaise clé et clé de l'autre instance (`auth`),
  pas de clé (`key_missing`), hôte inconnu, port fermé (`unreachable`), autre service HTTP
  (`not_kuma`), HTTPS auto-signé refusé (`tls`) puis accepté avec l'option.
- **Intégration complète** (faux Gladys du SDK, deux instances, noms en français) : découverte des
  12 sondes, états, badge de transport, connexion, widget validé (`validateWidgetContent`),
  actions de scène, « Tester la connexion », « Certificat bientôt expiré » au premier passage (9
  et 10 jours). Serveur web de test **arrêté entre deux processus** : 8 « Un service tombe » à la
  relecture (état gardé dans `/data`) ; **relancé** : 8 « Un service revient » avec la durée ; une
  sonde **mise en pause** disparaît sans événement.
- **Mise à jour réelle 1.23.17 → 2.5.6 sur les mêmes données** : la migration garde les ids, les
  noms et la clé d'API ; les 6 appareils créés sous 1.x gardent leur identité (alias), aucun
  événement parasite.
- Non vérifié : une vraie instance Gladys (rendu du widget, éditeur de scènes, variables dans un
  message), la maintenance d'Uptime Kuma (statut 3, couvert par les tests seulement), un proxy
  inverse avec sous-chemin, MariaDB, la limite de 60 requêtes par minute atteinte pour de vrai.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
