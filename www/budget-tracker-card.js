/**
 * Budget Tracker Card
 * 
 * Une carte personnalisée pour gérer les comptes, revenus, dépenses et récurrences
 * dans Home Assistant.
 * 
 * @version 1.0.0
 * @author MendoxIta
 */

class BudgetTrackerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._accounts = [];
    this._currentAccount = null;
    this._currentTab = 'overview';
    this._editingItem = null;
    this._isAddingItem = false;
    this._recurringType = 'income'; // Pour différencier le type lors d'ajout/édition d'élément récurrent
    this._entityListeners = new Map();
    this._boundHandleEvent = this._handleEvent.bind(this);
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    
    // Si premier appel ou changement de hass, s'abonner aux événements
    if (!oldHass || oldHass.connection !== hass.connection) {
      this._unsubscribeEvents();
      this._subscribeEvents();
    }
    
    // Ne refetch que si les données des entités ont changé
    let shouldUpdate = false;
    if (this._config && this._config.entities) {
      for (const entityId of this._config.entities) {
        if (!oldHass || !oldHass.states[entityId] || 
            oldHass.states[entityId] !== hass.states[entityId]) {
          shouldUpdate = true;
          break;
        }
      }
    }
    
    if (shouldUpdate) {
      this._fetchData();
      this._render();
    }
  }

  setConfig(config) {
    if (!config.entities) {
      throw new Error("Vous devez définir au moins une entité de type 'budget_tracker'.");
    }
    this._config = config;
    this._configureCard();
  }

  _configureCard() {
    if (this._config.title === undefined) {
      this._config.title = "Budget Tracker";
    }
  }

  _fetchData() {
    if (!this._hass || !this._config.entities) return;

    // Récupérer toutes les entités budget_tracker
    const entities = {};
    const accounts = new Set();
    const incomeSensors = [];
    const expenseSensors = [];
    const balanceSensors = [];

    this._config.entities.forEach(entityId => {
      const entity = this._hass.states[entityId];
      if (!entity) return;

      if (entityId.includes('income_current_month')) {
        incomeSensors.push(entity);
        // Extraire le nom du compte
        const match = entityId.match(/budget_tracker_(.+?)_income_current_month/);
        if (match && match[1]) {
          accounts.add(match[1]);
        }
      } else if (entityId.includes('expenses_current_month')) {
        expenseSensors.push(entity);
      } else if (entityId.includes('balance_current_month')) {
        balanceSensors.push(entity);
      }
    });

    // Organiser par compte
    this._accounts = Array.from(accounts).map(account => {
      const incomeSensor = incomeSensors.find(s => s.entity_id.includes(`budget_tracker_${account}_income_current_month`));
      const expenseSensor = expenseSensors.find(s => s.entity_id.includes(`budget_tracker_${account}_expenses_current_month`));
      const balanceSensor = balanceSensors.find(s => s.entity_id.includes(`budget_tracker_${account}_balance_current_month`));

      return {
        name: account,
        income: incomeSensor ? incomeSensor.state : 0,
        expenses: expenseSensor ? expenseSensor.state : 0,
        balance: balanceSensor ? balanceSensor.state : 0,
        income_items: incomeSensor && incomeSensor.attributes.items ? incomeSensor.attributes.items : [],
        expense_items: expenseSensor && expenseSensor.attributes.items ? expenseSensor.attributes.items : [],
        recurring_income: incomeSensor && incomeSensor.attributes.recurring_items ? incomeSensor.attributes.recurring_items : [],
        recurring_expenses: expenseSensor && expenseSensor.attributes.recurring_items ? expenseSensor.attributes.recurring_items : [],
        entities: {
          income: incomeSensor ? incomeSensor.entity_id : null,
          expenses: expenseSensor ? expenseSensor.entity_id : null,
          balance: balanceSensor ? balanceSensor.entity_id : null,
        }
      };
    });

    // Définir le compte par défaut si aucun n'est sélectionné
    if (!this._currentAccount && this._accounts.length > 0) {
      this._currentAccount = this._accounts[0].name;
    }
  }

  _render() {
    if (!this._hass || !this._accounts.length) {
      this.shadowRoot.innerHTML = `
        <ha-card header="Budget Tracker">
          <div class="card-content">
            <p>Aucun compte trouvé. Assurez-vous d'avoir configuré au moins un compte dans l'intégration Budget Tracker.</p>
          </div>
        </ha-card>
      `;
      return;
    }

    // Obtenir le compte actuel
    const account = this._accounts.find(acc => acc.name === this._currentAccount);
    if (!account) {
      this._currentAccount = this._accounts[0].name;
      this._render();
      return;
    }

    // Construire l'interface
    let content = '';
    
    switch (this._currentTab) {
      case 'overview':
        content = this._renderOverview(account);
        break;
      case 'income':
        content = this._renderIncomeTab(account);
        break;
      case 'expenses':
        content = this._renderExpensesTab(account);
        break;
      case 'recurring':
        content = this._renderRecurringTab(account);
        break;
      default:
        content = this._renderOverview(account);
    }

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="card-header">
          <div class="title">${this._config.title}</div>
          <div class="header-actions">
            <div class="account-selector">
              <select>
                ${this._accounts.map(acc => `
                  <option value="${acc.name}" ${acc.name === this._currentAccount ? 'selected' : ''}>
                    ${acc.name.charAt(0).toUpperCase() + acc.name.slice(1)}
                  </option>
                `).join('')}
              </select>
            </div>
            <button class="refresh-button" title="Rafraîchir les données">
              <ha-icon icon="mdi:refresh"></ha-icon>
            </button>
          </div>
        </div>
        <div class="card-content">
          <div class="tabs-container">
            <div class="tabs">
              <button class="${this._currentTab === 'overview' ? 'active' : ''}">Vue d'ensemble</button>
              <button class="${this._currentTab === 'income' ? 'active' : ''}">Revenus</button>
              <button class="${this._currentTab === 'expenses' ? 'active' : ''}">Dépenses</button>
              <button class="${this._currentTab === 'recurring' ? 'active' : ''}">Récurrents</button>
            </div>
          </div>
          ${content}
        </div>
      </ha-card>
      <style>
        ha-card {
          padding: 16px;
          margin-top: 16px;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .title {
          font-size: 1.5em;
          font-weight: 500;
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .account-selector {
          min-width: 120px;
        }
        .refresh-button {
          background: transparent;
          border: none;
          color: var(--primary-text-color);
          cursor: pointer;
          padding: 4px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .refresh-button:hover {
          background: var(--secondary-background-color);
        }
        .loading {
          position: relative;
        }
        .loading::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(var(--rgb-primary-background-color, 255, 255, 255), 0.5);
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .loading::before {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 30px;
          height: 30px;
          border: 3px solid var(--primary-color);
          border-radius: 50%;
          border-top-color: transparent;
          animation: spin 1s linear infinite;
          z-index: 2;
        }
        @keyframes spin {
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
        .tabs-container {
          margin-bottom: 16px;
        }
        .tabs {
          display: flex;
          overflow-x: auto;
          border-bottom: 1px solid var(--divider-color);
        }
        .tabs button {
          background: transparent;
          border: none;
          padding: 8px 16px;
          cursor: pointer;
          font-size: 1em;
          position: relative;
          color: var(--primary-text-color);
        }
        .tabs button.active {
          color: var(--primary-color);
          font-weight: 500;
        }
        .tabs button.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 2px;
          background-color: var(--primary-color);
        }
        .summary-boxes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-gap: 16px;
          margin-bottom: 24px;
        }
        .summary-box {
          padding: 16px;
          border-radius: 8px;
          text-align: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .summary-box.income {
          background-color: rgba(76, 175, 80, 0.1);
        }
        .summary-box.expenses {
          background-color: rgba(244, 67, 54, 0.1);
        }
        .summary-box.balance {
          background-color: rgba(33, 150, 243, 0.1);
        }
        .summary-box .label {
          font-size: 0.9em;
          opacity: 0.8;
          margin-bottom: 8px;
        }
        .summary-box .amount {
          font-size: 1.4em;
          font-weight: bold;
        }
        .summary-box .amount.positive {
          color: #4CAF50;
        }
        .summary-box .amount.negative {
          color: #F44336;
        }
        .items-list {
          margin-top: 16px;
        }
        .item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid var(--divider-color);
        }
        .item-details {
          flex-grow: 1;
        }
        .item-description {
          font-weight: 500;
        }
        .item-category {
          font-size: 0.9em;
          opacity: 0.7;
        }
        .item-amount {
          font-weight: 500;
          margin-right: 16px;
        }
        .item-amount.income {
          color: #4CAF50;
        }
        .item-amount.expenses {
          color: #F44336;
        }
        .item-actions {
          display: flex;
        }
        .btn {
          background-color: var(--primary-color);
          color: white;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          cursor: pointer;
          font-size: 0.9em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-top: 16px;
        }
        .btn-danger {
          background-color: #F44336;
        }
        .btn-small {
          padding: 4px 8px;
          font-size: 0.8em;
          margin-left: 8px;
        }
        .form-group {
          margin-bottom: 16px;
        }
        label {
          display: block;
          margin-bottom: 8px;
        }
        input, select, textarea {
          width: 100%;
          padding: 8px;
          box-sizing: border-box;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-gap: 16px;
        }
        .empty-state {
          text-align: center;
          padding: 32px 16px;
          opacity: 0.7;
        }
        .recurring-badge {
          background-color: var(--primary-color);
          color: white;
          font-size: 0.7em;
          padding: 2px 6px;
          border-radius: 4px;
          margin-left: 8px;
          vertical-align: middle;
        }
        .day-of-month {
          display: inline-block;
          background-color: rgba(0,0,0,0.1);
          border-radius: 50%;
          width: 24px;
          height: 24px;
          line-height: 24px;
          text-align: center;
          font-size: 0.8em;
          margin-right: 8px;
        }
        @media (max-width: 600px) {
          .summary-boxes {
            grid-template-columns: 1fr;
          }
          .form-row {
            grid-template-columns: 1fr;
          }
        }

        .confirmation-dialog {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .dialog-content {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          text-align: center;
          color: #000000ff;
        }

        .dialog-actions {
          margin-top: 20px;
          display: flex;
          justify-content: space-around;
        }

        .dialog-actions .btn {
          padding: 10px 20px;
          font-size: 1em;
          cursor: pointer;
        }

        .dialog-actions .btn-danger {
          background-color: #F44336;
          color: white;
          border: none;
          border-radius: 4px;
        }

        .dialog-actions .btn.cancel {
          background-color: #888;
          color: white;
          border: none;
          border-radius: 4px;
        }

        .loading {
          opacity: 0.5;
          pointer-events: none;
        }
      </style>
    `;
    
    // Attacher les événements
    this._attachEventListeners();
  }

  _renderOverview(account) {
    return `
      <div class="summary-boxes">
        <div class="summary-box income">
          <div class="label">Revenus</div>
          <div class="amount positive">${parseFloat(account.income).toFixed(2)} €</div>
        </div>
        <div class="summary-box expenses">
          <div class="label">Dépenses</div>
          <div class="amount negative">${parseFloat(account.expenses).toFixed(2)} €</div>
        </div>
        <div class="summary-box balance">
          <div class="label">Solde</div>
          <div class="amount ${parseFloat(account.balance) >= 0 ? 'positive' : 'negative'}">${parseFloat(account.balance).toFixed(2)} €</div>
        </div>
      </div>

      <h3>Revenus récents</h3>
      <div class="items-list">
        ${account.income_items.length > 0 
          ? account.income_items.slice(0, 3).map(item => `
            <div class="item">
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount income">+${parseFloat(item.amount).toFixed(2)} €</div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucun revenu ce mois-ci</div>`
        }
      </div>

      <h3>Dépenses récentes</h3>
      <div class="items-list">
        ${account.expense_items.length > 0 
          ? account.expense_items.slice(0, 3).map(item => `
            <div class="item">
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount expenses">-${parseFloat(item.amount).toFixed(2)} €</div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucune dépense ce mois-ci</div>`
        }
      </div>
    `;
  }

  _renderIncomeTab(account) {
    if (this._isAddingItem) {
      return this._renderAddItemForm('income');
    }

    if (this._editingItem) {
      return this._renderEditItemForm('income');
    }

    const incomeCount = account.income_items.length;
    return `
      <h3>Revenus du mois (${incomeCount})</h3>
      <div class="items-list">
        ${incomeCount > 0 
          ? account.income_items.map(item => `
            <div class="item" data-id="${item.id}">
              <div class="item-details">
                <div class="item-description">
                  ${item.description || 'Sans description'}
                  ${item.recurring_id ? '<span class="recurring-badge">Récurrent</span>' : ''}
                </div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount income">+${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small">Modifier</button>
                <button class="btn btn-small btn-danger">Supprimer</button>
              </div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucun revenu ce mois-ci</div>`
        }
      </div>
      <button class="btn">Ajouter un revenu</button>
      <button class="btn btn-danger" id="delete-all-income" style="margin-left: 8px;">Tout supprimer</button>
    `;
  }

  _renderExpensesTab(account) {
    if (this._isAddingItem) {
      return this._renderAddItemForm('expenses');
    }

    if (this._editingItem) {
      return this._renderEditItemForm('expenses');
    }

    const expenseCount = account.expense_items.length;
    return `
      <h3>Dépenses du mois (${expenseCount})</h3>
      <div class="items-list">
        ${expenseCount > 0 
          ? account.expense_items.map(item => `
            <div class="item" data-id="${item.id}">
              <div class="item-details">
                <div class="item-description">
                  ${item.description || 'Sans description'}
                  ${item.recurring_id ? '<span class="recurring-badge">Récurrent</span>' : ''}
                </div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount expenses">-${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small">Modifier</button>
                <button class="btn btn-small btn-danger">Supprimer</button>
              </div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucune dépense ce mois-ci</div>`
        }
      </div>
      <button class="btn">Ajouter une dépense</button>
      <button class="btn btn-danger" id="delete-all-expenses" style="margin-left: 8px;">Tout supprimer</button>
    `;
  }

  _renderRecurringTab(account) {
    if (this._isAddingItem) {
      return this._renderAddRecurringForm();
    }

    if (this._editingItem) {
      return this._renderEditRecurringForm();
    }

    return `
      <h3>Revenus récurrents</h3>
      <div class="items-list">
        ${account.recurring_income.length > 0 
          ? account.recurring_income.map(item => `
            <div class="item" data-id="${item.id}">
              <span class="day-of-month">${item.day_of_month || 1}</span>
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount income">+${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small recurring">Modifier</button>
                <button class="btn btn-small btn-danger recurring">Supprimer</button>
              </div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucun revenu récurrent</div>`
        }
      </div>

      <h3>Dépenses récurrentes</h3>
      <div class="items-list">
        ${account.recurring_expenses.length > 0 
          ? account.recurring_expenses.map(item => `
            <div class="item" data-id="${item.id}">
              <span class="day-of-month">${item.day_of_month || 1}</span>
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount expenses">-${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small recurring">Modifier</button>
                <button class="btn btn-small btn-danger recurring">Supprimer</button>
              </div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucune dépense récurrente</div>`
        }
      </div>
      <button class="btn">Ajouter un revenu récurrent</button>
      <button class="btn" style="margin-left: 8px;">Ajouter une dépense récurrente</button>
    `;
  }

  _renderAddItemForm(type) {
    const title = type === 'income' ? 'Ajouter un revenu' : 'Ajouter une dépense';
    
    return `
      <h3>${title}</h3>
      <form class="form" onsubmit="return false;">
        <div class="form-group">
          <label for="description">Description</label>
          <input type="text" id="description" placeholder="Description" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="amount">Montant (€)</label>
            <input type="number" id="amount" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label for="category">Catégorie</label>
            <input type="text" id="category" placeholder="Catégorie (optionnel)" />
          </div>
        </div>
        <button type="button" class="btn save-btn">Enregistrer</button>
        <button type="button" class="btn" style="background-color: #888; margin-left: 8px;">Annuler</button>
      </form>
    `;
  }

  _renderEditItemForm(type) {
    const title = type === 'income' ? 'Modifier un revenu' : 'Modifier une dépense';
    const item = type === 'income' 
      ? this._accounts.find(acc => acc.name === this._currentAccount).income_items.find(i => i.id === this._editingItem)
      : this._accounts.find(acc => acc.name === this._currentAccount).expense_items.find(i => i.id === this._editingItem);
    
    if (!item) {
      this._editingItem = null;
      this._render();
      return;
    }

    return `
      <h3>${title}</h3>
      <form class="form" onsubmit="return false;">
        <div class="form-group">
          <label for="description">Description</label>
          <input type="text" id="description" placeholder="Description" value="${item.description || ''}" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="amount">Montant (€)</label>
            <input type="number" id="amount" min="0" step="0.01" placeholder="0.00" value="${item.amount}" />
          </div>
          <div class="form-group">
            <label for="category">Catégorie</label>
            <input type="text" id="category" placeholder="Catégorie (optionnel)" value="${item.category || ''}" />
          </div>
        </div>
        <button type="button" class="btn update-btn">Mettre à jour</button>
        <button type="button" class="btn" style="background-color: #888; margin-left: 8px;">Annuler</button>
      </form>
    `;
  }

  _renderAddRecurringForm() {
    const isIncome = this._currentTab === 'income';
    const title = isIncome ? 'Ajouter un revenu récurrent' : 'Ajouter une dépense récurrente';
    
    return `
      <h3>${title}</h3>
      <form class="form" onsubmit="return false;">
        <div class="form-group">
          <label for="description">Description</label>
          <input type="text" id="description" placeholder="Description" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="amount">Montant (€)</label>
            <input type="number" id="amount" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label for="category">Catégorie</label>
            <input type="text" id="category" placeholder="Catégorie (optionnel)" />
          </div>
        </div>
        <div class="form-group">
          <label for="day_of_month">Jour du mois</label>
          <input type="number" id="day_of_month" min="1" max="31" value="1" />
        </div>
        <button type="button" class="btn save-btn">Enregistrer</button>
        <button type="button" class="btn" style="background-color: #888; margin-left: 8px;">Annuler</button>
      </form>
    `;
  }

  _renderEditRecurringForm() {
    const type = this._currentTab;
    const isIncome = type === 'income';
    const title = isIncome ? 'Modifier un revenu récurrent' : 'Modifier une dépense récurrente';
    const items = isIncome 
      ? this._accounts.find(acc => acc.name === this._currentAccount).recurring_income
      : this._accounts.find(acc => acc.name === this._currentAccount).recurring_expenses;
    
    const item = items.find(i => i.id === this._editingItem);
    
    if (!item) {
      this._editingItem = null;
      this._render();
      return;
    }

    return `
      <h3>${title}</h3>
      <form class="form" onsubmit="return false;">
        <div class="form-group">
          <label for="description">Description</label>
          <input type="text" id="description" placeholder="Description" value="${item.description || ''}" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="amount">Montant (€)</label>
            <input type="number" id="amount" min="0" step="0.01" placeholder="0.00" value="${item.amount}" />
          </div>
          <div class="form-group">
            <label for="category">Catégorie</label>
            <input type="text" id="category" placeholder="Catégorie (optionnel)" value="${item.category || ''}" />
          </div>
        </div>
        <div class="form-group">
          <label for="day_of_month">Jour du mois</label>
          <input type="number" id="day_of_month" min="1" max="31" value="${item.day_of_month || 1}" />
        </div>
        <button type="button" class="btn update-btn">Mettre à jour</button>
        <button type="button" class="btn" style="background-color: #888; margin-left: 8px;">Annuler</button>
      </form>
    `;
  }

  _renderSensorsList() {
    return this._config.entities.map((entity, index) => `
      <div class="sensor-item">
        <span>${entity}</span>
        <button class="btn btn-small btn-danger" @click="${() => this._handleRemoveSensor(index)}">Supprimer</button>
      </div>
    `).join('');
  }

  _handleRemoveSensor(index) {
    this._config.entities.splice(index, 1);
    this._render();
  }

  _showConfirmationDialog(message, onConfirm) {
    // Créer une boîte de dialogue personnalisée
    const dialog = document.createElement('div');
    dialog.classList.add('confirmation-dialog');
    dialog.innerHTML = `
      <div class="dialog-content">
        <p>${message}</p>
        <div class="dialog-actions">
          <button class="btn btn-danger confirm">Confirmer</button>
          <button class="btn cancel">Annuler</button>
        </div>
      </div>
    `;

    // Ajouter des gestionnaires d'événements
    dialog.querySelector('.confirm').addEventListener('click', () => {
      onConfirm();
      dialog.remove();
    });

    dialog.querySelector('.cancel').addEventListener('click', () => {
      dialog.remove();
    });

    // Ajouter la boîte de dialogue au shadowRoot
    this.shadowRoot.appendChild(dialog);
  }

  _attachEventListeners() {
    // Gestion des onglets
    const tabButtons = this.shadowRoot.querySelectorAll('.tabs button');
    tabButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        const tabs = ['overview', 'income', 'expenses', 'recurring'];
        this._handleTabChange(tabs[index]);
      });
    });

    // Gestion du sélecteur de compte
    const accountSelector = this.shadowRoot.querySelector('.account-selector select');
    if (accountSelector) {
      accountSelector.addEventListener('change', (event) => {
        this._currentAccount = event.target.value;
        this._render();
      });
    }
    
    // Gestion du bouton de rafraîchissement
    const refreshButton = this.shadowRoot.querySelector('.refresh-button');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => {
        this._refreshData();
      });
    }

    // Gestion du bouton 'Tout supprimer' revenus
    const deleteAllIncomeBtn = this.shadowRoot.querySelector('#delete-all-income');
    if (deleteAllIncomeBtn) {
      deleteAllIncomeBtn.addEventListener('click', () => {
        this._deleteAllItems('income');
      });
    }
    // Gestion du bouton 'Tout supprimer' dépenses
    const deleteAllExpensesBtn = this.shadowRoot.querySelector('#delete-all-expenses');
    if (deleteAllExpensesBtn) {
      deleteAllExpensesBtn.addEventListener('click', () => {
        this._deleteAllItems('expenses');
      });
    }

    this.shadowRoot.addEventListener('click', (e) => {
      const target = e.target;
      
      // Gestion des boutons d'ajout
      if (target.textContent === 'Ajouter un revenu') {
        this._handleAddItem('income');
        return;
      }
      
      if (target.textContent === 'Ajouter une dépense') {
        this._handleAddItem('expenses');
        return;
      }
      
      if (target.textContent === 'Ajouter un revenu récurrent') {
        this._handleAddRecurringIncome();
        return;
      }
      
      if (target.textContent === 'Ajouter une dépense récurrente') {
        this._handleAddRecurringExpense();
        return;
      }
      
      // Gestion des boutons d'annulation
      if (target.textContent === 'Annuler') {
        this._handleCancelAddEdit();
        return;
      }
      
      // Gestion des boutons d'enregistrement
      if (target.textContent === 'Enregistrer' || target.classList.contains('save-btn')) {
        if (this._currentTab === 'recurring') {
          if (this._recurringType === 'income') {
            this._handleSubmitNewRecurringItem();
          } else {
            this._handleSubmitNewRecurringItem();
          }
        } else if (this._currentTab === 'income') {
          this._handleSubmitNewItem();
        } else {
          this._handleSubmitNewItem();
        }
        return;
      }
      
      // Gestion des boutons de mise à jour
      if (target.textContent === 'Mettre à jour' || target.classList.contains('update-btn')) {
        if (this._currentTab === 'recurring') {
          this._handleUpdateRecurringItem(this._recurringType);
        } else {
          this._handleUpdateItem(this._currentTab);
        }
        return;
      }
      
      // Gestion des boutons modifier/supprimer
      if (target.classList.contains('btn-small')) {
        const itemRow = target.closest('.item');
        let itemId;
        
        // Trouver l'ID de l'élément via l'attribut data-id
        if (itemRow) {
          itemId = itemRow.dataset.id;
        }
        
        if (target.textContent === 'Modifier') {
          if (target.classList.contains('recurring')) {
            this._handleEditRecurringItem(this._currentTab, itemId);
          } else {
            this._handleEditItem(this._currentTab, itemId);
          }
        } else if (target.textContent === 'Supprimer') {
          if (target.classList.contains('recurring')) {
            this._handleRemoveRecurringItem(this._currentTab, itemId);
          } else {
            this._handleRemoveItem(this._currentTab, itemId);
          }
        }
        return;
      }
      
      // Gestion des boutons de gestion des revenus/dépenses sur la vue d'ensemble
      if (target.textContent === 'Gérer les revenus') {
        this._handleTabChange('income');
        return;
      }
      
      if (target.textContent === 'Gérer les dépenses') {
        this._handleTabChange('expenses');
        return;
      }
    });
  }

  // La méthode _handleAccountChange a été intégrée directement dans _attachEventListeners

  _handleTabChange(tab) {
    this._currentTab = tab;
    this._isAddingItem = false;
    this._editingItem = null;
    this._render();
  }

  _handleAddItem(type) {
    this._isAddingItem = true;
    this._currentTab = type;
    this._render();
  }

  _handleAddRecurringIncome() {
    this._isAddingItem = true;
    this._currentTab = 'recurring';
    this._recurringType = 'income';
    this._render();
  }

  _handleAddRecurringExpense() {
    this._isAddingItem = true;
    this._currentTab = 'recurring';
    this._recurringType = 'expenses';
    this._render();
  }

  _handleEditItem(type, itemId) {
    this._editingItem = itemId;
    this._currentTab = type;
    this._render();
  }

  _handleEditRecurringItem(type, itemId) {
    this._editingItem = itemId;
    this._currentTab = type;
    this._render();
  }

  _handleCancelAddEdit() {
    this._isAddingItem = false;
    this._editingItem = null;
    this._render();
  }

  _handleSubmitNewItem() {
    const description = this.shadowRoot.querySelector('#description').value;
    const amount = parseFloat(this.shadowRoot.querySelector('#amount').value);
    const category = this.shadowRoot.querySelector('#category').value;

    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez saisir un montant valide.');
      return;
    }

    // Déterminer le service à appeler en fonction de l'onglet courant
    const serviceType = this._currentTab === 'income' ? 'add_income_item' : 'add_expense_item';

    // Appel du service HA
    this._hass.callService('budget_tracker', serviceType, {
      account: this._currentAccount,
      amount: amount,
      description: description,
      category: category
    }).then(() => {
      // Réinitialiser le formulaire uniquement après la mise à jour réussie
      this._isAddingItem = false;

      // Attendre un peu pour que les données soient mises à jour dans HA
      setTimeout(() => {
        this._fetchData();
        this._render();
      }, 500);
    }).catch((error) => {
      console.error('Erreur lors de l’ajout de l’élément :', error);
      alert('Une erreur est survenue lors de l’ajout de l’élément.');
    });
  }

  _handleSubmitNewRecurringItem() {
    const description = this.shadowRoot.querySelector('#description').value;
    const amount = parseFloat(this.shadowRoot.querySelector('#amount').value);
    const category = this.shadowRoot.querySelector('#category').value;
    const dayOfMonth = parseInt(this.shadowRoot.querySelector('#day_of_month').value, 10) || 1;

    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez saisir un montant valide.');
      return;
    }

    if (dayOfMonth < 1 || dayOfMonth > 31) {
      alert('Le jour du mois doit être compris entre 1 et 31.');
      return;
    }

    // Déterminer le service à appeler en fonction du type
    const serviceType = this._recurringType === 'income' ? 'add_recurring_income' : 'add_recurring_expense';

    // Appel du service HA
    this._hass.callService('budget_tracker', serviceType, {
      account: this._currentAccount,
      amount: amount,
      description: description,
      category: category,
      day_of_month: dayOfMonth
    }).then(() => {
      // Réinitialiser le formulaire uniquement après la mise à jour réussie
      this._isAddingItem = false;
      this._currentTab = 'recurring';
      
      // Attendre un peu pour que les données soient mises à jour dans HA
      setTimeout(() => {
        this._fetchData();
        this._render();
      }, 500);
    }).catch((error) => {
      console.error('Erreur lors de l\'ajout de l\'élément récurrent :', error);
      alert('Une erreur est survenue lors de l\'ajout de l\'élément récurrent.');
    });
  }

  _handleUpdateItem(type) {
    const description = this.shadowRoot.querySelector('#description').value;
    const amount = parseFloat(this.shadowRoot.querySelector('#amount').value);
    const category = this.shadowRoot.querySelector('#category').value;

    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez saisir un montant valide.');
      return;
    }

    // Pour mettre à jour un élément, nous devons d'abord le supprimer puis en ajouter un nouveau
    // car l'API de budget_tracker ne fournit pas de service de mise à jour directe
    const itemId = this._editingItem;

    // Séquence d'appels asynchrones pour éviter les problèmes
    this._hass.callService('budget_tracker', 'remove_item', {
      account: this._currentAccount,
      item_id: itemId
    }).then(() => {
      // Une fois la suppression réussie, ajouter le nouvel élément
      const serviceType = type === 'income' ? 'add_income_item' : 'add_expense_item';
      return this._hass.callService('budget_tracker', serviceType, {
        account: this._currentAccount,
        amount: amount,
        description: description,
        category: category
      });
    }).then(() => {
      // Réinitialiser le formulaire uniquement après la mise à jour réussie
      this._editingItem = null;
      
      // Attendre un peu pour que les données soient mises à jour dans HA
      setTimeout(() => {
        this._fetchData();
        this._render();
      }, 500);
    }).catch((error) => {
      console.error('Erreur lors de la mise à jour de l\'élément:', error);
      alert('Une erreur est survenue lors de la mise à jour de l\'élément.');
    });
  }

  _handleUpdateRecurringItem(type) {
    const description = this.shadowRoot.querySelector('#description').value;
    const amount = parseFloat(this.shadowRoot.querySelector('#amount').value);
    const category = this.shadowRoot.querySelector('#category').value;
    const dayOfMonth = parseInt(this.shadowRoot.querySelector('#day_of_month').value, 10) || 1;

    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez saisir un montant valide.');
      return;
    }

    if (dayOfMonth < 1 || dayOfMonth > 31) {
      alert('Le jour du mois doit être compris entre 1 et 31.');
      return;
    }

    // Pour mettre à jour un élément récurrent, nous devons d'abord le supprimer puis en ajouter un nouveau
    const itemId = this._editingItem;
    
    // Séquence d'appels asynchrones pour éviter les problèmes
    this._hass.callService('budget_tracker', 'remove_recurring_item', {
      account: this._currentAccount,
      item_id: itemId
    }).then(() => {
      // Une fois la suppression réussie, ajouter le nouvel élément
      const serviceType = type === 'income' ? 'add_recurring_income' : 'add_recurring_expense';
      return this._hass.callService('budget_tracker', serviceType, {
        account: this._currentAccount,
        amount: amount,
        description: description,
        category: category,
        day_of_month: dayOfMonth
      });
    }).then(() => {
      // Réinitialiser le formulaire uniquement après la mise à jour réussie
      this._editingItem = null;
      this._currentTab = 'recurring';
      
      // Attendre un peu pour que les données soient mises à jour dans HA
      setTimeout(() => {
        this._fetchData();
        this._render();
      }, 500);
    }).catch((error) => {
      console.error('Erreur lors de la mise à jour de l\'élément récurrent:', error);
      alert('Une erreur est survenue lors de la mise à jour de l\'élément récurrent.');
    });
  }

  _handleRemoveItem(type, itemId) {
    this._showConfirmationDialog('Êtes-vous sûr de vouloir supprimer cet élément ?', () => {
      this._hass.callService('budget_tracker', 'remove_item', {
        account: this._currentAccount,
        item_id: itemId
      }).then(() => {
        console.log('Élément supprimé avec succès');
        setTimeout(() => {
          this._fetchData();
          this._render();
        }, 500);
      }).catch((error) => {
        console.error('Erreur lors de la suppression de l\'élément:', error);
        alert('Une erreur est survenue lors de la suppression de l\'élément.');
      });
    });
  }

  _handleRemoveRecurringItem(type, itemId) {
    this._showConfirmationDialog('Êtes-vous sûr de vouloir supprimer cet élément récurrent ?', () => {
      this._hass.callService('budget_tracker', 'remove_recurring_item', {
        account: this._currentAccount,
        item_id: itemId
      }).then(() => {
        console.log('Élément supprimé avec succès');
        setTimeout(() => {
          this._fetchData();
          this._render();
        }, 500);  
      }).catch((error) => {
        console.error('Erreur lors de la suppression de l\'élément:', error);
        alert('Une erreur est survenue lors de la suppression de l\'élément.');
      });
    });
  }

  _deleteAllItems(type) {
    const account = this._accounts.find(acc => acc.name === this._currentAccount);
    const items = type === 'income' ? account.income_items : account.expense_items;
    if (!items.length) return;
    this._showConfirmationDialog(
      `Êtes-vous sûr de vouloir supprimer toutes les ${type === 'income' ? 'revenus' : 'dépenses'} du mois ?`,
      () => {
        // Appel du service pour chaque item
        items.forEach(item => {
          this._hass.callService('budget_tracker', 'remove_item', {
            account: this._currentAccount,
            item_id: item.id
          });
        });
        setTimeout(() => {
          this._fetchData();
          this._render();
        }, 700);
      }
    );
  }

  // Fonction utilitaire pour formater les nombres en devise
  _formatCurrency(value) {
    return parseFloat(value).toFixed(2) + ' €';
  }

  getCardSize() {
    return 3;
  }

  static getStubConfig() {
    return {
      title: "Budget Tracker",
      entities: []
    };
  }

  connectedCallback() {
    // S'abonner aux événements quand la carte est connectée au DOM
    if (this._hass) {
      this._subscribeEvents();
    }
  }

  disconnectedCallback() {
    // Se désabonner des événements quand la carte est déconnectée
    this._unsubscribeEvents();
  }

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

    // Abonnement aux changements d'état des entités
    this._subscribeEntityChanges();
  }

  _unsubscribeEvents() {
    // Nettoyage des abonnements aux événements
    if (this._hass) {
      this._hass.connection.removeEventListener(
        'budget_tracker_month_changed',
        this._boundHandleEvent
      );
      this._hass.connection.removeEventListener(
        'budget_tracker_data_updated',
        this._boundHandleEvent
      );
    }

    // Désabonnement des entités
    this._entityListeners.forEach((unsub) => {
      if (typeof unsub === 'function') {
        unsub();
      }
    });
    this._entityListeners.clear();
  }

  _handleEvent(event) {
    // Traiter les événements personnalisés
    if (event.type === 'budget_tracker_data_updated' || 
        event.type === 'budget_tracker_month_changed') {
      console.log(`Budget Tracker event received: ${event.type}`, event.data);
      this._fetchData();
      this._render();
    }
  }

  _subscribeEntityChanges() {
    // Se désabonner d'abord pour éviter les doublons
    this._entityListeners.forEach((unsub) => {
      if (typeof unsub === 'function') {
        unsub();
      }
    });
    this._entityListeners.clear();

    // S'abonner aux changements d'état des entités pertinentes
    if (this._config.entities) {
      this._config.entities.forEach((entityId) => {
        // Abonnement via la nouvelle API de Home Assistant
        if (this._hass.connection && this._hass.connection.subscribeMessage) {
          const unsub = this._hass.connection.subscribeMessage(
            (message) => {
              // Si l'état de l'entité a changé, rafraîchir les données
              if (message.data && message.data.entity_id === entityId) {
                console.log(`Entity state changed: ${entityId}`);
                this._fetchData();
                this._render();
              }
            },
            { type: 'subscribe_entities', entity_ids: [entityId] }
          );
          this._entityListeners.set(entityId, unsub);
        }
      });
    }
  }

  _setLoadingState(isLoading) {
    // Ajouter/supprimer une classe de chargement sur la carte
    const card = this.shadowRoot.querySelector('ha-card');
    if (card) {
      if (isLoading) {
        card.classList.add('loading');
      } else {
        card.classList.remove('loading');
      }
    }
  }

  _refreshData() {
    this._setLoadingState(true);
    this._fetchData();
    this._render();
    setTimeout(() => {
      this._setLoadingState(false);
    }, 300);
  }
}

// Enregistrement du composant personnalisé
customElements.define('budget-tracker-card', BudgetTrackerCard);

// Indication à Home Assistant que la carte est disponible
window.customCards = window.customCards || [];
window.customCards.push({
  type: "budget-tracker-card",
  name: "Budget Tracker Card",
  description: "Carte personnalisée pour gérer le budget",
  preview: false
});