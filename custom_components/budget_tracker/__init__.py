"""
Intégration Budget Tracker pour Home Assistant
Ce module permet de suivre les revenus et dépenses mensuels, avec gestion des comptes, récurrents et historique.
"""

# Imports
import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta
import json
from pathlib import Path
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    CONF_NAME, 
    Platform, 
    STATE_UNKNOWN, 
    EVENT_HOMEASSISTANT_START,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.typing import ConfigType
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.json import JSONEncoder

from .const import (
    DOMAIN,
    CONF_ACCOUNTS,
    CONF_STORAGE_TYPE,
    STORAGE_TYPE_FILE,
    DEFAULT_STORAGE_TYPE,
    SERVICE_SET_INCOME,
    SERVICE_SET_EXPENSES,
    SERVICE_RESET_MONTH,
    SERVICE_ADD_INCOME_ITEM,
    SERVICE_ADD_EXPENSE_ITEM,
    SERVICE_REMOVE_ITEM,
    SERVICE_ADD_RECURRING_INCOME,
    SERVICE_ADD_RECURRING_EXPENSE,
    SERVICE_REMOVE_RECURRING_ITEM,
    SERVICE_CLEAR_MONTH_ITEMS,
    ATTR_ACCOUNT,
    ATTR_AMOUNT,
    ATTR_MONTH,
    ATTR_YEAR,
    ATTR_DESCRIPTION,
    ATTR_ITEM_ID,
    ATTR_ITEMS_INCOME,
    ATTR_ITEMS_EXPENSE,
    ATTR_CATEGORY,
    ATTR_RECURRING_INCOMES,
    ATTR_RECURRING_EXPENSES,
    ATTR_DAY_OF_MONTH,
    ATTR_END_DATE,
    DATA_STORAGE_FILE,
    EVENT_MONTH_CHANGED,
)
from .frontend_integration import setup_frontend_integration, notify_frontend

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR]
CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)

def get_storage_path(hass: HomeAssistant) -> str:
    """
    Retourne le chemin du fichier de stockage des données.
    """
    return hass.config.path(DATA_STORAGE_FILE)

def _read_json_file(file_path):
    with open(file_path, "r", encoding="utf-8") as file:
        return json.load(file)

def _write_json_file(file_path, data):
    with open(file_path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)



async def remove_device_node_from_storage(hass: HomeAssistant, account_name: str):
    """
    Remove the node for the account in DATA_STORAGE_FILE if present.
    """
    file_path = get_storage_path(hass)
    if not os.path.exists(file_path):
        return False
    try:
        data = await hass.async_add_executor_job(_read_json_file, file_path)
        if account_name in data:
            del data[account_name]
            await hass.async_add_executor_job(_write_json_file, file_path, data)
            return True
        return False
    except Exception as err:
        _LOGGER.error("Failed to remove account %s from storage: %s", account_name, err)
        return False

# ---------------------- SETUP PRINCIPAL ----------------------
async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """
    Configure le composant Budget Tracker lors du démarrage de Home Assistant.
    Initialise l'intégration frontend.
    """
    hass.data.setdefault(DOMAIN, {})
    
    # Setup frontend integration (websocket API)
    await setup_frontend_integration(hass)
    
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """
    Configure l'intégration Budget Tracker à partir d'une entrée de configuration.
    Initialise la structure des données, charge les données existantes, enregistre les services et planifie l'archivage mensuel.
    """
    # Load or create data storage
    storage_type = entry.data.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE)
    accounts = entry.data.get(CONF_ACCOUNTS, ["default"])

    # Create data structure
    hass.data[DOMAIN][entry.entry_id] = {
        "storage_type": storage_type,
        "accounts": accounts,
        "data": {account: {
            "income": 0, 
            "expenses": 0, 
            "balance": 0, 
            "income_items": [], 
            "expense_items": [], 
            "recurring_incomes": [],
            "recurring_expenses": [],
            "history": {}
        } for account in accounts},
    }

    # Load existing data
    await load_data(hass, entry)

    # Synchronize recurring items with current month items
    await sync_recurring_items(hass, entry)

    # Register services
    register_services(hass)

    # Schedule monthly archive task
    @callback
    def check_month_change(now):
        """Check if month has changed to trigger archive and reset."""
        # Only run on the first day of the month at 00:00:00
        if now.day == 1 and now.hour == 0 and now.minute == 0 and now.second == 0:
            _LOGGER.info("New month detected, archiving budget data and resetting")
            hass.async_create_task(archive_and_reset_data(hass, entry))

    # Register listener for month change
    async_track_time_change(
        hass, check_month_change, hour=0, minute=0, second=0
    )

    # When HA starts, check if we need to do an initial archive (if the month changed while HA was off)
    @callback
    def startup_check(event):
        """Check if we need to archive on startup."""
        last_reset = entry.data.get("last_reset", "")
        if last_reset:
            last_reset_date = datetime.fromisoformat(last_reset)
            now = datetime.now()
            # If we're in a different month than last reset and it's not the first day (which would trigger the normal reset)
            if (last_reset_date.month != now.month or last_reset_date.year != now.year) and not (now.day == 1 and now.hour == 0 and now.minute == 0):
                _LOGGER.info("Month changed while Home Assistant was off, archiving data")
                hass.async_create_task(archive_and_reset_data(hass, entry))
    
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_START, startup_check)

    # Set up platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """
    Décharge une entrée de configuration et nettoie les données associées.
    """
    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    
    # Remove data
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        # Remove storage file if using file storage
        if entry.data.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE) == STORAGE_TYPE_FILE:
            accounts = entry.data.get(CONF_ACCOUNTS, ["default"])
            for account in accounts:
                await remove_device_node_from_storage(hass, account)

    return unload_ok

# ---------------------- GESTION DES DONNÉES ----------------------
async def load_data(hass: HomeAssistant, entry: ConfigEntry):
    """
    Charge les données du budget depuis le fichier.
    """
    storage_type = entry.data.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE)
    
    if storage_type == STORAGE_TYPE_FILE:
        # Load data from file
        file_path = get_storage_path(hass)
        if os.path.exists(file_path):
            try:
                data = await hass.async_add_executor_job(_read_json_file, file_path)
                # Update data in memory
                hass.data[DOMAIN][entry.entry_id]["data"] = data
                _LOGGER.info("Loaded budget data from file: %s", file_path)
            except Exception as err:
                _LOGGER.error("Failed to load budget data: %s", err)

async def save_data(hass: HomeAssistant, entry: ConfigEntry):
    """
    Sauvegarde les données du budget dans le fichier.
    """
    data = hass.data[DOMAIN][entry.entry_id]["data"]
    storage_type = entry.data.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE)
    
    if storage_type == STORAGE_TYPE_FILE:
        # Save data to file asynchronously
        file_path = get_storage_path(hass)
        try:
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            await hass.async_add_executor_job(_write_json_file, file_path, data)
            _LOGGER.info("Saved budget data to file: %s", file_path)
        except Exception as err:
            _LOGGER.error("Failed to save budget data: %s", err)

async def sync_recurring_items(hass: HomeAssistant, entry: ConfigEntry):
    """
    Synchronise les items récurrents avec les items du mois en cours.
    Crée les items manquants pour tous les récurrents qui n'ont pas encore d'item ce mois-ci.
    Vérifie la date de fin (end_date) avant de créer les items.
    """
    _LOGGER.info("Synchronizing recurring items with current month items")
    accounts = entry.data.get(CONF_ACCOUNTS, ["default"])
    updated = False
    now = datetime.now()
    
    for account in accounts:
        account_data = hass.data[DOMAIN][entry.entry_id]["data"].get(account, {})
        
        # Get existing recurring_ids in current month items
        income_recurring_ids = {
            item.get("recurring_id") 
            for item in account_data.get("income_items", []) 
            if item.get("recurring_id")
        }
        expense_recurring_ids = {
            item.get("recurring_id") 
            for item in account_data.get("expense_items", []) 
            if item.get("recurring_id")
        }
        
        # Check recurring incomes
        if "recurring_incomes" in account_data:
            for recurring_item in account_data["recurring_incomes"]:
                recurring_id = recurring_item.get("id")
                
                # Check if end_date is in the past
                end_date = recurring_item.get("end_date")
                if end_date:
                    try:
                        end_dt = datetime.fromisoformat(end_date)
                        if now > end_dt:
                            _LOGGER.debug("Skipping expired recurring income %s (end_date: %s)", recurring_id, end_date)
                            continue
                    except (ValueError, TypeError) as err:
                        _LOGGER.warning("Invalid end_date format for recurring income %s: %s", recurring_id, err)
                
                if recurring_id not in income_recurring_ids:
                    # Create missing item
                    new_item = {
                        "id": str(uuid.uuid4()),
                        "amount": recurring_item["amount"],
                        "description": recurring_item["description"],
                        "category": recurring_item.get("category", ""),
                        "timestamp": now.isoformat(),
                        "recurring_id": recurring_id,
                    }
                    if "income_items" not in account_data:
                        account_data["income_items"] = []
                    account_data["income_items"].append(new_item)
                    _LOGGER.info("Created missing income item for recurring %s in account %s (amount: %.2f)", 
                                 recurring_id, account, recurring_item["amount"])
                    updated = True
        
        # Check recurring expenses
        if "recurring_expenses" in account_data:
            for recurring_item in account_data["recurring_expenses"]:
                recurring_id = recurring_item.get("id")
                
                # Check if end_date is in the past
                end_date = recurring_item.get("end_date")
                if end_date:
                    try:
                        end_dt = datetime.fromisoformat(end_date)
                        if now > end_dt:
                            _LOGGER.debug("Skipping expired recurring expense %s (end_date: %s)", recurring_id, end_date)
                            continue
                    except (ValueError, TypeError) as err:
                        _LOGGER.warning("Invalid end_date format for recurring expense %s: %s", recurring_id, err)
                
                if recurring_id not in expense_recurring_ids:
                    # Create missing item
                    new_item = {
                        "id": str(uuid.uuid4()),
                        "amount": recurring_item["amount"],
                        "description": recurring_item["description"],
                        "category": recurring_item.get("category", ""),
                        "timestamp": now.isoformat(),
                        "recurring_id": recurring_id,
                    }
                    if "expense_items" not in account_data:
                        account_data["expense_items"] = []
                    account_data["expense_items"].append(new_item)
                    _LOGGER.info("Created missing expense item for recurring %s in account %s (amount: %.2f)", 
                                 recurring_id, account, recurring_item["amount"])
                    updated = True
        
        # Recalculate totals if items were added
        if updated:
            account_data["income"] = sum(i["amount"] for i in account_data.get("income_items", []))
            account_data["expenses"] = sum(i["amount"] for i in account_data.get("expense_items", []))
            account_data["balance"] = account_data["income"] - account_data["expenses"]
            hass.data[DOMAIN][entry.entry_id]["data"][account] = account_data
    
    # Save if any changes were made
    if updated:
        await save_data(hass, entry)
        _LOGGER.info("Recurring items synchronization completed with updates")
    else:
        _LOGGER.debug("Recurring items synchronization completed - no changes needed")

async def archive_and_reset_data(hass: HomeAssistant, entry: ConfigEntry):
    """
    Archive les données du mois courant et réinitialise pour le nouveau mois.
    Applique les revenus et dépenses récurrents.
    Les totaux incluent les récurrents.
    """
    _LOGGER.info("Starting monthly archive and reset process")
    now = datetime.now()
    last_month = now.replace(day=1) - timedelta(days=1)
    year_month_key = f"{last_month.year}_{last_month.month:02d}"
    _LOGGER.info("Archiving data for %s", year_month_key)
    
    for account in entry.data.get(CONF_ACCOUNTS, ["default"]):
        _LOGGER.debug("Processing account: %s", account)
        account_data = hass.data[DOMAIN][entry.entry_id]["data"].get(account, {})
        if "history" not in account_data:
            account_data["history"] = {}
        
        # Archive current month data
        account_data["history"][year_month_key] = {
            "income": account_data.get("income", 0),
            "expenses": account_data.get("expenses", 0),
            "balance": account_data.get("balance", 0),
            "income_items": account_data.get("income_items", []),
            "expense_items": account_data.get("expense_items", []),
        }
        _LOGGER.info("Archived %s: income=%.2f, expenses=%.2f, balance=%.2f", 
                     account, account_data.get("income", 0), account_data.get("expenses", 0), account_data.get("balance", 0))
        
        # Reset current month
        account_data["income"] = 0
        account_data["expenses"] = 0
        account_data["balance"] = 0
        account_data["income_items"] = []
        account_data["expense_items"] = []
        
        # Apply recurring incomes
        if "recurring_incomes" in account_data:
            recurring_count = len(account_data["recurring_incomes"])
            _LOGGER.debug("Applying %d recurring income(s) for account %s", recurring_count, account)
            for recurring_item in account_data["recurring_incomes"]:
                # Check if end_date has passed
                end_date = recurring_item.get("end_date")
                if end_date:
                    try:
                        end_dt = datetime.fromisoformat(end_date)
                        if now > end_dt:
                            _LOGGER.debug("Skipping expired recurring income %s (end_date: %s)", recurring_item["id"], end_date)
                            continue
                    except (ValueError, TypeError) as err:
                        _LOGGER.warning("Invalid end_date format for recurring income %s: %s", recurring_item["id"], err)
                
                new_item = {
                    "id": str(uuid.uuid4()),
                    "amount": recurring_item["amount"],
                    "description": recurring_item["description"],
                    "category": recurring_item["category"],
                    "timestamp": now.isoformat(),
                    "recurring_id": recurring_item["id"],
                }
                account_data["income_items"].append(new_item)
        # Update total income (only items, récurrents are already in items)
        account_data["income"] = sum(i["amount"] for i in account_data["income_items"])
        if "recurring_expenses" in account_data:
            for recurring_item in account_data["recurring_expenses"]:
                # Check if end_date has passed
                end_date = recurring_item.get("end_date")
                if end_date:
                    try:
                        end_dt = datetime.fromisoformat(end_date)
                        if now > end_dt:
                            _LOGGER.debug("Skipping expired recurring expense %s (end_date: %s)", recurring_item["id"], end_date)
                            continue
                    except (ValueError, TypeError) as err:
                        _LOGGER.warning("Invalid end_date format for recurring expense %s: %s", recurring_item["id"], err)
                
                new_item = {
                    "id": str(uuid.uuid4()),
                    "amount": recurring_item["amount"],
                    "description": recurring_item["description"],
                    "category": recurring_item["category"],
                    "timestamp": now.isoformat(),
                    "recurring_id": recurring_item["id"],
                }
                account_data["expense_items"].append(new_item)
        # Update total expenses (only items, récurrents are already in items)
        account_data["expenses"] = sum(i["amount"] for i in account_data["expense_items"])
        account_data["balance"] = account_data["income"] - account_data["expenses"]
        
        _LOGGER.info("New month initialized for %s: income=%.2f, expenses=%.2f, balance=%.2f", 
                     account, account_data["income"], account_data["expenses"], account_data["balance"])
        hass.data[DOMAIN][entry.entry_id]["data"][account] = account_data
    new_data = dict(entry.data)
    new_data["last_reset"] = now.isoformat()
    hass.config_entries.async_update_entry(entry, data=new_data)
    await save_data(hass, entry)
    
    _LOGGER.info("Monthly archive and reset completed successfully")
    hass.bus.async_fire(
        EVENT_MONTH_CHANGED, 
        {"month": last_month.month, "year": last_month.year}
    )
    async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry.entry_id}")

# ---------------------- SERVICES ----------------------
def register_services(hass: HomeAssistant):
    """
    Enregistre tous les services de l'intégration Budget Tracker.
    """
    async def handle_set_income(call):
        """
        Service déprécié : Ajoute un revenu via un item, ne modifie plus le total directement.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        
        _LOGGER.warning("The set_income service is deprecated. Use add_income_item service instead.")
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Instead of setting the total directly, add an income item
                item_id = str(uuid.uuid4())
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": "Income Entry (via deprecated service)",
                    "category": "Legacy",
                    "timestamp": datetime.now().isoformat(),
                }
                if "income_items" not in entry_data["data"][account]:
                    entry_data["data"][account]["income_items"] = []
                entry_data["data"][account]["income_items"].append(item)
                entry_data["data"][account]["income"] = sum(i["amount"] for i in entry_data["data"][account]["income_items"])
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account]["income"] - entry_data["data"][account].get("expenses", 0)
                )
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                await load_data(hass, entry)
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)
    
    async def handle_set_expenses(call):
        """
        Service déprécié : Ajoute une dépense via un item, ne modifie plus le total directement.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        
        _LOGGER.warning("The set_expenses service is deprecated. Use add_expense_item service instead.")
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Instead of setting the total directly, add an expense item
                item_id = str(uuid.uuid4())
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": "Expense Entry (via deprecated service)",
                    "category": "Legacy",
                    "timestamp": datetime.now().isoformat(),
                }
                if "expense_items" not in entry_data["data"][account]:
                    entry_data["data"][account]["expense_items"] = []
                entry_data["data"][account]["expense_items"].append(item)
                entry_data["data"][account]["expenses"] = sum(i["amount"] for i in entry_data["data"][account]["expense_items"])
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account].get("income", 0) - entry_data["data"][account]["expenses"]
                )
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                await load_data(hass, entry)
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)
    
    async def handle_reset_month(call):
        """
        Service pour archiver et réinitialiser le mois.
        """
        account = call.data.get(ATTR_ACCOUNT)
        year = call.data.get(ATTR_YEAR)
        month = call.data.get(ATTR_MONTH)
        
        if year and month:
            # Archive specific month
            for entry_id in hass.data[DOMAIN]:
                entry = hass.config_entries.async_get_entry(entry_id)
                if not account or account in entry.data.get(CONF_ACCOUNTS, []):
                    await archive_and_reset_data(hass, entry)
    
    # Register services
    async def handle_add_income_item(call):
        """
        Ajoute un item de revenu au compte spécifié et met à jour le total et le solde.
        Les revenus incluent les items du mois + les récurrents.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        description = call.data.get(ATTR_DESCRIPTION, "")
        category = call.data.get(ATTR_CATEGORY, "")
        item_id = str(uuid.uuid4())
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Create new item
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": description,
                    "category": category,
                    "timestamp": datetime.now().isoformat(),
                }
                # Add to income items
                if "income_items" not in entry_data["data"][account]:
                    entry_data["data"][account]["income_items"] = []
                entry_data["data"][account]["income_items"].append(item)
                # Update total income (only items, no separate recurring total)
                entry_data["data"][account]["income"] = sum(i["amount"] for i in entry_data["data"][account]["income_items"])
                # Update balance
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account]["income"] - entry_data["data"][account].get("expenses", 0)
                )
                # Save the updated data
                # Log the data in memory ve reload
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                # Recharge les données depuis le fichier pour garantir la cohérence en mémoire
                await load_data(hass, entry)

                _LOGGER.debug("Added income item %.2f for account %s (new total: %.2f)", amount, account, entry_data["data"][account]["income"])
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        _LOGGER.warning("Account %s not found", account)

    async def handle_add_expense_item(call):
        """
        Ajoute un item de dépense au compte spécifié et met à jour le total et le solde.
        Les dépenses incluent les items du mois + les récurrents.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        description = call.data.get(ATTR_DESCRIPTION, "")
        category = call.data.get(ATTR_CATEGORY, "")
        item_id = str(uuid.uuid4())
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Create new item
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": description,
                    "category": category,
                    "timestamp": datetime.now().isoformat(),
                }
                # Add to expense items
                if "expense_items" not in entry_data["data"][account]:
                    entry_data["data"][account]["expense_items"] = []
                entry_data["data"][account]["expense_items"].append(item)
                # Update total expenses (only items, no separate recurring total)
                entry_data["data"][account]["expenses"] = sum(i["amount"] for i in entry_data["data"][account]["expense_items"])
                # Update balance
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account].get("income", 0) - entry_data["data"][account]["expenses"]
                )
                # Save the updated data
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                # Recharge les données depuis le fichier pour garantir la cohérence en mémoire
                await load_data(hass, entry)
                
                _LOGGER.debug("Added expense item %.2f for account %s (new total: %.2f)", amount, account, entry_data["data"][account]["expenses"])
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        _LOGGER.warning("Account %s not found", account)

    async def handle_remove_item(call):
        """
        Supprime un item de revenu ou de dépense et met à jour les totaux et le solde.
        Les totaux incluent les récurrents.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        item_id = call.data.get(ATTR_ITEM_ID)
        if not item_id:
            _LOGGER.warning("No item ID provided")
            return
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Check in income items
                if "income_items" in entry_data["data"][account]:
                    for i, item in enumerate(entry_data["data"][account]["income_items"]):
                        if item.get("id") == item_id:
                            entry_data["data"][account]["income_items"].pop(i)
                            # Recalculate total income (only items)
                            entry_data["data"][account]["income"] = sum(i["amount"] for i in entry_data["data"][account]["income_items"])
                            entry_data["data"][account]["balance"] = (
                                entry_data["data"][account]["income"] - entry_data["data"][account].get("expenses", 0)
                            )
                            entry = hass.config_entries.async_get_entry(entry_id)
                            await save_data(hass, entry)
                            _LOGGER.debug("Removed income item %s from account %s (new total: %.2f)", item_id, account, entry_data["data"][account]["income"])
                            async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                            return
                # Check in expense items
                if "expense_items" in entry_data["data"][account]:
                    for i, item in enumerate(entry_data["data"][account]["expense_items"]):
                        if item.get("id") == item_id:
                            entry_data["data"][account]["expense_items"].pop(i)
                            # Recalculate total expenses (only items)
                            entry_data["data"][account]["expenses"] = sum(i["amount"] for i in entry_data["data"][account]["expense_items"])
                            entry_data["data"][account]["balance"] = (
                                entry_data["data"][account].get("income", 0) - entry_data["data"][account]["expenses"]
                            )
                            entry = hass.config_entries.async_get_entry(entry_id)
                            await save_data(hass, entry)
                            _LOGGER.debug("Removed expense item %s from account %s (new total: %.2f)", item_id, account, entry_data["data"][account]["expenses"])
                            async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                            return
        _LOGGER.warning("Item %s not found for account %s", item_id, account)

    async def handle_clear_month_items(call):
        """
        Supprime tous les items du mois (revenus/dépenses) selon les filtres et met à jour les totaux.
        Les totaux incluent les récurrents.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        clear_income = call.data.get("clear_income", True)
        clear_expenses = call.data.get("clear_expenses", True)
        category_filter = call.data.get(ATTR_CATEGORY)
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                account_data = entry_data["data"][account]
                modified = False
                # Clear income items if requested
                if clear_income and "income_items" in account_data:
                    if category_filter:
                        before_count = len(account_data["income_items"])
                        account_data["income_items"] = [
                            item for item in account_data["income_items"]
                            if item.get(ATTR_CATEGORY) != category_filter
                        ]
                        if before_count != len(account_data["income_items"]):
                            modified = True
                    else:
                        if account_data["income_items"]:
                            account_data["income_items"] = []
                            modified = True
                    # Recalculate total income (only items)
                    account_data["income"] = sum(i["amount"] for i in account_data.get("income_items", []))
                # Clear expense items if requested
                if clear_expenses and "expense_items" in account_data:
                    if category_filter:
                        before_count = len(account_data["expense_items"])
                        account_data["expense_items"] = [
                            item for item in account_data["expense_items"]
                            if item.get(ATTR_CATEGORY) != category_filter
                        ]
                        if before_count != len(account_data["expense_items"]):
                            modified = True
                    else:
                        if account_data["expense_items"]:
                            account_data["expense_items"] = []
                            modified = True
                    # Recalculate total expenses (only items)
                    account_data["expenses"] = sum(i["amount"] for i in account_data.get("expense_items", []))
                account_data["balance"] = account_data.get("income", 0) - account_data.get("expenses", 0)
                if modified:
                    entry = hass.config_entries.async_get_entry(entry_id)
                    await save_data(hass, entry)
                    async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                    _LOGGER.info("Cleared items for account %s", account)
                return
        _LOGGER.warning("Account %s not found", account)

    async def handle_add_recurring_income(call):
        """
        Ajoute un revenu récurrent et crée l'item du mois si nécessaire.
        Supporte une date de fin optionnelle (end_date) au format YYYY-MM-DD.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        description = call.data.get(ATTR_DESCRIPTION, "")
        category = call.data.get(ATTR_CATEGORY, "")
        day_of_month = call.data.get(ATTR_DAY_OF_MONTH, 1)
        end_date = call.data.get(ATTR_END_DATE)  # Optional, format: YYYY-MM-DD
        item_id = str(uuid.uuid4())
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": description,
                    "category": category,
                    "day_of_month": day_of_month,
                    "created_at": datetime.now().isoformat(),
                }
                # Add end_date if provided
                if end_date:
                    item["end_date"] = end_date
                    
                if "recurring_incomes" not in entry_data["data"][account]:
                    entry_data["data"][account]["recurring_incomes"] = []
                entry_data["data"][account]["recurring_incomes"].append(item)
                
                # Check if we should create an item for current month
                current_day = datetime.now().day
                should_create = current_day <= day_of_month
                
                # Check if end_date is in the past
                if end_date and should_create:
                    try:
                        end_dt = datetime.fromisoformat(end_date)
                        if datetime.now() > end_dt:
                            should_create = False
                            _LOGGER.info("Recurring income %s not created - end_date %s is in the past", item_id, end_date)
                    except (ValueError, TypeError) as err:
                        _LOGGER.warning("Invalid end_date format for recurring income %s: %s", item_id, err)
                
                if should_create:
                    new_item = {
                        "id": str(uuid.uuid4()),
                        "amount": amount,
                        "description": description,
                        "category": category,
                        "timestamp": datetime.now().isoformat(),
                        "recurring_id": item_id,
                    }
                    if "income_items" not in entry_data["data"][account]:
                        entry_data["data"][account]["income_items"] = []
                    entry_data["data"][account]["income_items"].append(new_item)
                # Update total income (only items, recurring items are created above)
                entry_data["data"][account]["income"] = sum(i["amount"] for i in entry_data["data"][account]["income_items"])
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account]["income"] - entry_data["data"][account].get("expenses", 0)
                )
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        _LOGGER.warning("Account %s not found", account)

    async def handle_add_recurring_expense(call):
        """
        Ajoute une dépense récurrente et crée l'item du mois si nécessaire.
        Supporte une date de fin optionnelle (end_date) au format YYYY-MM-DD.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        description = call.data.get(ATTR_DESCRIPTION, "")
        category = call.data.get(ATTR_CATEGORY, "")
        day_of_month = call.data.get(ATTR_DAY_OF_MONTH, 1)
        end_date = call.data.get(ATTR_END_DATE)  # Optional, format: YYYY-MM-DD
        item_id = str(uuid.uuid4())
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": description,
                    "category": category,
                    "day_of_month": day_of_month,
                    "created_at": datetime.now().isoformat(),
                }
                # Add end_date if provided
                if end_date:
                    item["end_date"] = end_date
                    
                if "recurring_expenses" not in entry_data["data"][account]:
                    entry_data["data"][account]["recurring_expenses"] = []
                entry_data["data"][account]["recurring_expenses"].append(item)
                
                # Check if we should create an item for current month
                current_day = datetime.now().day
                should_create = current_day <= day_of_month
                
                # Check if end_date is in the past
                if end_date and should_create:
                    try:
                        end_dt = datetime.fromisoformat(end_date)
                        if datetime.now() > end_dt:
                            should_create = False
                            _LOGGER.info("Recurring expense %s not created - end_date %s is in the past", item_id, end_date)
                    except (ValueError, TypeError) as err:
                        _LOGGER.warning("Invalid end_date format for recurring expense %s: %s", item_id, err)
                
                if should_create:
                    new_item = {
                        "id": str(uuid.uuid4()),
                        "amount": amount,
                        "description": description,
                        "category": category,
                        "timestamp": datetime.now().isoformat(),
                        "recurring_id": item_id,
                    }
                    if "expense_items" not in entry_data["data"][account]:
                        entry_data["data"][account]["expense_items"] = []
                    entry_data["data"][account]["expense_items"].append(new_item)
                # Update total expenses (only items, recurring items are created above)
                entry_data["data"][account]["expenses"] = sum(i["amount"] for i in entry_data["data"][account]["expense_items"])
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account].get("income", 0) - entry_data["data"][account]["expenses"]
                )
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        _LOGGER.warning("Account %s not found", account)

    async def handle_remove_recurring_item(call):
        """
        Supprime un item récurrent (revenu ou dépense) et met à jour les totaux et le solde.
        Supprime aussi tous les items du mois en cours liés à ce récurrent.
        """
        account = call.data.get(ATTR_ACCOUNT, "default")
        item_id = call.data.get(ATTR_ITEM_ID)
        if not item_id:
            _LOGGER.warning("No item ID provided")
            return
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                updated = False
                # Check in recurring income items
                if "recurring_incomes" in entry_data["data"][account]:
                    for i, item in enumerate(entry_data["data"][account]["recurring_incomes"]):
                        if item.get("id") == item_id:
                            entry_data["data"][account]["recurring_incomes"].pop(i)
                            # Remove all income items linked to this recurring
                            if "income_items" in entry_data["data"][account]:
                                entry_data["data"][account]["income_items"] = [
                                    it for it in entry_data["data"][account]["income_items"]
                                    if it.get("recurring_id") != item_id
                                ]
                            updated = True
                            _LOGGER.debug("Removed recurring income %s and its related items from account %s", item_id, account)
                            break
                # Check in recurring expense items
                if "recurring_expenses" in entry_data["data"][account]:
                    for i, item in enumerate(entry_data["data"][account]["recurring_expenses"]):
                        if item.get("id") == item_id:
                            entry_data["data"][account]["recurring_expenses"].pop(i)
                            # Remove all expense items linked to this recurring
                            if "expense_items" in entry_data["data"][account]:
                                entry_data["data"][account]["expense_items"] = [
                                    it for it in entry_data["data"][account]["expense_items"]
                                    if it.get("recurring_id") != item_id
                                ]
                            updated = True
                            _LOGGER.debug("Removed recurring expense %s and its related items from account %s", item_id, account)
                            break
                if updated:
                    # Recalculate totals after removal (only items)
                    entry_data["data"][account]["income"] = sum(i["amount"] for i in entry_data["data"][account].get("income_items", []))
                    entry_data["data"][account]["expenses"] = sum(i["amount"] for i in entry_data["data"][account].get("expense_items", []))
                    entry_data["data"][account]["balance"] = entry_data["data"][account]["income"] - entry_data["data"][account]["expenses"]
                    entry = hass.config_entries.async_get_entry(entry_id)
                    await save_data(hass, entry)
                    _LOGGER.info("Removed recurring item %s from account %s (new income: %.2f, new expenses: %.2f)", 
                                 item_id, account, entry_data["data"][account]["income"], entry_data["data"][account]["expenses"])
                    async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                    return
        _LOGGER.warning("Recurring item %s not found for account %s", item_id, account)

    # Register new item services
    hass.services.async_register(
        DOMAIN, 
        SERVICE_ADD_INCOME_ITEM, 
        handle_add_income_item, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_AMOUNT): vol.Coerce(float),
            vol.Optional(ATTR_DESCRIPTION, default=""): cv.string,
            vol.Optional(ATTR_CATEGORY, default=""): cv.string,
        })
    )
    
    hass.services.async_register(
        DOMAIN, 
        SERVICE_ADD_EXPENSE_ITEM, 
        handle_add_expense_item, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_AMOUNT): vol.Coerce(float),
            vol.Optional(ATTR_DESCRIPTION, default=""): cv.string,
            vol.Optional(ATTR_CATEGORY, default=""): cv.string,
        })
    )
    
    hass.services.async_register(
        DOMAIN, 
        SERVICE_REMOVE_ITEM, 
        handle_remove_item, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_ITEM_ID): cv.string,
        })
    )
    
    # Register recurring item services
    hass.services.async_register(
        DOMAIN, 
        SERVICE_ADD_RECURRING_INCOME, 
        handle_add_recurring_income, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_AMOUNT): vol.Coerce(float),
            vol.Optional(ATTR_DESCRIPTION, default=""): cv.string,
            vol.Optional(ATTR_CATEGORY, default=""): cv.string,
            vol.Optional(ATTR_DAY_OF_MONTH, default=1): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=31)
            ),
            vol.Optional(ATTR_END_DATE): cv.string,  # Format: YYYY-MM-DD
        })
    )
    
    hass.services.async_register(
        DOMAIN, 
        SERVICE_ADD_RECURRING_EXPENSE, 
        handle_add_recurring_expense, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_AMOUNT): vol.Coerce(float),
            vol.Optional(ATTR_DESCRIPTION, default=""): cv.string,
            vol.Optional(ATTR_CATEGORY, default=""): cv.string,
            vol.Optional(ATTR_DAY_OF_MONTH, default=1): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=31)
            ),
            vol.Optional(ATTR_END_DATE): cv.string,  # Format: YYYY-MM-DD
        })
    )
    
    hass.services.async_register(
        DOMAIN, 
        SERVICE_REMOVE_RECURRING_ITEM, 
        handle_remove_recurring_item, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_ITEM_ID): cv.string,
        })
    )
    
    # Register clear month items service
    hass.services.async_register(
        DOMAIN, 
        SERVICE_CLEAR_MONTH_ITEMS, 
        handle_clear_month_items, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Optional("clear_income", default=True): cv.boolean,
            vol.Optional("clear_expenses", default=True): cv.boolean,
            vol.Optional(ATTR_CATEGORY): cv.string,
        })
    )

# Need to import this after function definitions to avoid circular imports
from homeassistant.helpers.dispatcher import async_dispatcher_send

async def notify_data_update(hass, entry_id, account=None):
    """
    Notifie tous les composants d'une mise à jour des données (sensors et frontend).
    """
    # Use the dispatcher for sensor updates
    async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
    
    # Use the frontend integration helper to notify frontend components
    event_data = {"entry_id": entry_id}
    if account:
        event_data["account"] = account
        
    notify_frontend(hass, f"{DOMAIN}_data_updated", event_data)
