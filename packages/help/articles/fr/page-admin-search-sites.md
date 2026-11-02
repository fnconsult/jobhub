---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Sites et recherche web
synonyms: [sites, sites de recherche, sources, recherche d'offres, job discovery, recherche web, site de l'extension, job site, badge, domaine, activer une source, france travail, fantastic.jobs, réception par email]
route: /admin/parametres?tab=sources
---
Les sites que Jobbbox parcourt pour trouver des offres, et ceux où l'extension affiche son badge, sont dans trois onglets de Paramètres. Une modification s'applique sans mise en production : à la prochaine recherche pour le worker, en quelques minutes à quelques heures pour l'extension.

L'onglet « Sources » liste les « Sources de la recherche d'offres » : l'API France Travail, l'API Fantastic.jobs, la recherche web, les API publiques des ATS et la réception par email. Chacune a son interrupteur (« Activer … », « Désactiver … ») et sa « Disponibilité » : une source désactivée est ignorée, une source sans sa clé ou son fournisseur est indisponible.

L'onglet « Recherche web » choisit le « Fournisseur de recherche web » et son « Fournisseur de secours », montre les « Tâches IA de la recherche » et la liste « Sites de la recherche d'offres » : un site activé est cherché exprès, un site désactivé est ignoré quand il apparaît dans les résultats. Les sites qui interdisent l'exploration ne peuvent pas être ajoutés.

L'onglet « Extension » liste les « Sites de l'extension », où le badge « Analyser cette offre » s'affiche. Un site intégré à l'extension se désactive mais ne se retire pas.

Les super-admins et « Technique » changent les sources et les sites ; le Support les lit.
