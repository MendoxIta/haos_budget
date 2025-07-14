# Budget Tracker Real-Time Integration

Ce fichier contient des informations sur l'intégration en temps réel entre la carte personnalisée Budget Tracker et le composant backend.

## Mises à jour en temps réel

Pour améliorer l'intégration en temps réel, nous avons mis en place un système d'événements qui permet au frontend (la carte) de se tenir à jour avec les modifications effectuées via les services.

### Comment cela fonctionne

1. Le backend (Python) émet des événements spécifiques lorsque des données sont modifiées
2. La carte s'abonne à ces événements et rafraîchit les données automatiquement
3. Un bouton de rafraîchissement manuel a été ajouté pour forcer une mise à jour

### Implémentation dans le frontend (budget-tracker-card.js)

La carte s'abonne à deux types d'événements :
- `budget_tracker_data_updated` : émis lorsque des données sont modifiées (ajout/suppression d'éléments, etc.)
- `budget_tracker_month_changed` : émis lorsque le mois change et que les données sont archivées

### Code important à noter

Le code suivant dans la carte permet de s'abonner aux événements :

```javascript
_subscribeEvents() {
  // Abonnement aux événements de budget_tracker
  this._hass.connection.subscribeEvents(
    this._boundHandleEvent,
    'budget_tracker_month_changed'
  );
  this._hass.connection.subscribeEvents(
    this._boundHandleEvent,
    'budget_tracker_data_updated'
  );
}
```

Et la méthode `_handleEvent` traite ces événements :

```javascript
_handleEvent(event) {
  // Traiter les événements personnalisés
  if (event.type === 'budget_tracker_data_updated' || 
      event.type === 'budget_tracker_month_changed') {
    console.log(`Budget Tracker event received: ${event.type}`, event.data);
    this._fetchData();
    this._render();
  }
}
```

### Optimisations

Pour éviter les mises à jour inutiles, la carte vérifie si les données ont réellement changé avant de se rafraîchir.
