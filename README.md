# FastIOT

**Presentation:** https://youtu.be/Ew-vjJqzfY8

FastIOT is a full-stack IoT monitoring platform with real-time sensor visualization, threshold-based labeling, actuator control, configuration management, AI-powered analysis, and device health monitoring — all from a web dashboard. Sensor nodes publish telemetry over MQTT to an embedded broker; the backend stores readings in MySQL, streams them to the dashboard via WebSocket, and exposes REST endpoints for management, threshold sync, and config control.

---

## Architecture

```
┌──────────────┐     MQTT      ┌──────────────┐     HTTP/WS     ┌──────────────┐
│   Devices    │ ──────────▶   │   Backend    │ ◀─────────────  │   Frontend   │
│  (ESP32,etc) │               │  FastAPI/Py  │                 │  React SPA   │
│              │ ◀── HTTP ───  │  + MySQL DB  │                 │              │
└──────────────┘               └──────────────┘                 └──────────────┘
```

Devices push readings and receive commands over MQTT. An embedded broker (amqtt) runs inside the backend. The backend stores everything in MySQL and pushes live updates to the dashboard over WebSocket. A separate HTTP channel lets the dashboard read and write device config and thresholds directly.

---

## Features

### Real-Time Monitoring
Pick a controller and watch its sensor values stream in over WebSocket. Each sensor shows as a card with value, unit, type badge, and timestamp. Toggle between the raw number and the threshold label (e.g. "Comfortable"). A live chart per sensor tracks the last 80 readings. Start and stop the subscription as needed.

### Historical Data
Load past readings per sensor. The dashboard shows averages, standard deviation, and sample count, and a  line chart.

### Actuator Control
All actuator-type devices for a controller are listed here. Flip switch actuators ON/OFF over MQTT. Continuous actuators get a numeric input with a Send button. The retained MQTT value is read when you open the tab.

### Health Monitoring
Devices are color-coded by last-seen time: green under 5 minutes, yellow under 30, red beyond 30, gray if never seen. The table shows each device's status, last value, and last reading time. Auto-refreshes every 10 seconds.

### AI Insights
The last 30 readings go to a local Ollama model. It returns a status classification (Normal, Caution, Danger, Critical) with 2–5 recommendations. You can also ask a free-form question about the data.

### Controllers and Devices
Register hardware nodes with a name, MQTT topic prefix, description, and optional image. Each controller holds multiple devices — sensors and actuators — each with a name, type, and unit. Everything can be created, edited, or deleted; deleting a controller removes its devices and data too.

### Configuration
Dynamic config entries live on each controller and are read/written over HTTP. The UI picks the right control based on `possible_values`:
- Empty or `["field"]` → text input
- Two values → toggle switch
- Three or more → labeled slider

Changes forward to the device automatically. Entries can be added with a name, read/update routes, HTTP method, and allowed values. Refresh individual entries or pull them all from the device.

### Thresholds
Thresholds are named ranges for sensor values, stored on the device as compact strings (`"label,min,max;..."`). The dashboard fetches them via HTTP GET, lets you edit the ranges, and pushes the result back via HTTP PUT. No re-flashing needed.

### User Management
Accounts use email and password with UUID sessions that expire after 7 days. Users can change their password or delete their account.

---

## Database (MySQL)

| Table | Purpose |
|---|---|
| `users` | Account credentials and registration metadata |
| `sessions` | UUID-based auth tokens with 7-day expiry |
| `controllers` | Registered hardware nodes with MQTT topic prefix |
| `devices` | Sensors and actuators under a controller |
| `device_data` | Time-series readings (float, string, timestamp) |
| `configs` | Dynamic config entries with possible values and HTTP routes |
| `thresholds` | Named ranges per device (label, min, max) |

---

## Hardware: ESP32 Sensor Node

The firmware at `esp/FastIOT/` is a complete reference implementation showing how a microcontroller connects to FastIOT.

### Components

- **ESP32** — WiFi-enabled microcontroller (Arduino framework)
- **DHT11** — temperature and humidity
- **MQ-2** — gas/smoke detection
- **LDR** — ambient light via ADC
- **Capacitive touch** — touch input
- **SSD1306 OLED** — on-device display
- **Buzzer** — alert output

### Initialization

On first boot (or factory reset), the ESP32 starts a captive portal AP called `FastIOT-Setup`. Connect to it, submit WiFi credentials and the MQTT broker IP, and the device saves everything to NVS and reboots.

### Normal Operation

Once connected, the ESP32 reads all sensors on a configurable interval and publishes retained JSON messages to `{topic}/{sensor_name}`. It subscribes to actuator and config topics for remote commands. An HTTP server lets the dashboard read and write thresholds and config settings directly. The OLED shows sensor values (or threshold labels like "Comfortable" when ranges are configured). The buzzer fires automatically when gas readings hit the highest threshold manual MQTT override lasts 30 seconds. The display sleeps after inactivity and wakes on touch.

### Thresholds and Config

Thresholds live in NVS as `"label,min,max;..."` strings. The dashboard fetches them over HTTP, lets you edit them, and pushes the result back. Same mechanism covers config values like reading interval and screen timeout. All without re-flashing.

---

## Running

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn run:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

Configure `.env` with MySQL connection, MQTT host/port, and an optional Ollama endpoint for AI insights.
