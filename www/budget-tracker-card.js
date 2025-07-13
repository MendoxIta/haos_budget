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
  }

  set hass(hass) {
    this._hass = hass;
    this._fetchData();
    this._render();
  }

  set config(config) {
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
          <div class="account-selector">
            <select @change="${this._handleAccountChange}">
              ${this._accounts.map(acc => `
                <option value="${acc.name}" ${acc.name === this._currentAccount ? 'selected' : ''}>
                  ${acc.name.charAt(0).toUpperCase() + acc.name.slice(1)}
                </option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="card-content">
          <div class="tabs-container">
            <div class="tabs">
              <button class="${this._currentTab === 'overview' ? 'active' : ''}" @click="${() => this._handleTabChange('overview')}">Vue d'ensemble</button>
              <button class="${this._currentTab === 'income' ? 'active' : ''}" @click="${() => this._handleTabChange('income')}">Revenus</button>
              <button class="${this._currentTab === 'expenses' ? 'active' : ''}" @click="${() => this._handleTabChange('expenses')}">Dépenses</button>
              <button class="${this._currentTab === 'recurring' ? 'active' : ''}" @click="${() => this._handleTabChange('recurring')}">Récurrents</button>
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
        .account-selector {
          min-width: 120px;
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

      <div style="margin-top: 16px;">
        <button class="btn" @click="${() => this._handleTabChange('income')}">Gérer les revenus</button>
        <button class="btn" style="margin-left: 8px;" @click="${() => this._handleTabChange('expenses')}">Gérer les dépenses</button>
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

    return `
      <h3>Revenus du mois</h3>
      <div class="items-list">
        ${account.income_items.length > 0 
          ? account.income_items.map(item => `
            <div class="item">
              <div class="item-details">
                <div class="item-description">
                  ${item.description || 'Sans description'}
                  ${item.recurring_id ? '<span class="recurring-badge">Récurrent</span>' : ''}
                </div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount income">+${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small" @click="${() => this._handleEditItem('income', item.id)}">Modifier</button>
                <button class="btn btn-small btn-danger" @click="${() => this._handleRemoveItem('income', item.id)}">Supprimer</button>
              </div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucun revenu ce mois-ci</div>`
        }
      </div>
      <button class="btn" @click="${() => this._handleAddItem('income')}">Ajouter un revenu</button>
    `;
  }

  _renderExpensesTab(account) {
    if (this._isAddingItem) {
      return this._renderAddItemForm('expenses');
    }

    if (this._editingItem) {
      return this._renderEditItemForm('expenses');
    }

    return `
      <h3>Dépenses du mois</h3>
      <div class="items-list">
        ${account.expense_items.length > 0 
          ? account.expense_items.map(item => `
            <div class="item">
              <div class="item-details">
                <div class="item-description">
                  ${item.description || 'Sans description'}
                  ${item.recurring_id ? '<span class="recurring-badge">Récurrent</span>' : ''}
                </div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount expenses">-${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small" @click="${() => this._handleEditItem('expenses', item.id)}">Modifier</button>
                <button class="btn btn-small btn-danger" @click="${() => this._handleRemoveItem('expenses', item.id)}">Supprimer</button>
              </div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucune dépense ce mois-ci</div>`
        }
      </div>
      <button class="btn" @click="${() => this._handleAddItem('expenses')}">Ajouter une dépense</button>
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
            <div class="item">
              <span class="day-of-month">${item.day_of_month || 1}</span>
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount income">+${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small" @click="${() => this._handleEditRecurringItem('income', item.id)}">Modifier</button>
                <button class="btn btn-small btn-danger" @click="${() => this._handleRemoveRecurringItem('income', item.id)}">Supprimer</button>
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
            <div class="item">
              <span class="day-of-month">${item.day_of_month || 1}</span>
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount expenses">-${parseFloat(item.amount).toFixed(2)} €</div>
              <div class="item-actions">
                <button class="btn btn-small" @click="${() => this._handleEditRecurringItem('expenses', item.id)}">Modifier</button>
                <button class="btn btn-small btn-danger" @click="${() => this._handleRemoveRecurringItem('expenses', item.id)}">Supprimer</button>
              </div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucune dépense récurrente</div>`
        }
      </div>
      <button class="btn" @click="${() => this._handleAddRecurringIncome()}">Ajouter un revenu récurrent</button>
      <button class="btn" style="margin-left: 8px;" @click="${() => this._handleAddRecurringExpense()}">Ajouter une dépense récurrente</button>
    `;
  }

  _renderAddItemForm(type) {
    const title = type === 'income' ? 'Ajouter un revenu' : 'Ajouter une dépense';
    const serviceType = type === 'income' ? 'add_income_item' : 'add_expense_item';
    
    return `
      <h3>${title}</h3>
      <div class="form">
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
        <button class="btn" @click="${() => this._handleSubmitNewItem(serviceType)}">Enregistrer</button>
        <button class="btn" style="background-color: #888; margin-left: 8px;" @click="${this._handleCancelAddEdit}">Annuler</button>
      </div>
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
      <div class="form">
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
        <button class="btn" @click="${() => this._handleUpdateItem(type)}">Mettre à jour</button>
        <button class="btn" style="background-color: #888; margin-left: 8px;" @click="${this._handleCancelAddEdit}">Annuler</button>
      </div>
    `;
  }

  _renderAddRecurringForm() {
    const isIncome = this._currentTab === 'income';
    const title = isIncome ? 'Ajouter un revenu récurrent' : 'Ajouter une dépense récurrente';
    const serviceType = isIncome ? 'add_recurring_income' : 'add_recurring_expense';
    
    return `
      <h3>${title}</h3>
      <div class="form">
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
        <button class="btn" @click="${() => this._handleSubmitNewRecurringItem(serviceType)}">Enregistrer</button>
        <button class="btn" style="background-color: #888; margin-left: 8px;" @click="${this._handleCancelAddEdit}">Annuler</button>
      </div>
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
      <div class="form">
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
        <button class="btn" @click="${() => this._handleUpdateRecurringItem(isIncome ? 'income' : 'expenses')}">Mettre à jour</button>
        <button class="btn" style="background-color: #888; margin-left: 8px;" @click="${this._handleCancelAddEdit}">Annuler</button>
      </div>
    `;
  }

  _attachEventListeners() {
    // Gestion du changement de compte
    const accountSelector = this.shadowRoot.querySelector('.account-selector select');
    if (accountSelector) {
      accountSelector.addEventListener('change', this._handleAccountChange.bind(this));
    }

    // Gestion des onglets
    const tabButtons = this.shadowRoot.querySelectorAll('.tabs button');
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.textContent.toLowerCase().trim();
        this._handleTabChange(tab);
      });
    });

    // Autres boutons et formulaires
    const buttons = this.shadowRoot.querySelectorAll('button');
    buttons.forEach(button => {
      if (button.textContent === 'Ajouter un revenu') {
        button.addEventListener('click', () => this._handleAddItem('income'));
      } else if (button.textContent === 'Ajouter une dépense') {
        button.addEventListener('click', () => this._handleAddItem('expenses'));
      } else if (button.textContent === 'Ajouter un revenu récurrent') {
        button.addEventListener('click', () => this._handleAddRecurringIncome());
      } else if (button.textContent === 'Ajouter une dépense récurrente') {
        button.addEventListener('click', () => this._handleAddRecurringExpense());
      } else if (button.textContent === 'Annuler') {
        button.addEventListener('click', this._handleCancelAddEdit.bind(this));
      } else if (button.textContent === 'Enregistrer') {
        if (this._currentTab === 'recurring') {
          button.addEventListener('click', () => this._handleSubmitNewRecurringItem());
        } else {
          button.addEventListener('click', () => this._handleSubmitNewItem());
        }
      } else if (button.textContent === 'Mettre à jour') {
        if (this._currentTab === 'recurring') {
          button.addEventListener('click', () => this._handleUpdateRecurringItem());
        } else {
          button.addEventListener('click', () => this._handleUpdateItem());
        }
      }
    });

    // Boutons de modification et suppression
    const editButtons = this.shadowRoot.querySelectorAll('.btn-small');
    editButtons.forEach(button => {
      if (button.textContent === 'Modifier') {
        const itemId = button.getAttribute('data-id');
        const type = button.getAttribute('data-type');
        button.addEventListener('click', () => this._handleEditItem(type, itemId));
      } else if (button.textContent === 'Supprimer') {
        const itemId = button.getAttribute('data-id');
        const type = button.getAttribute('data-type');
        button.addEventListener('click', () => this._handleRemoveItem(type, itemId));
      }
    });
  }

  _handleAccountChange(e) {
    this._currentAccount = e.target.value;
    this._render();
  }

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
    this._currentTab = 'income';
    this._render();
  }

  _handleAddRecurringExpense() {
    this._isAddingItem = true;
    this._currentTab = 'expenses';
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

  _handleSubmitNewItem(serviceType) {
    const description = this.shadowRoot.querySelector('#description').value;
    const amount = parseFloat(this.shadowRoot.querySelector('#amount').value);
    const category = this.shadowRoot.querySelector('#category').value;

    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez saisir un montant valide.');
      return;
    }

    // Appel du service HA
    this._hass.callService('budget_tracker', serviceType, {
      account: this._currentAccount,
      amount: amount,
      description: description,
      category: category
    });

    // Réinitialiser le formulaire
    this._isAddingItem = false;
    
    // Attendre un peu pour que les données soient mises à jour dans HA
    setTimeout(() => {
      this._fetchData();
      this._render();
    }, 500);
  }

  _handleSubmitNewRecurringItem(serviceType) {
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

    // Appel du service HA
    this._hass.callService('budget_tracker', serviceType, {
      account: this._currentAccount,
      amount: amount,
      description: description,
      category: category,
      day_of_month: dayOfMonth
    });

    // Réinitialiser le formulaire
    this._isAddingItem = false;
    this._currentTab = 'recurring';
    
    // Attendre un peu pour que les données soient mises à jour dans HA
    setTimeout(() => {
      this._fetchData();
      this._render();
    }, 500);
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

    // Supprimer l'ancien élément
    this._hass.callService('budget_tracker', 'remove_item', {
      account: this._currentAccount,
      item_id: this._editingItem
    });

    // Ajouter le nouvel élément
    const serviceType = type === 'income' ? 'add_income_item' : 'add_expense_item';
    this._hass.callService('budget_tracker', serviceType, {
      account: this._currentAccount,
      amount: amount,
      description: description,
      category: category
    });

    // Réinitialiser le formulaire
    this._editingItem = null;
    
    // Attendre un peu pour que les données soient mises à jour dans HA
    setTimeout(() => {
      this._fetchData();
      this._render();
    }, 500);
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
    
    // Supprimer l'ancien élément
    this._hass.callService('budget_tracker', 'remove_recurring_item', {
      account: this._currentAccount,
      item_id: this._editingItem
    });

    // Ajouter le nouvel élément
    const serviceType = type === 'income' ? 'add_recurring_income' : 'add_recurring_expense';
    this._hass.callService('budget_tracker', serviceType, {
      account: this._currentAccount,
      amount: amount,
      description: description,
      category: category,
      day_of_month: dayOfMonth
    });

    // Réinitialiser le formulaire
    this._editingItem = null;
    this._currentTab = 'recurring';
    
    // Attendre un peu pour que les données soient mises à jour dans HA
    setTimeout(() => {
      this._fetchData();
      this._render();
    }, 500);
  }

  _handleRemoveItem(type, itemId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet élément ?')) {
      return;
    }
    
    this._hass.callService('budget_tracker', 'remove_item', {
      account: this._currentAccount,
      item_id: itemId
    });

    // Attendre un peu pour que les données soient mises à jour dans HA
    setTimeout(() => {
      this._fetchData();
      this._render();
    }, 500);
  }

  _handleRemoveRecurringItem(type, itemId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet élément récurrent ?')) {
      return;
    }
    
    this._hass.callService('budget_tracker', 'remove_recurring_item', {
      account: this._currentAccount,
      item_id: itemId
    });

    // Attendre un peu pour que les données soient mises à jour dans HA
    setTimeout(() => {
      this._fetchData();
      this._render();
    }, 500);
  }

  // Fonction utilitaire pour formater les nombres en devise
  _formatCurrency(value) {
    return parseFloat(value).toFixed(2) + ' €';
  }

  getCardSize() {
    return 3;
  }

  static getConfigElement() {
    return document.createElement('budget-tracker-card-editor');
  }

  static getStubConfig() {
    return {
      title: "Budget Tracker",
      entities: []
    };
  }
}

customElements.define('budget-tracker-card', BudgetTrackerCard);

// Enregistrer la carte pour HACS Frontend
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'budget-tracker-card',
  name: 'Budget Tracker Card',
  description: 'Carte pour gérer les comptes, revenus, dépenses et récurrences'
});
