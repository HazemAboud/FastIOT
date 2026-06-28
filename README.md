# FastIOT

**Presentation:** https://youtu.be/Ew-vjJqzfY8

FastIOT is a full-stack IoT monitoring platform with a Python/FastAPI backend, a React dashboard, and MQTT-based device communication. It provides real-time sensor visualization, threshold-based labeling, actuator control, config management, AI-powered insights, and health monitoring — all through a web interface.

## Architecture

```
┌──────────────┐     MQTT      ┌──────────────┐     HTTP/WS     ┌──────────────┐
│   Devices    │ ──────────▶   │   Backend    │ ◀─────────────  │   Frontend   │
│  (ESP32,etc) │               │  FastAPI/Py  │                 │  React SPA   │
│              │ ◀── HTTP ───  │  + MySQL DB  │                 │              │
└──────────────┘               └──────────────┘                 └──────────────┘
```

### Backend (Python/FastAPI, port 8000)
- **REST API** — CRUD for controllers, devices, thresholds, configs, users, sessions
- **MQTT service** — subscribes to device topics, stores readings in MySQL, broadcasts via WebSocket
- **Embedded MQTT broker** — runs inside the Python process (amqtt), no external broker needed
- **AI insights** — sends recent readings to a local Ollama model for status assessment and recommendations
- **Threshold sync/push** — fetches threshold definitions from devices via HTTP, pushes modifications back
- **Health monitoring** — tracks last-seen timestamps per device (healthy/warning/critical)

### Frontend (React/Vite, port 5173)
- **Dashboard** — real-time sensor cards with value/label toggle, live charts, historical data, health status
- **Devices page** — register/manage controllers and sensor/actuator devices
- **Threshold page** — edit threshold ranges, sync from device, push modifications to device
- **Configuration page** — dynamic controls (toggle switches, sliders, text inputs) for device settings
- **AI Insights tab** — ask questions about sensor data, get JSON-structured analysis
- **User management** — registration, login, password change, account deletion

### Database (MySQL)
Tables: `users`, `sessions`, `controllers`, `devices`, `device_data`, `configs`, `thresholds`

## Example: ESP32 Sensor Node

The ESP firmware (`esp/FastIOT/`) is a complete reference implementation that demonstrates how a microcontroller connects to FastIOT.

### Hardware
- **ESP32** — WiFi + MQTT communication
- **DHT11** — temperature & humidity (GPIO 4)
- **MQ-2** — gas/smoke sensor (GPIO 32)
- **LDR** — light level (GPIO 34, ADC)
- **Touch sensor** — capacitive touch (GPIO 15)
- **SSD1306 OLED** — 128x64 display (I2C, address 0x3C)
- **Buzzer** — alert output (GPIO 18)

### Setup Flow
1. On first boot, the ESP32 starts a captive portal AP (`FastIOT-Setup`)
2. User connects to the AP and submits WiFi credentials + MQTT broker IP
3. Device connects to WiFi, joins MQTT, and begins publishing sensor data
4. Data flows: `fastiot/{topic}/temperature`, `humidity`, `light`, `gas`, `touch`
5. The backend stores readings and forwards them to the dashboard in real time

### Threshold System
Thresholds are stored as compact strings in NVS: `"Safe,0,3000;Warning,3000,5000;Dangerous,5000,"`
- The dashboard can **fetch** thresholds from the device (HTTP GET → JSON)
- The dashboard can **push** modified thresholds back (HTTP PUT → compact string)
- The OLED displays threshold labels (e.g. "Comfortable") instead of raw values when available
- The gas buzzer auto-activates when readings fall into the highest threshold range

### Config Management
Config values like `interval_multiplier` and `screen_timeout` can be changed dynamically via MQTT or HTTP — no firmware re-flash needed.

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

Configure `.env` with MySQL connection, MQTT host/port, and optional Ollama endpoint.
