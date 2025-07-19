"""Config flow for Budget Tracker integration."""
from typing import Any, Dict, Optional
import voluptuous as vol
import json
import os

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
import homeassistant.helpers.config_validation as cv

from .const import (
    DOMAIN,
    NAME,
    CONF_ACCOUNTS,
    CONF_STORAGE_TYPE,
    STORAGE_TYPE_FILE,
    DEFAULT_STORAGE_TYPE,
    DATA_STORAGE_FILE,
)

class BudgetTrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Budget Tracker."""

    VERSION = 1

    def add_device_node_to_storage(self, account_name):
        """
        Create a node for the account in DATA_STORAGE_FILE if absent.
        """
        if not os.path.exists(DATA_STORAGE_FILE):
            data = {}
        else:
            try:
                with open(DATA_STORAGE_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except Exception:
                data = {}
        if account_name not in data:
            data[account_name] = {
                "income": 0, 
                "expenses": 0, 
                "balance": 0, 
                "income_items": [], 
                "expense_items": [], 
                "recurring_income": [],
                "recurring_expenses": [],
                "history": {}
            }
            with open(DATA_STORAGE_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        return False

    async def async_step_user(self, user_input: Optional[Dict[str, Any]] = None) -> FlowResult:
        """Handle the initial step."""
        errors = {}

        if user_input is not None:
            # Validate accounts
            accounts = [a.strip() for a in user_input[CONF_ACCOUNTS].split(",") if a.strip()]
            if not accounts:
                errors[CONF_ACCOUNTS] = "no_accounts"
            else:
                for account in accounts:
                    self.add_device_node_to_storage(account)
                # Store the validated data
                return self.async_create_entry(
                    title=", ".join(accounts),
                    data={
                        CONF_ACCOUNTS: accounts,
                        CONF_STORAGE_TYPE: user_input.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE),
                    },
                )

        # Show form (no name field)
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ACCOUNTS, default="default"): str,
                    vol.Optional(CONF_STORAGE_TYPE, default=DEFAULT_STORAGE_TYPE): vol.In(
                        [STORAGE_TYPE_FILE]
                    ),
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Get the options flow for this handler."""
        return BudgetTrackerOptionsFlowHandler(config_entry)


class BudgetTrackerOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle Budget Tracker options."""

    def __init__(self, config_entry):
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        errors = {}

        if user_input is not None:
            # Validate accounts
            accounts = [a.strip() for a in user_input[CONF_ACCOUNTS].split(",") if a.strip()]
            if not accounts:
                errors[CONF_ACCOUNTS] = "no_accounts"
            else:
                return self.async_create_entry(
                    title=", ".join(accounts),
                    data={
                        CONF_ACCOUNTS: accounts,
                        CONF_STORAGE_TYPE: user_input.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE),
                    },
                )

        # Get current values or defaults
        current_accounts = self.config_entry.data.get(CONF_ACCOUNTS, ["default"])
        if isinstance(current_accounts, list):
            current_accounts = ", ".join(current_accounts)
        
        current_storage_type = self.config_entry.data.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE)

        # Show form (no name field)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ACCOUNTS, default=current_accounts): str,
                    vol.Required(CONF_STORAGE_TYPE, default=current_storage_type): vol.In(
                        [STORAGE_TYPE_FILE]
                    ),
                }
            ),
            errors=errors,
        )