# Budget Tracker pour Home Assistant

[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)
[![hacs][hacs-shield]][hacs]

Le composant **Budget Tracker** est un outil simple mais puissant pour suivre votre budget mensuel directement dans Home Assistant.

Il vous permet de saisir vos revenus et dépenses mensuelles, calcule automatiquement le solde, et sauvegarde ces données à la fin de chaque mois pour consultation ultérieure.

## Caractéristiques

- 💰 Suivi des revenus, dépenses et solde du mois en cours
- 📊 Sauvegarde automatique des données à la fin de chaque mois
- 🔄 Réinitialisation automatique au 1er du mois
- 📈 Visualisation de l'historique des mois précédents
- 👥 Prise en charge de multiples comptes (personnel, professionnel, etc.)
- 📝 Suivi détaillé des revenus et dépenses avec descriptions et catégories
- 🔁 Gestion des revenus et dépenses récurrents mensuels
- 🌐 Interface Lovelace intégrée

## Installation

### Via HACS (recommandé)

1. Assurez-vous que [HACS](https://hacs.xyz/) est installé
2. Ajoutez ce dépôt en tant que "Custom Repository":
   - URL: `https://github.com/MendoxIta/haos_budget`
   - Catégorie: "Integration"
3. Recherchez "Budget Tracker" dans HACS et installez-le
4. Redémarrez Home Assistant
5. Allez dans Configuration > Intégrations > Ajouter une intégration
6. Recherchez "Budget Tracker" et configurez-le

### Installation manuelle

1. Téléchargez le dossier `budget_tracker` de ce dépôt
2. Placez-le dans votre dossier `custom_components`
3. Redémarrez Home Assistant
4. Allez dans Configuration > Intégrations > Ajouter une intégration
5. Recherchez "Budget Tracker" et configurez-le

## Configuration

La configuration se fait via l'interface utilisateur de Home Assistant:

1. Allez dans Configuration > Intégrations > Ajouter une intégration
2. Recherchez "Budget Tracker"
3. Suivez les étapes pour configurer:
   - Nom de l'intégration (optionnel)
   - Comptes (séparés par des virgules)
   - Type de stockage (fichier ou entités input_text)

## Utilisation

### Services

Le composant fournit plusieurs services:

#### `budget_tracker.set_income`
Définit le montant total des revenus pour un compte (méthode simple).
```yaml
service: budget_tracker.set_income
data:
  account: default  # optionnel, "default" par défaut
  amount: 2500      # montant des revenus
```

#### `budget_tracker.set_expenses`
Définit le montant total des dépenses pour un compte (méthode simple).
```yaml
service: budget_tracker.set_expenses
data:
  account: default  # optionnel, "default" par défaut
  amount: 1800      # montant des dépenses
```

#### `budget_tracker.add_income_item`
Ajoute un élément détaillé de revenu (nouvelle fonctionnalité).
```yaml
service: budget_tracker.add_income_item
data:
  account: default       # optionnel, "default" par défaut
  amount: 1500           # montant du revenu
  description: "Salaire" # description de la source de revenu
  category: "Travail"    # catégorie (optionnel)
```

#### `budget_tracker.add_expense_item`
Ajoute un élément détaillé de dépense (nouvelle fonctionnalité).
```yaml
service: budget_tracker.add_expense_item
data:
  account: default         # optionnel, "default" par défaut
  amount: 800              # montant de la dépense
  description: "Loyer"     # description de la dépense
  category: "Logement"     # catégorie (optionnel)
```

#### `budget_tracker.remove_item`
Supprime un élément de revenu ou de dépense par son ID (nouvelle fonctionnalité).
```yaml
service: budget_tracker.remove_item
data:
  account: default                                # optionnel, "default" par défaut
  item_id: "1234abcd-ef56-7890-ab12-345678cdef90" # ID de l'élément à supprimer
```

#### `budget_tracker.clear_month_items`
Supprime toutes les entrées du mois en cours sans archiver ni réinitialiser.
```yaml
service: budget_tracker.clear_month_items
data:
  account: default       # optionnel, "default" par défaut
  clear_income: true     # optionnel, true par défaut, indique s'il faut supprimer les revenus
  clear_expenses: true   # optionnel, true par défaut, indique s'il faut supprimer les dépenses
  category: "Loisirs"    # optionnel, si spécifié, ne supprime que les entrées de cette catégorie
```

#### `budget_tracker.reset_month`
Force une réinitialisation du mois et archive les données.
```yaml
service: budget_tracker.reset_month
data:
  account: default  # optionnel
  year: 2023        # optionnel
  month: 12         # optionnel, 1-12
```

#### `budget_tracker.add_recurring_income`
Ajoute un élément de revenu récurrent mensuel.
```yaml
service: budget_tracker.add_recurring_income
data:
  account: default       # optionnel, "default" par défaut
  amount: 1500           # montant du revenu
  description: "Salaire" # description de la source de revenu
  category: "Travail"    # catégorie (optionnel)
  day_of_month: 5        # jour du mois où le revenu est perçu (1-31, par défaut: 1)
```

#### `budget_tracker.add_recurring_expense`
Ajoute un élément de dépense récurrent mensuel.
```yaml
service: budget_tracker.add_recurring_expense
data:
  account: default         # optionnel, "default" par défaut
  amount: 800              # montant de la dépense
  description: "Loyer"     # description de la dépense
  category: "Logement"     # catégorie (optionnel)
  day_of_month: 15         # jour du mois où la dépense est effectuée (1-31, par défaut: 1)
```

#### `budget_tracker.remove_recurring_item`
Supprime un élément récurrent de revenu ou de dépense par son ID.
```yaml
service: budget_tracker.remove_recurring_item
data:
  account: default                                # optionnel, "default" par défaut
  item_id: "1234abcd-ef56-7890-ab12-345678cdef90" # ID de l'élément récurrent à supprimer
```

### Entités

Pour chaque compte, l'intégration crée plusieurs entités:

- `sensor.budget_tracker_<account>_income_current_month`: Revenus du mois en cours
  - Inclut l'attribut `items` avec la liste détaillée des revenus
  - Inclut l'attribut `recurring_items` avec la liste des revenus récurrents
- `sensor.budget_tracker_<account>_expenses_current_month`: Dépenses du mois en cours
  - Inclut l'attribut `items` avec la liste détaillée des dépenses
  - Inclut l'attribut `recurring_items` avec la liste des dépenses récurrentes
- `sensor.budget_tracker_<account>_balance_current_month`: Solde du mois en cours

Pour les données historiques:
- `sensor.budget_tracker_<account>_income_<année>_<mois>`
  - Inclut l'historique des éléments de revenu
- `sensor.budget_tracker_<account>_expenses_<année>_<mois>`
  - Inclut l'historique des éléments de dépense
- `sensor.budget_tracker_<account>_balance_<année>_<mois>`

## Interface utilisateur Lovelace

Cette intégration inclut une carte Lovelace personnalisée pour gérer visuellement vos comptes, revenus, dépenses et éléments récurrents.

### Installation de la carte

1. Copiez les fichiers du dossier `www` (`budget-tracker-card.js`, `budget-tracker-card-editor.js` et `index.js`) dans le dossier `www/community/budget-tracker-card/` (créer le dossier et chemin si inexistant) de votre installation Home Assistant.
2. Ajoutez la ressource JavaScript à votre configuration Lovelace :
   - Allez dans Configuration > Tableaux de bord > Ressources
   - Cliquez sur "Ajouter ressource"
   - URL: `/hacsfiles/budget-tracker-card/budget-tracker-card.js`
   - Type de ressource: "JavaScript Module"
3. Redémarrez complètement Home Assistant (pas seulement le frontend).

### Utilisation de la carte

Il existe deux façons d'ajouter la carte à votre interface :

#### Méthode 1 : Interface utilisateur

1. Allez dans l'interface Lovelace.
2. Cliquez sur "Modifier le dashboard".
3. Cliquez sur "+ Ajouter une carte".
4. Faites défiler jusqu'à "Budget Tracker Card" ou recherchez-la.
5. Configurez la carte en sélectionnant vos entités de budget tracker.

#### Méthode 2 : Configuration YAML

Si vous utilisez l'éditeur YAML, voici un exemple de configuration :

```yaml
type: 'custom:budget-tracker-card'
title: 'Suivi de Budget'
entities:
  - sensor.budget_tracker_default_income_current_month
  - sensor.budget_tracker_default_expenses_current_month
  - sensor.budget_tracker_default_balance_current_month
```

### Fonctionnalités de la carte

La carte Budget Tracker offre plusieurs onglets pour gérer différents aspects de vos finances :

1. **Vue d'ensemble** : Résumé de vos revenus, dépenses et solde actuels
2. **Revenus** : Gestion détaillée de vos revenus
3. **Dépenses** : Gestion détaillée de vos dépenses
4. **Récurrents** : Gestion des revenus et dépenses récurrents mensuels

Chaque onglet vous permet d'ajouter, modifier ou supprimer des éléments directement depuis l'interface.

## Exemples de Cartes Lovelace

### Carte pour le mois en cours

```yaml
type: vertical-stack
cards:
  - type: entities
    title: Budget du mois en cours
    entities:
      - entity: sensor.budget_tracker_default_income_current_month
        name: Revenus
        icon: mdi:cash-plus
      - entity: sensor.budget_tracker_default_expenses_current_month
        name: Dépenses
        icon: mdi:cash-minus
      - entity: sensor.budget_tracker_default_balance_current_month
        name: Solde
        icon: mdi:scale-balance
    header:
      type: 'custom:mushroom-title-card'
      title: 'Budget: Mois en cours'
      subtitle: Aperçu du mois actuel
      icon: mdi:finance
  - type: 'custom:apexcharts-card'
    header:
      show: true
      title: Répartition du budget
      show_states: true
    graph_span: day
    series:
      - entity: sensor.budget_tracker_default_income_current_month
        name: Revenus
        color: '#28a745'
      - entity: sensor.budget_tracker_default_expenses_current_month
        name: Dépenses
        color: '#dc3545'
```

### Carte pour l'historique des mois précédents

```yaml
type: 'custom:apexcharts-card'
header:
  show: true
  title: Historique du budget
  show_states: true
graph_span: 6month
apex_config:
  legend:
    position: top
    horizontalAlign: center
series:
  - entity: sensor.budget_tracker_default_income_*
    name: Revenus
    color: '#28a745'
    type: column
    group_by:
      func: last
      duration: 1month
  - entity: sensor.budget_tracker_default_expenses_*
    name: Dépenses
    color: '#dc3545'
    type: column
    group_by:
      func: last
      duration: 1month
  - entity: sensor.budget_tracker_default_balance_*
    name: Solde
    color: '#17a2b8'
    type: line
    group_by:
      func: last
      duration: 1month
```

### Carte avec formulaire de saisie

```yaml
type: entities
title: Saisie du budget
entities:
  - entity: input_number.income_input
    name: Revenus
    icon: mdi:cash-plus
  - entity: input_number.expenses_input
    name: Dépenses
    icon: mdi:cash-minus
  - type: button
    name: Enregistrer
    icon: mdi:content-save
    tap_action:
      action: call-service
      service: script.save_budget_data
      data: {}
```

Avec le script suivant:

```yaml
script:
  save_budget_data:
    sequence:
      - service: budget_tracker.set_income
        data:
          account: default
          amount: "{{ states('input_number.income_input') | float }}"
      - service: budget_tracker.set_expenses
        data:
          account: default
          amount: "{{ states('input_number.expenses_input') | float }}"
```

## Compatibilité

- Home Assistant Core 2023.11.0 ou supérieur
- Fonctionne sur tous les types d'installations (Core, HASSOS, Docker)
- Compatible avec les installations à ressources limitées (utilise peu de CPU/mémoire)

## Contributions

Les contributions sont les bienvenues! Si vous avez des idées d'amélioration ou rencontrez des problèmes:

1. Ouvrez une issue pour discuter de vos idées
2. Faites un fork du dépôt
3. Créez une branche pour vos modifications
4. Soumettez une pull request

## Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

[releases-shield]: https://img.shields.io/github/release/MendoxIta/haos_budget.svg?style=for-the-badge
[releases]: https://github.com/MendoxIta/haos_budget/releases
[license-shield]: https://img.shields.io/github/license/MendoxIta/haos_budget.svg?style=for-the-badge
[hacs-shield]: https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge
[hacs]: https://github.com/hacs/integration
