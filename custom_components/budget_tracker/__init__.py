"""The Budget Tracker integration."""
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
    STORAGE_TYPE_INPUT_TEXT,
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
    ATTR_ITEMS,
    ATTR_CATEGORY,
    ATTR_RECURRING,
    ATTR_DAY_OF_MONTH,
    DATA_STORAGE_FILE,
    EVENT_MONTH_CHANGED,
)
from .frontend_integration import setup_frontend_integration, notify_frontend

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the Budget Tracker component."""
    hass.data.setdefault(DOMAIN, {})
    
    # Setup frontend integration (websocket API)
    await setup_frontend_integration(hass)
    
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Budget Tracker from a config entry."""
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
            "recurring_income": [],
            "recurring_expenses": [],
            "history": {}
        } for account in accounts},
    }

    # Load existing data
    await load_data(hass, entry)

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
    """Unload a config entry."""
    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    
    # Remove data
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok

async def load_data(hass: HomeAssistant, entry: ConfigEntry):
    """Load data from file or input_text."""
    storage_type = entry.data.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE)
    
    if storage_type == STORAGE_TYPE_FILE:
        # Load data from file
        file_path = get_storage_path(hass)
        if os.path.exists(file_path):
            try:
                with open(file_path, "r") as file:
                    data = json.load(file)
                    # Update data in memory
                    hass.data[DOMAIN][entry.entry_id]["data"] = data
                    _LOGGER.info("Loaded budget data from file: %s", file_path)
            except Exception as err:
                _LOGGER.error("Failed to load budget data: %s", err)
    
    elif storage_type == STORAGE_TYPE_INPUT_TEXT:
        # Load data from input_text entities
        # This implementation would depend on how input_text entities are set up
        # For each account, we would look for input_text.budget_tracker_{account}_data
        for account in entry.data.get(CONF_ACCOUNTS, ["default"]):
            entity_id = f"input_text.budget_tracker_{account}_data"
            state = hass.states.get(entity_id)
            if state:
                try:
                    data = json.loads(state.state)
                    hass.data[DOMAIN][entry.entry_id]["data"][account] = data
                    _LOGGER.info("Loaded budget data for account %s from input_text", account)
                except Exception as err:
                    _LOGGER.error("Failed to load budget data for account %s: %s", account, err)

async def save_data(hass: HomeAssistant, entry: ConfigEntry):
    """Save data to file or input_text."""
    data = hass.data[DOMAIN][entry.entry_id]["data"]
    storage_type = entry.data.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE)
    
    if storage_type == STORAGE_TYPE_FILE:
        # Save data to file
        file_path = get_storage_path(hass)
        try:
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "w") as file:
                json.dump(data, file, cls=JSONEncoder)
            _LOGGER.info("Saved budget data to file: %s", file_path)
        except Exception as err:
            _LOGGER.error("Failed to save budget data: %s", err)
    
    elif storage_type == STORAGE_TYPE_INPUT_TEXT:
        # Save data to input_text entities
        for account in entry.data.get(CONF_ACCOUNTS, ["default"]):
            entity_id = f"input_text.budget_tracker_{account}_data"
            account_data = data.get(account, {})
            try:
                await hass.services.async_call(
                    "input_text", 
                    "set_value", 
                    {"entity_id": entity_id, "value": json.dumps(account_data, cls=JSONEncoder)},
                )
                _LOGGER.info("Saved budget data for account %s to input_text", account)
            except Exception as err:
                _LOGGER.error("Failed to save budget data for account %s: %s", account, err)

async def archive_and_reset_data(hass: HomeAssistant, entry: ConfigEntry):
    """Archive current month data and reset for new month."""
    now = datetime.now()
    last_month = now.replace(day=1) - timedelta(days=1)
    year_month_key = f"{last_month.year}_{last_month.month:02d}"
    
    for account in entry.data.get(CONF_ACCOUNTS, ["default"]):
        account_data = hass.data[DOMAIN][entry.entry_id]["data"].get(account, {})
        
        # Save current values to history
        if "history" not in account_data:
            account_data["history"] = {}
        
        account_data["history"][year_month_key] = {
            "income": account_data.get("income", 0),
            "expenses": account_data.get("expenses", 0),
            "balance": account_data.get("balance", 0),
            "income_items": account_data.get("income_items", []),
            "expense_items": account_data.get("expense_items", []),
        }
        
        # Reset current values
        account_data["income"] = 0
        account_data["expenses"] = 0
        account_data["balance"] = 0
        account_data["income_items"] = []
        account_data["expense_items"] = []
        
        # Apply recurring items for the new month
        if "recurring_income" in account_data:
            for recurring_item in account_data["recurring_income"]:
                # Create a new income item from the recurring template
                new_item = {
                    "id": str(uuid.uuid4()),
                    "amount": recurring_item["amount"],
                    "description": recurring_item["description"],
                    "category": recurring_item["category"],
                    "timestamp": datetime.now().isoformat(),
                    "recurring_id": recurring_item["id"],  # Reference to the recurring item
                }
                
                account_data["income_items"].append(new_item)
                account_data["income"] += new_item["amount"]
                
        if "recurring_expenses" in account_data:
            for recurring_item in account_data["recurring_expenses"]:
                # Create a new expense item from the recurring template
                new_item = {
                    "id": str(uuid.uuid4()),
                    "amount": recurring_item["amount"],
                    "description": recurring_item["description"],
                    "category": recurring_item["category"],
                    "timestamp": datetime.now().isoformat(),
                    "recurring_id": recurring_item["id"],  # Reference to the recurring item
                }
                
                account_data["expense_items"].append(new_item)
                account_data["expenses"] += new_item["amount"]
        
        # Update balance after applying recurring items
        account_data["balance"] = account_data["income"] - account_data["expenses"]
        
        # Update in memory
        hass.data[DOMAIN][entry.entry_id]["data"][account] = account_data
    
    # Update last reset date
    new_data = dict(entry.data)
    new_data["last_reset"] = now.isoformat()
    hass.config_entries.async_update_entry(entry, data=new_data)
    
    # Save changes
    await save_data(hass, entry)
    
    # Fire event
    hass.bus.async_fire(
        EVENT_MONTH_CHANGED, 
        {"month": last_month.month, "year": last_month.year}
    )
    
    # Force state update
    async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry.entry_id}")

def get_storage_path(hass: HomeAssistant) -> str:
    """Get the path for storing data file."""
    return hass.config.path(DATA_STORAGE_FILE)

def register_services(hass: HomeAssistant):
    """Register integration services."""
    async def handle_set_income(call):
        """Handle the set_income service."""
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # For backward compatibility, set the total income
                entry_data["data"][account]["income"] = amount
                
                # Clear existing income items and create a single item with the total
                entry_data["data"][account]["income_items"] = [{
                    "id": str(uuid.uuid4()),
                    "amount": amount,
                    "description": "Total Income",
                    "category": "",
                    "timestamp": datetime.now().isoformat(),
                }] if amount > 0 else []
                
                # Update balance
                entry_data["data"][account]["balance"] = (
                    amount - entry_data["data"][account].get("expenses", 0)
                )
                
                # Save the updated data
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)
    
    async def handle_set_expenses(call):
        """Handle the set_expenses service."""
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # For backward compatibility, set the total expenses
                entry_data["data"][account]["expenses"] = amount
                
                # Clear existing expense items and create a single item with the total
                entry_data["data"][account]["expense_items"] = [{
                    "id": str(uuid.uuid4()),
                    "amount": amount,
                    "description": "Total Expenses",
                    "category": "",
                    "timestamp": datetime.now().isoformat(),
                }] if amount > 0 else []
                
                # Update balance
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account].get("income", 0) - amount
                )
                
                # Save the updated data
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)
    
    async def handle_reset_month(call):
        """Handle the reset_month service."""
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
        """Handle the add_income_item service."""
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
                
                # Update total income
                entry_data["data"][account]["income"] = sum(
                    item["amount"] for item in entry_data["data"][account]["income_items"]
                )
                
                # Update balance
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account]["income"] - entry_data["data"][account].get("expenses", 0)
                )
                
                # Save the updated data
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)

    async def handle_add_expense_item(call):
        """Handle the add_expense_item service."""
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
                
                # Update total expenses
                entry_data["data"][account]["expenses"] = sum(
                    item["amount"] for item in entry_data["data"][account]["expense_items"]
                )
                
                # Update balance
                entry_data["data"][account]["balance"] = (
                    entry_data["data"][account].get("income", 0) - entry_data["data"][account]["expenses"]
                )
                
                # Save the updated data
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)

    async def handle_remove_item(call):
        """Handle the remove_item service."""
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
                            # Remove item
                            entry_data["data"][account]["income_items"].pop(i)
                            
                            # Update totals
                            entry_data["data"][account]["income"] = sum(
                                item["amount"] for item in entry_data["data"][account]["income_items"]
                            )
                            
                            entry_data["data"][account]["balance"] = (
                                entry_data["data"][account]["income"] - entry_data["data"][account].get("expenses", 0)
                            )
                            
                            # Save and update
                            entry = hass.config_entries.async_get_entry(entry_id)
                            await save_data(hass, entry)
                            async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                            return

                # Check in expense items
                if "expense_items" in entry_data["data"][account]:
                    for i, item in enumerate(entry_data["data"][account]["expense_items"]):
                        if item.get("id") == item_id:
                            # Remove item
                            entry_data["data"][account]["expense_items"].pop(i)
                            
                            # Update totals
                            entry_data["data"][account]["expenses"] = sum(
                                item["amount"] for item in entry_data["data"][account]["expense_items"]
                            )
                            
                            entry_data["data"][account]["balance"] = (
                                entry_data["data"][account].get("income", 0) - entry_data["data"][account]["expenses"]
                            )
                            
                            # Save and update
                            entry = hass.config_entries.async_get_entry(entry_id)
                            await save_data(hass, entry)
                            async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                            return
        
        _LOGGER.warning("Item %s not found for account %s", item_id, account)

    async def handle_clear_month_items(call):
        """Handle the clear_month_items service - Remove all entries without resetting the month."""
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
                        # Filter by category
                        before_count = len(account_data["income_items"])
                        account_data["income_items"] = [
                            item for item in account_data["income_items"]
                            if item.get(ATTR_CATEGORY) != category_filter
                        ]
                        if before_count != len(account_data["income_items"]):
                            modified = True
                    else:
                        # Clear all
                        if account_data["income_items"]:
                            account_data["income_items"] = []
                            modified = True
                            
                    # Recalculate total income
                    account_data["income"] = sum(
                        item["amount"] for item in account_data.get("income_items", [])
                    )
                
                # Clear expense items if requested
                if clear_expenses and "expense_items" in account_data:
                    if category_filter:
                        # Filter by category
                        before_count = len(account_data["expense_items"])
                        account_data["expense_items"] = [
                            item for item in account_data["expense_items"]
                            if item.get(ATTR_CATEGORY) != category_filter
                        ]
                        if before_count != len(account_data["expense_items"]):
                            modified = True
                    else:
                        # Clear all
                        if account_data["expense_items"]:
                            account_data["expense_items"] = []
                            modified = True
                            
                    # Recalculate total expenses
                    account_data["expenses"] = sum(
                        item["amount"] for item in account_data.get("expense_items", [])
                    )
                
                # Update balance
                account_data["balance"] = account_data.get("income", 0) - account_data.get("expenses", 0)
                
                if modified:
                    # Save the updated data
                    entry = hass.config_entries.async_get_entry(entry_id)
                    await save_data(hass, entry)
                    
                    # Notify sensors to update
                    async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                    _LOGGER.info("Cleared items for account %s", account)
                return
        
        _LOGGER.warning("Account %s not found", account)

    # Register services
    hass.services.async_register(
        DOMAIN, 
        SERVICE_SET_INCOME, 
        handle_set_income, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_AMOUNT): vol.Coerce(float),
        })
    )
    
    hass.services.async_register(
        DOMAIN, 
        SERVICE_SET_EXPENSES, 
        handle_set_expenses, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT, default="default"): cv.string,
            vol.Required(ATTR_AMOUNT): vol.Coerce(float),
        })
    )
    
    hass.services.async_register(
        DOMAIN, 
        SERVICE_RESET_MONTH, 
        handle_reset_month, 
        vol.Schema({
            vol.Optional(ATTR_ACCOUNT): cv.string,
            vol.Optional(ATTR_YEAR): vol.Coerce(int),
            vol.Optional(ATTR_MONTH): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=12)
            ),
        })
    )
    
    async def handle_add_recurring_income(call):
        """Handle the add_recurring_income service."""
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        description = call.data.get(ATTR_DESCRIPTION, "")
        category = call.data.get(ATTR_CATEGORY, "")
        day_of_month = call.data.get(ATTR_DAY_OF_MONTH, 1)
        item_id = str(uuid.uuid4())
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Create new recurring item
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": description,
                    "category": category,
                    "day_of_month": day_of_month,
                    "created_at": datetime.now().isoformat(),
                }
                
                # Add to recurring income items
                if "recurring_income" not in entry_data["data"][account]:
                    entry_data["data"][account]["recurring_income"] = []
                
                entry_data["data"][account]["recurring_income"].append(item)
                
                # Create an actual income item for the current month if we're before or on the specified day
                current_day = datetime.now().day
                if current_day <= day_of_month:
                    new_item = {
                        "id": str(uuid.uuid4()),
                        "amount": amount,
                        "description": description,
                        "category": category,
                        "timestamp": datetime.now().isoformat(),
                        "recurring_id": item_id,
                    }
                    
                    # Add to income items
                    if "income_items" not in entry_data["data"][account]:
                        entry_data["data"][account]["income_items"] = []
                    
                    entry_data["data"][account]["income_items"].append(new_item)
                    
                    # Update total income
                    entry_data["data"][account]["income"] = sum(
                        item["amount"] for item in entry_data["data"][account]["income_items"]
                    )
                    
                    # Update balance
                    entry_data["data"][account]["balance"] = (
                        entry_data["data"][account]["income"] - entry_data["data"][account].get("expenses", 0)
                    )
                
                # Save the updated data
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)

    async def handle_add_recurring_expense(call):
        """Handle the add_recurring_expense service."""
        account = call.data.get(ATTR_ACCOUNT, "default")
        amount = call.data.get(ATTR_AMOUNT, 0)
        description = call.data.get(ATTR_DESCRIPTION, "")
        category = call.data.get(ATTR_CATEGORY, "")
        day_of_month = call.data.get(ATTR_DAY_OF_MONTH, 1)
        item_id = str(uuid.uuid4())
        
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Create new recurring item
                item = {
                    "id": item_id,
                    "amount": amount,
                    "description": description,
                    "category": category,
                    "day_of_month": day_of_month,
                    "created_at": datetime.now().isoformat(),
                }
                
                # Add to recurring expense items
                if "recurring_expenses" not in entry_data["data"][account]:
                    entry_data["data"][account]["recurring_expenses"] = []
                
                entry_data["data"][account]["recurring_expenses"].append(item)
                
                # Create an actual expense item for the current month if we're before or on the specified day
                current_day = datetime.now().day
                if current_day <= day_of_month:
                    new_item = {
                        "id": str(uuid.uuid4()),
                        "amount": amount,
                        "description": description,
                        "category": category,
                        "timestamp": datetime.now().isoformat(),
                        "recurring_id": item_id,
                    }
                    
                    # Add to expense items
                    if "expense_items" not in entry_data["data"][account]:
                        entry_data["data"][account]["expense_items"] = []
                    
                    entry_data["data"][account]["expense_items"].append(new_item)
                    
                    # Update total expenses
                    entry_data["data"][account]["expenses"] = sum(
                        item["amount"] for item in entry_data["data"][account]["expense_items"]
                    )
                    
                    # Update balance
                    entry_data["data"][account]["balance"] = (
                        entry_data["data"][account].get("income", 0) - entry_data["data"][account]["expenses"]
                    )
                
                # Save the updated data
                entry = hass.config_entries.async_get_entry(entry_id)
                await save_data(hass, entry)
                
                # Notify sensors to update
                async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                return
        
        _LOGGER.warning("Account %s not found", account)

    async def handle_remove_recurring_item(call):
        """Handle the remove_recurring_item service."""
        account = call.data.get(ATTR_ACCOUNT, "default")
        item_id = call.data.get(ATTR_ITEM_ID)
        
        if not item_id:
            _LOGGER.warning("No item ID provided")
            return
            
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if account in entry_data["accounts"]:
                # Check in recurring income items
                if "recurring_income" in entry_data["data"][account]:
                    for i, item in enumerate(entry_data["data"][account]["recurring_income"]):
                        if item.get("id") == item_id:
                            # Remove item
                            entry_data["data"][account]["recurring_income"].pop(i)
                            
                            # Save and update
                            entry = hass.config_entries.async_get_entry(entry_id)
                            await save_data(hass, entry)
                            async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
                            return

                # Check in recurring expense items
                if "recurring_expenses" in entry_data["data"][account]:
                    for i, item in enumerate(entry_data["data"][account]["recurring_expenses"]):
                        if item.get("id") == item_id:
                            # Remove item
                            entry_data["data"][account]["recurring_expenses"].pop(i)
                            
                            # Save and update
                            entry = hass.config_entries.async_get_entry(entry_id)
                            await save_data(hass, entry)
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
    """Notify all components about data updates."""
    # Use the dispatcher for sensor updates
    async_dispatcher_send(hass, f"{DOMAIN}_data_updated_{entry_id}")
    
    # Use the frontend integration helper to notify frontend components
    event_data = {"entry_id": entry_id}
    if account:
        event_data["account"] = account
        
    notify_frontend(hass, f"{DOMAIN}_data_updated", event_data)
