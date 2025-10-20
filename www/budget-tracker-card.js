/**
 * Budget Tracker Card
 * 
 * Une carte personnalisée pour gérer les comptes, revenus, dépenses et récurrences
 * dans Home Assistant.
 * 
 * @version 1.1.0
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
    
    // Vérifier si les entités existent avant de continuer
    const missingEntities = [];
    this._config.entities.forEach(entityId => {
      if (!this._hass.states[entityId]) {
        missingEntities.push(entityId);
      }
    });
    
    if (missingEntities.length > 0) {
      console.warn(`Entités manquantes: ${missingEntities.join(', ')}`);
    }

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
        income_items: incomeSensor && incomeSensor.attributes.income_items ? incomeSensor.attributes.income_items : [],
        expense_items: expenseSensor && expenseSensor.attributes.expense_items ? expenseSensor.attributes.expense_items : [],
        recurring_incomes: incomeSensor && incomeSensor.attributes.recurring_incomes ? incomeSensor.attributes.recurring_incomes : [],
        recurring_expenses: expenseSensor && expenseSensor.attributes.recurring_expenses ? expenseSensor.attributes.recurring_expenses : [],
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
      case 'history':
        content = this._renderHistoryTab(account);
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
              <button class="tab-btn${this._currentTab === 'overview' ? ' active' : ''}" data-tab="overview">Vue d'ensemble</button>
              <button class="tab-btn${this._currentTab === 'income' ? ' active' : ''}" data-tab="income">Revenus</button>
              <button class="tab-btn${this._currentTab === 'expenses' ? ' active' : ''}" data-tab="expenses">Dépenses</button>
              <button class="tab-btn${this._currentTab === 'recurring' ? ' active' : ''}" data-tab="recurring">Récurrents</button>
              <button class="tab-btn${this._currentTab === 'history' ? ' active' : ''}" data-tab="history">Historique</button>
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
        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .month-selector {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .month-selector label {
          margin-bottom: 0;
          font-size: 0.9em;
          white-space: nowrap;
        }
        .month-selector select {
          min-width: 150px;
        }
        .end-date-badge {
          background-color: rgba(255, 152, 0, 0.2);
          color: var(--primary-text-color);
          font-size: 0.75em;
          padding: 2px 6px;
          border-radius: 4px;
          margin-left: 8px;
          border: 1px solid rgba(255, 152, 0, 0.5);
        }
      </style>
    `;
    
    // Attacher les événements UNIQUEMENT si ce n'est pas déjà fait
    if (!this._eventsAttached) {
      this._attachEventListeners();
      this._eventsAttached = true;
    }
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
        ${account.recurring_incomes.length > 0 
          ? account.recurring_incomes.map(item => `
            <div class="item" data-id="${item.id}">
              <span class="day-of-month">${item.day_of_month || 1}</span>
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">
                  ${item.category || 'Sans catégorie'}
                  ${item.end_date ? `<span class="end-date-badge">Fin: ${item.end_date}</span>` : ''}
                </div>
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
                <div class="item-category">
                  ${item.category || 'Sans catégorie'}
                  ${item.end_date ? `<span class="end-date-badge">Fin: ${item.end_date}</span>` : ''}
                </div>
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

  _renderHistoryTab(account) {
    // Récupérer les données d'archive depuis les attributs de l'entité
    const incomeSensor = this._hass.states[account.entities.income];
    const expenseSensor = this._hass.states[account.entities.expenses];
    const balanceSensor = this._hass.states[account.entities.balance];
    
    const archivedMonths = (incomeSensor && incomeSensor.attributes.archived_months) 
      ? incomeSensor.attributes.archived_months 
      : [];
    
    // Initialiser le mois sélectionné si nécessaire
    if (!this._selectedHistoryMonth && archivedMonths.length > 0) {
      this._selectedHistoryMonth = archivedMonths[archivedMonths.length - 1];
    }
    
    if (archivedMonths.length === 0) {
      return `
        <div class="empty-state">
          <p>Aucun historique disponible.</p>
          <p>Les données des mois précédents apparaîtront ici après l'archivage automatique.</p>
        </div>
      `;
    }
    
    // Trouver les données du mois sélectionné
    let selectedMonthData = null;
    if (this._selectedHistoryMonth && incomeSensor && incomeSensor.attributes.archived_data) {
      selectedMonthData = incomeSensor.attributes.archived_data[this._selectedHistoryMonth];
    }
    
    // Si pas de données, prendre le dernier mois disponible
    if (!selectedMonthData && archivedMonths.length > 0) {
      const lastMonth = archivedMonths[archivedMonths.length - 1];
      this._selectedHistoryMonth = lastMonth;
      if (incomeSensor && incomeSensor.attributes.archived_data) {
        selectedMonthData = incomeSensor.attributes.archived_data[lastMonth];
      }
    }
    
    // Extraire les données ou utiliser des valeurs par défaut
    const incomeItems = selectedMonthData?.income_items || [];
    const expenseItems = selectedMonthData?.expense_items || [];
    const totalIncome = selectedMonthData?.total_income || 0;
    const totalExpenses = selectedMonthData?.total_expenses || 0;
    const balance = selectedMonthData?.balance || 0;
    
    return `
      <div class="history-header">
        <h3>Historique</h3>
        <div class="month-selector">
          <label for="history-month">Sélectionner un mois:</label>
          <select id="history-month">
            ${archivedMonths.slice().reverse().map(month => `
              <option value="${month}" ${month === this._selectedHistoryMonth ? 'selected' : ''}>
                ${this._formatMonthLabel(month)}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
      
      <div class="summary-boxes">
        <div class="summary-box income">
          <div class="label">Revenus</div>
          <div class="amount positive">${parseFloat(totalIncome).toFixed(2)} €</div>
        </div>
        <div class="summary-box expenses">
          <div class="label">Dépenses</div>
          <div class="amount negative">${parseFloat(totalExpenses).toFixed(2)} €</div>
        </div>
        <div class="summary-box balance">
          <div class="label">Solde</div>
          <div class="amount ${parseFloat(balance) >= 0 ? 'positive' : 'negative'}">${parseFloat(balance).toFixed(2)} €</div>
        </div>
      </div>

      <h3>Revenus (${incomeItems.length})</h3>
      <div class="items-list">
        ${incomeItems.length > 0 
          ? incomeItems.map(item => `
            <div class="item">
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount income">+${parseFloat(item.amount).toFixed(2)} €</div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucun revenu ce mois-là</div>`
        }
      </div>

      <h3>Dépenses (${expenseItems.length})</h3>
      <div class="items-list">
        ${expenseItems.length > 0 
          ? expenseItems.map(item => `
            <div class="item">
              <div class="item-details">
                <div class="item-description">${item.description || 'Sans description'}</div>
                <div class="item-category">${item.category || 'Sans catégorie'}</div>
              </div>
              <div class="item-amount expenses">-${parseFloat(item.amount).toFixed(2)} €</div>
            </div>
          `).join('')
          : `<div class="empty-state">Aucune dépense ce mois-là</div>`
        }
      </div>
    `;
  }

  _formatMonthLabel(monthKey) {
    // Format: "YYYY-MM" -> "Mois Année"
    const [year, month] = monthKey.split('-');
    const monthNames = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];
    const monthIndex = parseInt(month, 10) - 1;
    return `${monthNames[monthIndex]} ${year}`;
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
        <div class="form-row">
          <div class="form-group">
            <label for="day_of_month">Jour du mois</label>
            <input type="number" id="day_of_month" min="1" max="31" value="1" />
          </div>
          <div class="form-group">
            <label for="end_date">Date de fin (optionnel)</label>
            <input type="date" id="end_date" placeholder="YYYY-MM-DD" />
          </div>
        </div>
        <button type="button" class="btn save-btn">Enregistrer</button>
        <button type="button" class="btn" style="background-color: #888; margin-left: 8px;">Annuler</button>
      </form>
    `;
  }

  _renderEditRecurringForm() {
    // Utiliser le type de récurrence mémorisé
    const isIncome = this._recurringType === 'income';
    const title = isIncome ? 'Modifier un revenu récurrent' : 'Modifier une dépense récurrente';
    const items = isIncome 
      ? this._accounts.find(acc => acc.name === this._currentAccount).recurring_incomes
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
        <div class="form-row">
          <div class="form-group">
            <label for="day_of_month">Jour du mois</label>
            <input type="number" id="day_of_month" min="1" max="31" value="${item.day_of_month || 1}" />
          </div>
          <div class="form-group">
            <label for="end_date">Date de fin (optionnel)</label>
            <input type="date" id="end_date" placeholder="YYYY-MM-DD" value="${item.end_date || ''}" />
          </div>
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

  _callService(domain, service, data, description) {
    // Afficher un indicateur de chargement
    this._setLoadingState(true);
        
    // Appeler le service
    return this._hass.callService(domain, service, data)
      .then(() => {        
        // Définir un court délai pour laisser le temps au backend de traiter et émettre les événements
        return new Promise(resolve => setTimeout(() => {
          // Fermer les formulaires selon le service appelé
          if ([
            'add_income_item',
            'add_expense_item',
            'add_recurring_income',
            'add_recurring_expense'
          ].includes(service)) {
            this._isAddingItem = false;
          }
          if ([
            'add_recurring_income',
            'add_recurring_expense'
          ].includes(service)) {
            this._currentTab = 'recurring';
          }
          if ([
            'remove_item',
            'remove_recurring_item',
            'add_income_item',
            'add_expense_item',
            'add_recurring_income',
            'add_recurring_expense'
          ].includes(service)) {
            this._editingItem = null;
          }
          // Force une actualisation immédiate des données
          this._fetchData();
          this._render();
          // Ajout : forcer la mise à jour Home Assistant des entités après modification
          if ([
            'add_income_item',
            'add_expense_item',
            'remove_item',
            'add_recurring_income',
            'add_recurring_expense',
            'remove_recurring_item'
          ].includes(service)) {
            this._refreshData();
          }
          // Désactiver l'indicateur de chargement
          this._setLoadingState(false);
          resolve();
        }, 300)); // Délai de 300ms pour laisser le temps au backend de propager les événements
      })
      .catch((error) => {
        console.error(`Erreur lors de ${description}:`, error);
        alert(`Une erreur est survenue lors de ${description}.`);
        this._setLoadingState(false);
        throw error; // Propager l'erreur pour permettre une gestion spécifique si nécessaire
      });
  }

  _attachEventListeners() {
    // Délégation unique sur le shadowRoot
    this.shadowRoot.addEventListener('click', (e) => {
      const target = e.target;
      // Navigation onglets
      if (target.classList.contains('tab-btn')) {
        const tab = target.dataset.tab;
        if (tab) {
          this._handleTabChange(tab);
        }
        return;
      }
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
          this._handleSubmitNewRecurringItem();
        } else if (this._currentTab === 'income' || this._currentTab === 'expenses') {
          this._handleSubmitNewItem();
        }
        return;
      }
      // Gestion des boutons modifier/supprimer
      if (target.classList.contains('btn-small')) {
        const itemRow = target.closest('.item');
        let itemId;
        if (itemRow) {
          itemId = itemRow.dataset.id;
        }
        if (target.textContent === 'Modifier') {
          if (itemRow) {
            if (target.classList.contains('recurring')) {
              // Déterminer le type de l'élément à partir de la classe du montant
              let type = 'income';
              if (itemRow.querySelector('.item-amount')?.classList.contains('expenses')) {
                type = 'expenses';
              }
              this._handleEditRecurringItem(type, itemId);
            } else {
              this._handleEditItem(itemId);
            }
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
      // Gestion des boutons de mise à jour
      if (target.textContent === 'Mettre à jour' || target.classList.contains('update-btn')) {
        if (this._currentTab === 'recurring') {
          this._handleUpdateRecurringItem(this._recurringType);
        } else {
          this._handleUpdateItem(this._currentTab);
        }
        return;
      }
      // Gestion du sélecteur de compte
      // Gestion du changement de compte via le select
      if (target.closest('.account-selector') && target.tagName === 'SELECT') {
        target.addEventListener('change', (event) => {
          this._currentAccount = event.target.value;
          this._editingItem = null;
          this._isAddingItem = false;
          this._render();
        }, { once: true });
        return;
      }
      // Gestion du sélecteur de mois dans l'historique
      if (target.id === 'history-month') {
        target.addEventListener('change', (event) => {
          this._selectedHistoryMonth = event.target.value;
          this._render();
        }, { once: true });
        return;
      }
      // Gestion du bouton de rafraîchissement
      if (target.classList.contains('refresh-button')) {
        this._refreshData();
        return;
      }
      // Gestion des boutons 'Tout supprimer'
      if (target.id === 'delete-all-income') {
        this._deleteAllItems('income');
        return;
      }
      if (target.id === 'delete-all-expenses') {
        this._deleteAllItems('expenses');
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

  _handleEditItem(itemId) {
    this._editingItem = itemId;
    this._render();
  }

  _handleEditRecurringItem(type, itemId) {
    this._editingItem = itemId;
    this._currentTab = 'recurring';
    this._recurringType = type;
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
    const itemType = this._currentTab === 'income' ? 'revenu' : 'dépense';

    // Utiliser notre méthode centralisée
    this._callService(
      'budget_tracker', 
      serviceType, 
      {
        account: this._currentAccount,
        amount: amount,
        description: description,
        category: category
      },
      `l'ajout d'un élément de ${itemType}`
    );
  }

  _handleSubmitNewRecurringItem() {
    const description = this.shadowRoot.querySelector('#description').value;
    const amount = parseFloat(this.shadowRoot.querySelector('#amount').value);
    const category = this.shadowRoot.querySelector('#category').value;
    const dayOfMonth = parseInt(this.shadowRoot.querySelector('#day_of_month').value, 10) || 1;
    const endDate = this.shadowRoot.querySelector('#end_date').value;

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
    const itemType = this._recurringType === 'income' ? 'revenu récurrent' : 'dépense récurrente';

    // Construire les données du service
    const serviceData = {
      account: this._currentAccount,
      amount: amount,
      description: description,
      category: category,
      day_of_month: dayOfMonth
    };

    // Ajouter end_date seulement s'il est défini
    if (endDate) {
      serviceData.end_date = endDate;
    }

    // Utiliser notre méthode centralisée
    this._callService(
      'budget_tracker', 
      serviceType, 
      serviceData,
      `l'ajout d'un élément de ${itemType}`
    );
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
    const itemId = this._editingItem;
    const itemType = type === 'income' ? 'revenu' : 'dépense';
    
    // Afficher un indicateur de chargement
    this._setLoadingState(true);

    // Séquence d'appels asynchrones pour éviter les problèmes
    this._callService(
      'budget_tracker',
      'remove_item',
      {
        account: this._currentAccount,
        item_id: itemId
      },
      `la suppression de l'ancien élément de ${itemType}`
    ).then(() => {
      // Une fois la suppression réussie, ajouter le nouvel élément
      const serviceType = type === 'income' ? 'add_income_item' : 'add_expense_item';
      return this._callService(
        'budget_tracker',
        serviceType,
        {
          account: this._currentAccount,
          amount: amount,
          description: description,
          category: category
        },
        `l'ajout du nouvel élément de ${itemType}`
      );
    });
  }

  _handleUpdateRecurringItem(type) {
    // Utiliser le type de récurrence mémorisé
    const isIncome = this._recurringType === 'income';
    const description = this.shadowRoot.querySelector('#description').value;
    const amount = parseFloat(this.shadowRoot.querySelector('#amount').value);
    const category = this.shadowRoot.querySelector('#category').value;
    const dayOfMonth = parseInt(this.shadowRoot.querySelector('#day_of_month').value, 10) || 1;
    const endDate = this.shadowRoot.querySelector('#end_date').value;

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
    const itemType = isIncome ? 'revenu récurrent' : 'dépense récurrente';
    
    // Afficher un indicateur de chargement
    this._setLoadingState(true);
    
    // Séquence d'appels asynchrones pour éviter les problèmes
    this._callService(
      'budget_tracker',
      'remove_recurring_item',
      {
        account: this._currentAccount,
        item_id: itemId
      },
      `la suppression de l'ancien élément de ${itemType}`
    ).then(() => {
      // Une fois la suppression réussie, ajouter le nouvel élément
      const serviceType = isIncome ? 'add_recurring_income' : 'add_recurring_expense';
      
      // Construire les données du service
      const serviceData = {
        account: this._currentAccount,
        amount: amount,
        description: description,
        category: category,
        day_of_month: dayOfMonth
      };

      // Ajouter end_date seulement s'il est défini
      if (endDate) {
        serviceData.end_date = endDate;
      }

      return this._callService(
        'budget_tracker',
        serviceType,
        serviceData,
        `l'ajout du nouvel élément de ${itemType}`
      );
    });
  }

  _handleRemoveItem(type, itemId) {
    this._showConfirmationDialog('Êtes-vous sûr de vouloir supprimer cet élément ?', () => {
      // Utiliser notre nouvelle méthode pour appeler le service
      this._callService(
        'budget_tracker',
        'remove_item',
        {
          account: this._currentAccount,
          item_id: itemId
        },
        'la suppression de l\'élément'
      );
    });
  }

  _handleRemoveRecurringItem(type, itemId) {
    this._showConfirmationDialog('Êtes-vous sûr de vouloir supprimer cet élément récurrent ?', () => {
      // Utiliser notre nouvelle méthode pour appeler le service
      this._callService(
        'budget_tracker',
        'remove_recurring_item',
        {
          account: this._currentAccount,
          item_id: itemId
        },
        'la suppression de l\'élément récurrent'
      );
    });
  }

  _deleteAllItems(type) {
    const account = this._accounts.find(acc => acc.name === this._currentAccount);
    const items = type === 'income' ? account.income_items : account.expense_items;
    if (!items.length) return;
    
    this._showConfirmationDialog(
      `Êtes-vous sûr de vouloir supprimer toutes les ${type === 'income' ? 'revenus' : 'dépenses'} du mois ?`,
      () => {
        // Utiliser notre nouvelle méthode pour appeler le service
        this._callService(
          'budget_tracker',
          'clear_month_items',
          {
            account: this._currentAccount,
            clear_income: type === 'income',
            clear_expenses: type === 'expenses'
          },
          `la suppression de tous les éléments de type ${type}`
        );
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
      
      // Afficher un indicateur de chargement temporaire
      this._setLoadingState(true);
      
      // Attendre un court délai pour laisser Home Assistant mettre à jour les entités
      setTimeout(() => {
        this._fetchData();
        this._render();
        this._setLoadingState(false);
      }, 350);
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
                // Afficher un indicateur de chargement temporaire
                this._setLoadingState(true);
                
                // Actualiser les données et l'interface
                this._fetchData();
                this._render();
                
                // Désactiver l'indicateur de chargement après un délai
                setTimeout(() => {
                  this._setLoadingState(false);
                }, 200);
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
    // Appeler le service Home Assistant pour mettre à jour toutes les entités de la carte
    const entities = this._config.entities || [];
    if (entities.length === 0) {
      this._setLoadingState(false);
      return;
    }
    // Appel du service homeassistant.update_entity pour chaque entité
    Promise.all(
      entities.map(entity_id =>
        this._hass.callService('homeassistant', 'update_entity', { entity_id })
      )
    )
      .then(() => {
        // Attendre un court délai pour laisser le backend traiter
        return new Promise(resolve => setTimeout(resolve, 300));
      })
      .then(() => {
        this._fetchData();
        this._render();
        this._setLoadingState(false);
      })
      .catch(error => {
        console.error('Erreur lors du rafraîchissement des données:', error);
        this._setLoadingState(false);
      });
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
console.info(`%c Budget Tracker Card`, "background-color: #555;color: #fff;padding: 3px 2px 3px 3px;border-radius: 14px 0 0 14px;font-family: DejaVu Sans,Verdana,Geneva,sans-serif;text-shadow: 0 1px 0 rgba(1, 1, 1, 0.3)")
