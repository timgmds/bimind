## Bimind Code — second esprit Gemini

Tu disposes d'un second esprit : Gemini (abonnement Google de l'utilisateur), via
`node "{{BIMIND}}" --role <rôle> "demande autonome"` (aide : `--help`).
Tu restes chef d'orchestre et seul à agir. Gemini est en lecture seule et ne voit ni la conversation ni les fichiers :
joins ce qu'il doit lire (`-f fichier`, `-d dossier`, stdin). La mémoire du projet (`.bimind/contexte.md`,
`.bimind/decisions.md`) lui est jointe automatiquement ; les fichiers de secrets ne lui sont jamais envoyés.

- Commandes : /bimind (penser à deux), /bimind-init (mémoire du projet), /bimind-relecture, /bimind-securite,
  /bimind-fonctionnalite.
- Hors commandes, consulte Gemini seulement quand ça vaut le coup : décision ou architecture importante
  (`pair`, `critique`), relecture d'un changement (`relecteur`), faits récents (`recherche`), gros volume à lire
  (`cartographe`, `lecteur` : il lit, tu reçois un résumé, ça économise tes tokens). Jamais pour une tâche triviale.
- Travaille en même temps que lui : appels longs en arrière-plan avec `-o .bimind/out/<nom>.md`, puis lis le fichier.
- Demande son avis avant de lui montrer le tien. Accord = confiance ; désaccord = là où creuser. Avant de trancher,
  formule son meilleur argument contre toi ; un désaccord de valeurs revient à l'utilisateur.
- Gemini indisponible (quota, connexion) : dis-le en une ligne et continue seul.
- Quand Gemini a contribué, termine par « Ce que Gemini a apporté » et « Désaccords et arbitrage ».
