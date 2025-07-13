# Budget Tracker pour Home Assistant

[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)
[![hacs][hacs-shield]][hacs]

Le composant **Budget Tracker** est un outil simple mais puissant pour suivre votre budget mensuel directement dans Home Assistant.

Il vous permet de saisir vos revenus et dépenses mensuelles, calcule automatiquement le solde, et sauvegarde ces données à la fin de chaque mois pour consultation ultérieure.

![Aperçu du Budget Tracker](images/overview.png)

## Caractéristiques

- 💰 Suivi des revenus, dépenses et solde du mois en cours
- 📊 Sauvegarde automatique des données à la fin de chaque mois
- 🔄 Réinitialisation automatique au 1er du mois
- 📈 Visualisation de l'historique des mois précédents
- 👥 Prise en charge de multiples comptes (personnel, professionnel, etc.)
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

Le composant fournit trois services principaux:

#### `budget_tracker.set_income`
Définit le montant des revenus pour un compte.
```yaml
service: budget_tracker.set_income
data:
  account: default  # optionnel, "default" par défaut
  amount: 2500      # montant des revenus
```

#### `budget_tracker.set_expenses`
Définit le montant des dépenses pour un compte.
```yaml
service: budget_tracker.set_expenses
data:
  account: default  # optionnel, "default" par défaut
  amount: 1800      # montant des dépenses
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

### Entités

Pour chaque compte, l'intégration crée plusieurs entités:

- `sensor.budget_tracker_<account>_income_current_month`: Revenus du mois en cours
- `sensor.budget_tracker_<account>_expenses_current_month`: Dépenses du mois en cours
- `sensor.budget_tracker_<account>_balance_current_month`: Solde du mois en cours

Pour les données historiques:
- `sensor.budget_tracker_<account>_income_<année>_<mois>`
- `sensor.budget_tracker_<account>_expenses_<année>_<mois>`
- `sensor.budget_tracker_<account>_balance_<année>_<mois>`

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
