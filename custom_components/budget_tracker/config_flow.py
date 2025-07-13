"""Config flow for Budget Tracker integration."""
from typing import Any, Dict, Optional
import voluptuous as vol

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
    STORAGE_TYPE_INPUT_TEXT,
    DEFAULT_STORAGE_TYPE,
)


class BudgetTrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Budget Tracker."""

    VERSION = 1

    async def async_step_user(self, user_input: Optional[Dict[str, Any]] = None) -> FlowResult:
        """Handle the initial step."""
        errors = {}

        if user_input is not None:
            # Validate accounts
            accounts = [a.strip() for a in user_input[CONF_ACCOUNTS].split(",") if a.strip()]
            if not accounts:
                errors[CONF_ACCOUNTS] = "no_accounts"
            else:
                # Store the validated data
                return self.async_create_entry(
                    title=user_input.get(CONF_NAME, NAME),
                    data={
                        CONF_NAME: user_input.get(CONF_NAME, NAME),
                        CONF_ACCOUNTS: accounts,
                        CONF_STORAGE_TYPE: user_input.get(CONF_STORAGE_TYPE, DEFAULT_STORAGE_TYPE),
                    },
                )

        # Show form
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_NAME, default=NAME): str,
                    vol.Required(CONF_ACCOUNTS, default="default"): str,
                    vol.Optional(CONF_STORAGE_TYPE, default=DEFAULT_STORAGE_TYPE): vol.In(
                        [STORAGE_TYPE_FILE, STORAGE_TYPE_INPUT_TEXT]
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
                # Update the configuration
                return self.async_create_entry(
                    title="",
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

        # Show form
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ACCOUNTS, default=current_accounts): str,
                    vol.Required(CONF_STORAGE_TYPE, default=current_storage_type): vol.In(
                        [STORAGE_TYPE_FILE, STORAGE_TYPE_INPUT_TEXT]
                    ),
                }
            ),
            errors=errors,
        )
