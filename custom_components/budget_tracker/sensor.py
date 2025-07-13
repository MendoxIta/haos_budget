"""Sensor platform for Budget Tracker integration."""
from datetime import datetime
import logging

from homeassistant.components.sensor import (
    SensorEntity,
    SensorStateClass,
    SensorDeviceClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CURRENCY_EURO
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.typing import StateType, DiscoveryInfoType

from .const import (
    DOMAIN,
    NAME,
    VERSION,
    CONF_ACCOUNTS,
    INCOME_SENSOR,
    EXPENSES_SENSOR,
    BALANCE_SENSOR,
    ATTR_INCOME,
    ATTR_EXPENSES,
    ATTR_BALANCE,
    ATTR_MONTH,
    ATTR_YEAR,
    ATTR_ITEMS,
    ATTR_RECURRING,
)

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Budget Tracker sensors."""
    accounts = entry.data.get(CONF_ACCOUNTS, ["default"])
    
    entities = []
    for account in accounts:
        # Current month sensors
        entities.extend([
            IncomeSensor(hass, entry, account),
            ExpensesSensor(hass, entry, account),
            BalanceSensor(hass, entry, account),
        ])
        
        # Create historical sensors for existing data
        account_data = hass.data[DOMAIN][entry.entry_id]["data"].get(account, {})
        history = account_data.get("history", {})
        
        for year_month, data in history.items():
            try:
                year, month = year_month.split("_")
                entities.extend([
                    HistoricalIncomeSensor(hass, entry, account, int(year), int(month), data.get("income", 0)),
                    HistoricalExpensesSensor(hass, entry, account, int(year), int(month), data.get("expenses", 0)),
                    HistoricalBalanceSensor(hass, entry, account, int(year), int(month), data.get("balance", 0)),
                ])
            except (ValueError, AttributeError) as err:
                _LOGGER.error("Error creating historical sensors: %s", err)
    
    async_add_entities(entities)


class BudgetSensorBase(SensorEntity):
    """Base class for Budget Tracker sensors."""

    _attr_has_entity_name = True
    _attr_state_class = SensorStateClass.TOTAL

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str):
        """Initialize the sensor."""
        self.hass = hass
        self.entry = entry
        self.entry_id = entry.entry_id
        self.account = account
        
        # Device info
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{self.entry_id}_{self.account}")},
            name=f"{NAME} - {self.account.capitalize()}",
            manufacturer="Custom Component",
            model=f"{NAME} Sensor",
            sw_version=VERSION,
        )
        
        # Will be set by implementing classes
        self._attr_unique_id = None
        self._attr_name = None
        self._attr_icon = None
        
    async def async_added_to_hass(self) -> None:
        """Register callbacks."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                f"{DOMAIN}_data_updated_{self.entry_id}",
                self._handle_data_updated,
            )
        )

    @callback
    def _handle_data_updated(self) -> None:
        """Update the sensor when data changes."""
        self.async_write_ha_state()

    @property
    def account_data(self):
        """Get account data from integration data."""
        return self.hass.data[DOMAIN][self.entry_id]["data"].get(self.account, {})


class IncomeSensor(BudgetSensorBase):
    """Sensor for current month income."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY_EURO

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str):
        """Initialize the income sensor."""
        super().__init__(hass, entry, account)
        
        self._attr_unique_id = f"{DOMAIN}_{account}_{INCOME_SENSOR}"
        self._attr_name = "Income Current Month"
        self._attr_icon = "mdi:cash-plus"
        
    @property
    def native_value(self) -> StateType:
        """Return the current month income value."""
        return self.account_data.get(ATTR_INCOME, 0)
        
    @property
    def extra_state_attributes(self):
        """Return entity specific state attributes."""
        return {
            ATTR_ITEMS: self.account_data.get("income_items", []),
            ATTR_RECURRING: self.account_data.get("recurring_income", [])
        }


class ExpensesSensor(BudgetSensorBase):
    """Sensor for current month expenses."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY_EURO

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str):
        """Initialize the expenses sensor."""
        super().__init__(hass, entry, account)
        
        self._attr_unique_id = f"{DOMAIN}_{account}_{EXPENSES_SENSOR}"
        self._attr_name = "Expenses Current Month"
        self._attr_icon = "mdi:cash-minus"
        
    @property
    def native_value(self) -> StateType:
        """Return the current month expenses value."""
        return self.account_data.get(ATTR_EXPENSES, 0)
        
    @property
    def extra_state_attributes(self):
        """Return entity specific state attributes."""
        return {
            ATTR_ITEMS: self.account_data.get("expense_items", []),
            ATTR_RECURRING: self.account_data.get("recurring_expenses", [])
        }


class BalanceSensor(BudgetSensorBase):
    """Sensor for current month balance."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY_EURO

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str):
        """Initialize the balance sensor."""
        super().__init__(hass, entry, account)
        
        self._attr_unique_id = f"{DOMAIN}_{account}_{BALANCE_SENSOR}"
        self._attr_name = "Balance Current Month"
        self._attr_icon = "mdi:scale-balance"
        
    @property
    def native_value(self) -> StateType:
        """Return the current month balance value."""
        return self.account_data.get(ATTR_BALANCE, 0)


class HistoricalSensorBase(SensorEntity):
    """Base class for historical Budget Tracker sensors."""

    _attr_has_entity_name = True
    _attr_state_class = SensorStateClass.TOTAL
    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY_EURO
    
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str, year: int, month: int, value: float):
        """Initialize the historical sensor."""
        self.hass = hass
        self.entry = entry
        self.entry_id = entry.entry_id
        self.account = account
        self.year = year
        self.month = month
        self._value = value
        
        # Format month name for display
        month_name = datetime(year, month, 1).strftime("%B")
        
        # Device info
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{self.entry_id}_{self.account}_history")},
            name=f"{NAME} History - {self.account.capitalize()}",
            manufacturer="Custom Component",
            model=f"{NAME} Historical Data",
            sw_version=VERSION,
        )
        
        # Common attributes
        self._attr_extra_state_attributes = {
            ATTR_MONTH: month,
            ATTR_YEAR: year,
        }
        
        # Will be set by implementing classes
        self._attr_unique_id = None
        self._attr_name = None
        self._attr_icon = None
    
    @property
    def native_value(self) -> StateType:
        """Return the historical value."""
        return self._value


class HistoricalIncomeSensor(HistoricalSensorBase):
    """Sensor for historical month income."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str, year: int, month: int, value: float):
        """Initialize the historical income sensor."""
        super().__init__(hass, entry, account, year, month, value)
        
        month_name = datetime(year, month, 1).strftime("%B")
        
        self._attr_unique_id = f"{DOMAIN}_{account}_income_{year}_{month:02d}"
        self._attr_name = f"Income {month_name} {year}"
        self._attr_icon = "mdi:cash-plus"
        
        # Get historical income items if they exist
        year_month_key = f"{year}_{month:02d}"
        account_data = hass.data[DOMAIN][entry.entry_id]["data"].get(account, {})
        history = account_data.get("history", {})
        month_data = history.get(year_month_key, {})
        
        # Add income items to attributes if they exist
        if "income_items" in month_data:
            self._attr_extra_state_attributes[ATTR_ITEMS] = month_data["income_items"]


class HistoricalExpensesSensor(HistoricalSensorBase):
    """Sensor for historical month expenses."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str, year: int, month: int, value: float):
        """Initialize the historical expenses sensor."""
        super().__init__(hass, entry, account, year, month, value)
        
        month_name = datetime(year, month, 1).strftime("%B")
        
        self._attr_unique_id = f"{DOMAIN}_{account}_expenses_{year}_{month:02d}"
        self._attr_name = f"Expenses {month_name} {year}"
        self._attr_icon = "mdi:cash-minus"
        
        # Get historical expense items if they exist
        year_month_key = f"{year}_{month:02d}"
        account_data = hass.data[DOMAIN][entry.entry_id]["data"].get(account, {})
        history = account_data.get("history", {})
        month_data = history.get(year_month_key, {})
        
        # Add expense items to attributes if they exist
        if "expense_items" in month_data:
            self._attr_extra_state_attributes[ATTR_ITEMS] = month_data["expense_items"]


class HistoricalBalanceSensor(HistoricalSensorBase):
    """Sensor for historical month balance."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, account: str, year: int, month: int, value: float):
        """Initialize the historical balance sensor."""
        super().__init__(hass, entry, account, year, month, value)
        
        month_name = datetime(year, month, 1).strftime("%B")
        
        self._attr_unique_id = f"{DOMAIN}_{account}_balance_{year}_{month:02d}"
        self._attr_name = f"Balance {month_name} {year}"
        self._attr_icon = "mdi:scale-balance"
