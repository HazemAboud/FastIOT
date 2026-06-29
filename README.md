# FastIOT

**Presentation:** https://youtu.be/Ew-vjJqzfY8

FastIOT is a full-stack IoT monitoring platform with real-time sensor visualization, threshold-based labeling, actuator control, configuration management, AI-powered analysis, and device health monitoring — all from a web dashboard. Sensor nodes publish telemetry over MQTT to an embedded broker; the backend stores readings in MySQL, streams them to the dashboard via WebSocket, and exposes REST endpoints for management, threshold sync, and config control.

---

## Architecture

```
┌──────────────┐     MQTT      ┌──────────────┐     HTTP/WS     ┌──────────────┐
│   Devices    │ ◀──────────▶ │   Backend    │ ◀─────────────  │   Frontend   │
│  (ESP32,etc) │               │  FastAPI/Py  │                 │  React SPA   │
│              │ ◀── HTTP ───  │ + MySQL DB  │                 │              │
└──────────────┘               └──────────────┘                 └──────────────┘
```

Devices push readings and receive commands over MQTT. An embedded broker (amqtt) runs inside the backend. The backend stores everything in MySQL and pushes live updates to the dashboard over WebSocket. A separate HTTP channel lets the dashboard read and write device config and thresholds directly.

---

## Features

### Real-Time Monitoring
Pick a controller and watch its sensor values stream in over WebSocket. Each sensor shows as a card with value, unit, type badge, and timestamp. Toggle between the raw number and the threshold label (e.g. "Comfortable"). A live chart per sensor tracks the last 80 readings. Start and stop the subscription as needed.
<img width="1899" height="866" alt="{48519FDC-63C2-46E8-AA06-95FDB711F45A}" src="https://github.com/user-attachments/assets/79b44b32-9214-477a-a66d-30689e25c391" />

### Historical Data
Load past readings per sensor. The dashboard shows averages, standard deviation, and sample count, and a  line chart.
<img width="1901" height="878" alt="{88D33BDC-380A-4CC5-946C-FF80BEDC8E6B}" src="https://github.com/user-attachments/assets/18b2dcae-7c3c-4f55-ac0e-0e89f93f541a" />

### Actuator Control
All actuator-type devices for a controller are listed here. Flip switch actuators ON/OFF over MQTT. Continuous actuators get a numeric input with a Send button. The retained MQTT value is read when you open the tab.
<img width="1920" height="870" alt="{5766FCED-6848-4918-B968-B11DB7DC826D}" src="https://github.com/user-attachments/assets/b657aa03-a0af-424c-886d-6e3a02f4be8e" />

### Health Monitoring
Devices are color-coded by last-seen time: green under 5 minutes, yellow under 30, red beyond 30, gray if never seen. The table shows each device's status, last value, and last reading time. Auto-refreshes every 10 seconds.
<img width="1920" height="869" alt="{E914E6C2-A1A6-4D3A-BF4F-751C1917DF63}" src="https://github.com/user-attachments/assets/4fdd0a8a-bde3-492a-8765-ff19e28c15c1" />

### AI Insights
The last 30 readings go to a local Ollama model. It returns a status classification (Normal, Caution, Danger, Critical) with recommendations. You can also ask a free-form question about the data.
<img width="1903" height="873" alt="{18624E0F-DD9F-4B67-BD5B-3E803E13712D}" src="https://github.com/user-attachments/assets/8a0ddf49-fdaa-4931-8aaa-d77a6f0d6eb3" />

### Controllers and Devices
Register hardware nodes with a name, MQTT topic prefix, description, and optional image. Each controller holds multiple devices — sensors and actuators — each with a name, type, and unit. Everything can be created, edited, or deleted; deleting a controller removes its devices and data too.
<img width="1918" height="871" alt="{1CD34794-F392-41CC-AC98-808107B415A9}" src="https://github.com/user-attachments/assets/b0792296-6c04-4b4a-9793-e675fcbdafc7" />

### Configuration
Dynamic config entries live on each controller and are read/written over HTTP. The UI picks the right control based on `possible_values`:
- Empty or `["field"]` → text input
- Two values → toggle switch
- Three or more → labeled slider

Changes forward to the device automatically. Entries can be added with a name, read/update routes, HTTP method, and allowed values. Refresh individual entries or pull them all from the device.
<img width="1919" height="865" alt="{98E38896-9399-4AE9-BB8B-CFC3CF1A5F5F}" src="https://github.com/user-attachments/assets/95387132-26a5-42c3-84f2-ced05d7e447d" />


### Thresholds
Thresholds are named ranges for sensor values, stored on the device with routes for editing and reading (e.g. `"label,min,max;..."`). The dashboard fetches them via HTTP GET, lets you edit the ranges, and pushes the result back via the HTTP accepted by the HTTP server's respective route. No re-flashing needed.
<img width="1920" height="870" alt="{E63477A3-C653-4B66-A067-CC60F13598D9}" src="https://github.com/user-attachments/assets/7cf409ce-a1cd-4609-88f0-3d026e662ce6" />

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
<img width="1215" height="306" alt="{4F1131B6-3E01-4B5B-BB7B-F952BC5805CB}" src="https://github.com/user-attachments/assets/7d49cb58-35ca-41e4-81e1-1585f58c3195" />

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
<img width="975" height="444" alt="image" src="https://github.com/user-attachments/assets/65543401-64cb-42b9-bff1-408f56e2ce17" />


### Normal Operation

Once connected, the ESP32 reads all sensors on a configurable interval and publishes retained JSON messages to `{topic}/{sensor_name}`. It subscribes to actuator and config topics for remote commands. An HTTP server lets the dashboard read and write thresholds and config settings directly. The OLED shows sensor values (or threshold labels like "Comfortable" when ranges are configured). The buzzer fires automatically when gas readings hit the highest threshold manual MQTT override lasts 30 seconds. The display sleeps after inactivity and wakes on touch.
<img width="1706" height="1279" alt="3190ffa8168d8310c2056d92099d012" src="https://github.com/user-attachments/assets/4b071dcf-68c7-4048-9787-478768aefcca" />

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
