"""Constants for the Budget Tracker integration."""
from datetime import timedelta

DOMAIN = "budget_tracker"
NAME = "Budget Tracker"
VERSION = "0.1.0"

# Configuration
CONF_ACCOUNTS = "accounts"
CONF_STORAGE_TYPE = "storage_type"

STORAGE_TYPE_FILE = "file"
STORAGE_TYPE_INPUT_TEXT = "input_text"

DEFAULT_STORAGE_TYPE = STORAGE_TYPE_FILE

# Services
SERVICE_SET_INCOME = "set_income"
SERVICE_SET_EXPENSES = "set_expenses"
SERVICE_RESET_MONTH = "reset_month"

# Attributes
ATTR_ACCOUNT = "account"
ATTR_AMOUNT = "amount"
ATTR_INCOME = "income"
ATTR_EXPENSES = "expenses"
ATTR_BALANCE = "balance"
ATTR_MONTH = "month"
ATTR_YEAR = "year"

# Sensor names
INCOME_SENSOR = "income_current_month"
EXPENSES_SENSOR = "expenses_current_month"
BALANCE_SENSOR = "balance_current_month"

# Update interval
SCAN_INTERVAL = timedelta(minutes=5)

# Data storage
DATA_STORAGE_FILE = "budget_tracker_data.json"

# Events
EVENT_MONTH_CHANGED = f"{DOMAIN}_month_changed"
