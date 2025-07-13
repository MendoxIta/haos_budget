/**
 * Budget Tracker Card Editor
 * 
 * Éditeur de configuration pour la carte Budget Tracker.
 */

class BudgetTrackerCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  _render() {
    if (!this.shadowRoot) return;

    this.shadowRoot.innerHTML = `
      <style>
        ha-form {
          width: 100%;
        }
        .editor {
          padding: 16px;
        }
        .title {
          font-size: 16px;
          margin-bottom: 16px;
          font-weight: 500;
        }
        mwc-button {
          margin-top: 8px;
        }
        ha-entity-picker {
          display: block;
          margin-top: 8px;
        }
      </style>
      <div class="editor">
        <div class="title">Options de la carte Budget Tracker</div>
        <ha-form
          .hass=${this._hass}
          .data=${this._config}
          .schema=${this._schema}
          .computeLabel=${this._computeLabelCallback}
          @value-changed=${this._valueChanged}
        ></ha-form>
        <div class="entity-selectors">
          <div class="title">Entités Budget Tracker</div>
          <p>Sélectionnez les capteurs de budget à afficher dans cette carte :</p>
          ${this._renderEntityPickers()}
          <mwc-button @click="${this._addEntity}">Ajouter une entité</mwc-button>
        </div>
      </div>
    `;

    // Configure the entity pickers
    this._configureEntityPickers();
  }

  _renderEntityPickers() {
    if (!this._config.entities) {
      this._config.entities = [];
    }

    return this._config.entities.map((entity, index) => `
      <div class="entity-row">
        <ha-entity-picker
          .hass=${this._hass}
          .value=${entity}
          .index=${index}
          .includeDomains=${['sensor']}
          .domainFilter=${this._filterEntity.bind(this)}
          @value-changed=${this._entityChanged}
        ></ha-entity-picker>
        <mwc-button @click="${() => this._removeEntity(index)}">Supprimer</mwc-button>
      </div>
    `).join('');
  }

  _filterEntity(stateObj) {
    return stateObj.entity_id.includes('budget_tracker') && 
           (stateObj.entity_id.includes('income_current_month') || 
            stateObj.entity_id.includes('expenses_current_month') || 
            stateObj.entity_id.includes('balance_current_month'));
  }

  _configureEntityPickers() {
    const pickers = this.shadowRoot.querySelectorAll('ha-entity-picker');
    pickers.forEach(picker => {
      picker.hass = this._hass;
      picker.addEventListener('value-changed', this._entityChanged.bind(this));
    });
  }

  _entityChanged(ev) {
    const index = ev.target.index;
    const newValue = ev.detail.value;
    
    if (!this._config.entities) {
      this._config.entities = [];
    }

    if (index !== undefined && newValue) {
      this._config.entities[index] = newValue;
      this._fireEvent();
    }
  }

  _addEntity() {
    if (!this._config.entities) {
      this._config.entities = [];
    }
    this._config.entities.push('');
    this._fireEvent();
  }

  _removeEntity(index) {
    if (!this._config.entities) return;
    this._config.entities.splice(index, 1);
    this._fireEvent();
  }

  _valueChanged(ev) {
    if (!this._config || !this.shadowRoot) return;

    const newConfig = {
      ...this._config,
      ...ev.detail.value,
    };
    this._config = newConfig;
    this._fireEvent();
  }

  _fireEvent() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    this._render();
  }

  get _schema() {
    return [
      { name: 'title', type: 'string', label: 'Titre de la carte' },
    ];
  }

  _computeLabelCallback(schema) {
    return schema.label || schema.name;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }
}

customElements.define('budget-tracker-card-editor', BudgetTrackerCardEditor);
