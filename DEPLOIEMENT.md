# QUALITIS — déploiement sur Vercel (comptes clients, suivi des analyses, espace admin)

## Contenu du dossier
- `index.html` : le site complet en UN seul fichier (site public, espace client, suivi, espace admin).
- `api/` : 3 fonctions serveur (comptes, demandes, admin) + `_lib.js`. Obligatoires pour l'enregistrement des données.
- `vercel.json`, `package.json` : configuration.

## 1. Mettre en ligne
- **Ligne de commande** : `npm i -g vercel`, puis `vercel --prod` dans ce dossier.
- **GitHub** : poussez le dossier, importez-le sur vercel.com (Framework Preset : *Other*, Build Command vide).

## 2. Activer le stockage des données (obligatoire)
1. Projet Vercel → **Storage / Marketplace** → ajouter **Upstash Redis** (offre gratuite suffisante) et le connecter au projet.
   Vercel crée `KV_REST_API_URL` et `KV_REST_API_TOKEN` (les noms `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` fonctionnent aussi).
2. Projet → **Settings → Environment Variables**, ajouter :
   - `ADMIN_PASSWORD` : mot de passe de l'espace admin (long et unique) ;
   - `SESSION_SECRET` : chaîne aléatoire de 32+ caractères (ex. `openssl rand -hex 32`).
3. **Redéployer** pour appliquer les variables.

## 3. Utilisation
- Site : `https://votre-projet.vercel.app`
- Admin : `https://votre-projet.vercel.app/admin`
- **Clients** : créent un compte entreprise (RC, NIF, NIS…), se connectent, déposent des demandes d'analyse et suivent leur avancement dans « Mon espace ».
- **Sans compte** : un visiteur reçoit une référence (ex. QL-2026-0001) et peut suivre sa demande avec cette référence + son email (section « Suivi »).
- **Admin** : voit toutes les demandes et tous les comptes, fait avancer chaque demande (Demande reçue → Échantillons réceptionnés → Analyses en cours → Rapport en préparation → Résultats transmis) avec un message facultatif visible par le client, exporte en CSV, supprime des entrées.

## Sécurité et données
- Mots de passe clients : hachés (scrypt + sel), jamais stockés en clair. Sessions client 7 jours, admin 8 h.
- Limitation des tentatives (connexion, création de compte, dépôts, suivi, admin).
- Données personnelles et identifiants fiscaux : gardez le mot de passe admin confidentiel et supprimez ce qui n'est plus utile.
- Pas de récupération de mot de passe automatique (aucun service d'envoi d'email configuré) : en cas d'oubli, l'équipe peut supprimer le compte depuis l'admin pour que le client le recrée.
- Si le serveur est indisponible, le formulaire d'analyse bascule sur l'envoi par messagerie vers qualitis.dz@gmail.com.

## Diagnostic : « Le service n'est pas disponible »
Ouvrez `https://votre-projet.vercel.app/api/health` :
- **Page introuvable (404)** : le dossier `api/` n'a pas été déployé. Déployez le dossier COMPLET (index.html + api/ + vercel.json + package.json), pas seulement index.html.
- **`missingEnv` non vide** : ajoutez les variables listées (Settings → Environment Variables), puis **redéployez** (Deployments → ⋯ → Redeploy). Elles ne s'appliquent qu'aux nouveaux déploiements.
- **`redisReachable: false`** : la base Upstash n'est pas connectée au projet (Storage → Connect Project), ou les variables sont celles d'un autre projet.
- **`"ready": true`** : tout est bon, les comptes fonctionnent.
Si vous ouvrez le fichier `qualitis.html` directement depuis votre ordinateur, les comptes ne peuvent pas fonctionner : il faut le site déployé.

## Mode autonome (fichier HTML seul)
`index.html` fonctionne aussi sans serveur : si `/api` est absent ou non configuré, comptes, demandes, suivi et admin tournent en local dans le navigateur de l'appareil (bandeau « Mode autonome »). Admin en mode autonome : mot de passe `admin`. Ces données restent sur l'appareil : seul le déploiement Vercel avec `api/` centralise les demandes de tous les visiteurs.
