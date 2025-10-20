"""Constants for the Budget Tracker integration."""
from datetime import timedelta

DOMAIN = "budget_tracker"
NAME = "Budget Tracker"
VERSION = "0.6.0"

# Configuration
CONF_ACCOUNTS = "accounts"
CONF_STORAGE_TYPE = "storage_type"

STORAGE_TYPE_FILE = "file"

DEFAULT_STORAGE_TYPE = STORAGE_TYPE_FILE

# Services
SERVICE_SET_INCOME = "set_income"
SERVICE_SET_EXPENSES = "set_expenses"
SERVICE_RESET_MONTH = "reset_month"
SERVICE_ADD_INCOME_ITEM = "add_income_item"
SERVICE_ADD_EXPENSE_ITEM = "add_expense_item"
SERVICE_REMOVE_ITEM = "remove_item"
SERVICE_ADD_RECURRING_INCOME = "add_recurring_income"
SERVICE_ADD_RECURRING_EXPENSE = "add_recurring_expense"
SERVICE_REMOVE_RECURRING_ITEM = "remove_recurring_item"
SERVICE_CLEAR_MONTH_ITEMS = "clear_month_items"

# Attributes
ATTR_ACCOUNT = "account"
ATTR_AMOUNT = "amount"
ATTR_INCOME = "income"
ATTR_EXPENSES = "expenses"
ATTR_BALANCE = "balance"
ATTR_MONTH = "month"
ATTR_YEAR = "year"
ATTR_DESCRIPTION = "description"
ATTR_ITEM_ID = "item_id"
ATTR_ITEMS_INCOME = "income_items"
ATTR_ITEMS_EXPENSE = "expense_items"
ATTR_CATEGORY = "category"
ATTR_RECURRING_INCOMES = "recurring_incomes"
ATTR_RECURRING_EXPENSES = "recurring_expenses"
ATTR_DAY_OF_MONTH = "day_of_month"
ATTR_END_DATE = "end_date"

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