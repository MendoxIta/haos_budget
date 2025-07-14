"""Helper functions for Budget Tracker frontend integration and real-time updates."""
import logging
import json
import voluptuous as vol
from datetime import datetime
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

_LOGGER = logging.getLogger(__name__)

async def setup_frontend_integration(hass: HomeAssistant):
    """Set up websocket API and real-time updates for Budget Tracker."""
    
    # Register websocket commands
    websocket_api.async_register_command(hass, websocket_subscribe_budget_tracker_updates)
    
    # Return success
    return True

@callback
@websocket_api.websocket_command({
    vol.Required("type"): "budget_tracker/subscribe_updates",
})
def websocket_subscribe_budget_tracker_updates(hass, connection, msg):
    """Handle subscription to budget tracker updates."""
    
    @callback
    def forward_budget_tracker_events(event):
        """Forward budget_tracker events to websocket."""
        connection.send_message(websocket_api.event_message(
            msg["id"], {"event": event.event_type, "data": event.data}
        ))
    
    # Subscribe to relevant events
    remove_budget_data_updated = hass.bus.async_listen(
        "budget_tracker_data_updated", forward_budget_tracker_events
    )
    remove_budget_month_changed = hass.bus.async_listen(
        "budget_tracker_month_changed", forward_budget_tracker_events
    )
    
    # Clean up subscriptions when connection is closed
    connection.subscriptions[msg["id"]] = lambda: [
        remove_budget_data_updated(), 
        remove_budget_month_changed()
    ]
    
    connection.send_message(websocket_api.result_message(msg["id"]))

def notify_frontend(hass, event_type, data=None):
    """Fire an event to notify frontend components."""
    if data is None:
        data = {}
    
    # Add timestamp to data
    data["timestamp"] = datetime.now().isoformat()
    
    # Fire event on the event bus
    hass.bus.async_fire(event_type, data)
    _LOGGER.debug("Fired %s event: %s", event_type, data)
