#include <WiFi.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>
#include <ESPmDNS.h>

// ─── Pin Definitions ───
#define DHTPIN          4
#define DHTTYPE         DHT11
#define TOUCH_PIN       15
#define LDR_PIN         34
#define MQ2_PIN         32
#define BUZZER_PIN      18
#define OLED_RESET      -1
#define FACTORY_RESET_PIN 0

// ─── Defaults ───
#define DEFAULT_BROKER    "10.186.208.37"
#define DEFAULT_PORT      1883
#define DEFAULT_TOPIC     "fastiot/esp32"
#define DEFAULT_MULTIPLIER 1.0
#define DEFAULT_SCREEN_TO 10000
#define BASE_INTERVAL     5000

// ─── Gas alarm thresholds ───
#define GAS_ALARM_ON   3000
#define GAS_ALARM_OFF  2000

// ─── Globals ───
Preferences prefs;
DNSServer dns;
WebServer server(80);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
Adafruit_SSD1306 display(128, 64, &Wire, OLED_RESET);
DHT dht(DHTPIN, DHTTYPE);

// ─── Config (loaded from Preferences) ───
String wifiSsid        = "";
String wifiPass        = "";
String mqttBroker      = DEFAULT_BROKER;
int    mqttPort        = DEFAULT_PORT;
String mqttTopic       = DEFAULT_TOPIC;
float  intervalMult    = DEFAULT_MULTIPLIER;
int    screenTimeout   = DEFAULT_SCREEN_TO;
bool   configValid     = false;

// ─── Runtime State ───
unsigned long lastPublish   = 0;
unsigned long lastScreenOn  = 0;
unsigned long lastTouch     = 0;
bool          screenOn      = false;
bool          buzzerState   = false;
bool          configPortal  = false;
bool          buzzerManualOverride = false;
unsigned long buzzerOverrideUntil  = 0;

float temperature   = NAN;
float humidity      = NAN;
int   lightLevel    = 0;
int   gasLevel      = 0;
int   touchValue    = 4095;

// ─── Config key constants ───
const char* NS           = "fastiot";
const char* KEY_SSID     = "wifiSsid";
const char* KEY_PASS     = "wifiPass";
const char* KEY_BROKER   = "mqttBroker";
const char* KEY_PORT     = "mqttPort";
const char* KEY_TOPIC    = "mqttTopic";
const char* KEY_MULT     = "intervalMult";
const char* KEY_SCR_TO   = "screenTo";
const char* KEY_CONFIG   = "configValid";

// ─── Threshold key constants ───
const char* KEY_THRESH_TEMP  = "thresh_temp";
const char* KEY_THRESH_HUM   = "thresh_hum";
const char* KEY_THRESH_LIGHT = "thresh_light";
const char* KEY_THRESH_GAS   = "thresh_gas";
const char* THRESH_SENSORS[] = {"temperature", "humidity", "light", "gas"};
const int   THRESH_SENSOR_COUNT = 4;
const char* DEFAULT_THRESHOLDS[] = {
  "Comfortable,20,30;Cold,,20;Hot,30,",
  "Normal,40,70;Low,,40;High,70,",
  "Normal,500,2000;Dark,,500;Bright,2000,",
  "Safe,0,3000;Warning,3000,5000;Dangerous,5000,"
};
String threshData[4];

// ─── Forward Declarations ───
void saveConfig();
void loadConfig();
void clearConfig();
void startConfigPortal();
void connectWiFi();
void connectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void publishSensors();
void readSensors();
void updateDisplay();
void handleTouch();
void checkBuzzer();
String sensorTopic(const char* name);
void loadThresholds();
String getThresholdData(const String& sensor);
void saveThresholdData(const String& sensor, const String& data);
String formatThresholdsJson(const String& raw);


// ═══════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(FACTORY_RESET_PIN, INPUT_PULLUP);
  randomSeed(analogRead(34));

  dht.begin();
  prefs.begin(NS, false);

  // Factory reset if button 0 held at boot
  if (digitalRead(FACTORY_RESET_PIN) == LOW) {
    Serial.println("Factory reset triggered");
    clearConfig();
  }

  loadConfig();
  loadThresholds();

  if (!configValid) {
    startConfigPortal();
    return;
  }

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED init failed");
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("FastIOT");
    display.println("Connecting...");
    display.display();
    screenOn = true;
    lastScreenOn = millis();
  }

  connectWiFi();
  startHttpServer();
  mqtt.setServer(mqttBroker.c_str(), mqttPort);
  mqtt.setCallback(mqttCallback);
}

// ═══════════════════════════════════════════════
//  Loop
// ═══════════════════════════════════════════════
void loop() {
  if (configPortal) {
    dns.processNextRequest();
    server.handleClient();
    return;
  }

  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();
  server.handleClient();

  unsigned long now = millis();
  handleTouch();

  if (screenTimeout >= 0 && screenOn && now - lastScreenOn > (unsigned long)screenTimeout) {
    display.clearDisplay();
    display.display();
    screenOn = false;
  }

  unsigned long effectiveInterval = (unsigned long)(BASE_INTERVAL * intervalMult);
  if (now - lastPublish >= effectiveInterval) {
    lastPublish = now;
    readSensors();
    publishSensors();
    if (screenOn) updateDisplay();
  }

  checkBuzzer();
}

// ═══════════════════════════════════════════════
//  Preferences (NVS) — Config Persistence
// ═══════════════════════════════════════════════
void saveConfig() {
  prefs.putString(KEY_SSID,   wifiSsid);
  prefs.putString(KEY_PASS,   wifiPass);
  prefs.putString(KEY_BROKER, mqttBroker);
  prefs.putInt(KEY_PORT,      mqttPort);
  prefs.putString(KEY_TOPIC,  mqttTopic);
  prefs.putFloat(KEY_MULT,    intervalMult);
  prefs.putInt(KEY_SCR_TO,    screenTimeout);
  prefs.putBool(KEY_CONFIG,   true);
}

void loadConfig() {
  wifiSsid      = prefs.getString(KEY_SSID,   "");
  wifiPass      = prefs.getString(KEY_PASS,   "");
  mqttBroker    = prefs.getString(KEY_BROKER, DEFAULT_BROKER);
  mqttPort      = prefs.getInt(KEY_PORT,      DEFAULT_PORT);
  mqttTopic     = prefs.getString(KEY_TOPIC,  DEFAULT_TOPIC);
  intervalMult  = prefs.getFloat(KEY_MULT,    DEFAULT_MULTIPLIER);
  screenTimeout = prefs.getInt(KEY_SCR_TO,    DEFAULT_SCREEN_TO);
  configValid   = prefs.getBool(KEY_CONFIG,   false);
}

void clearConfig() {
  prefs.clear();
  prefs.end();
  delay(500);
  ESP.restart();
}

// ═══════════════════════════════════════════════
//  Captive Portal — Configuration Mode
// ═══════════════════════════════════════════════
void startConfigPortal() {
  configPortal = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP("FastIOT-Setup");

  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  dns.start(53, "*", apIP);

  server.on("/", []() {
    if (server.method() == HTTP_POST) {
      wifiSsid   = server.arg("ssid");
      wifiPass   = server.arg("pass");
      mqttBroker = server.arg("broker");
      if (server.arg("port") != "") mqttPort = server.arg("port").toInt();
      if (server.arg("topic") != "") mqttTopic = server.arg("topic");
      if (server.arg("mult")  != "") intervalMult = server.arg("mult").toFloat();
      if (server.arg("scrTo") != "") screenTimeout = server.arg("scrTo").toInt();

      if (wifiSsid.length() > 0 && mqttBroker.length() > 0) {
        configValid = true;
        saveConfig();
        server.send(200, "text/html",
          "<html><body style='font-family:sans-serif;text-align:center;padding:2rem;'>"
          "<h2>Configuration Saved!</h2>"
          "<p>Device will reboot and connect. Close this page.</p>"
          "</body></html>");
        delay(2000);
        ESP.restart();
      } else {
        server.send(200, "text/html", htmlPage());
      }
    } else {
      server.send(200, "text/html", htmlPage());
    }
  });

  // Captive portal catch-all — serve config page on any URL
  server.onNotFound([]() {
    server.send(200, "text/html", htmlPage());
  });

  server.begin();
  Serial.println("Config portal started at 192.168.4.1");
}

const char* htmlPage() {
  return R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FastIOT — ESP32 Setup</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#f0f4f8;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:12px;padding:2rem;width:100%;max-width:440px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  h1{font-size:1.5rem;color:#1a202c;margin-bottom:.25rem}
  .sub{color:#718096;font-size:.85rem;margin-bottom:1.5rem}
  label{display:block;font-size:.8rem;font-weight:600;color:#4a5568;margin-bottom:.35rem}
  input,select{width:100%;padding:.65rem .75rem;border:1px solid #e2e8f0;border-radius:8px;
               font-size:.9rem;background:#f7fafc;margin-bottom:1rem}
  input:focus{outline:none;border-color:#3182ce;box-shadow:0 0 0 3px rgba(49,130,206,.15)}
  .row{display:flex;gap:.75rem}
  .row > div{flex:1}
  h3{font-size:.85rem;color:#2d3748;margin-bottom:.5rem;margin-top:.5rem}
  button{width:100%;padding:.75rem;background:#3182ce;color:#fff;border:none;border-radius:8px;
         font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s}
  button:hover{background:#2b6cb0}
</style>
</head>
<body>
<div class="card">
  <h1>FastIOT</h1>
  <p class="sub">Configure your ESP32</p>
  <form method="POST" action="/">
    <h3>Wi-Fi</h3>
    <label>SSID</label>
    <input name="ssid" required placeholder="Your Wi-Fi name">
    <label>Password</label>
    <input name="pass" type="password" placeholder="Wi-Fi password">

    <h3>MQTT</h3>
    <label>Broker IP</label>
    <input name="broker" required placeholder="e.g. 192.168.1.100">
    <div class="row">
      <div><label>Port</label><input name="port" type="number" value="1883"></div>
      <div><label>Topic</label><input name="topic" placeholder="fastiot/esp32"></div>
    </div>

    <h3>Settings</h3>
    <div class="row">
      <div><label>Interval Multiplier</label><input name="mult" type="number" step="0.1" value="1.0"></div>
      <div><label>Screen Timeout (ms)</label><input name="scrTo" type="number" value="10000"></div>
    </div>
    <p style="font-size:.75rem;color:#a0aec0;margin-top:-.5rem;margin-bottom:1rem">
      Screen timeout: ms before display off. Set -1 for always on.
    </p>
    <button type="submit">Save &amp; Reboot</button>
  </form>
</div>
</body>
</html>
)rawliteral";
}

// ═══════════════════════════════════════════════
//  HTTP Config Endpoints (for FastIOT Configuration page)
// ═══════════════════════════════════════════════
String readBody() {
  String body = server.arg("plain");
  if (body.length() == 0) {
    for (int i = 0; i < server.args(); i++) {
      if (server.argName(i) == "value") {
        body = server.arg(i);
        break;
      }
    }
  }
  return body;
}

void startHttpServer() {
  // GET interval_multiplier
  server.on("/api/config/interval_multiplier", HTTP_GET, []() {
    server.send(200, "text/plain", String(intervalMult));
  });
  // PUT interval_multiplier
  server.on("/api/config/interval_multiplier", HTTP_PUT, []() {
    String val = readBody();
    if (val.length() > 0) {
      float m = val.toFloat();
      if (m > 0) {
        intervalMult = m;
        prefs.putFloat(KEY_MULT, intervalMult);
        server.send(200, "text/plain", String(intervalMult));
        return;
      }
    }
    server.send(400, "text/plain", "invalid");
  });

  // GET screen_timeout
  server.on("/api/config/screen_timeout", HTTP_GET, []() {
    server.send(200, "text/plain", String(screenTimeout));
  });
  // PUT screen_timeout
  server.on("/api/config/screen_timeout", HTTP_PUT, []() {
    String val = readBody();
    if (val.length() > 0) {
      screenTimeout = val.toInt();
      prefs.putInt(KEY_SCR_TO, screenTimeout);
      if (screenTimeout < 0) { screenOn = true; updateDisplay(); }
      server.send(200, "text/plain", String(screenTimeout));
      return;
    }
    server.send(400, "text/plain", "invalid");
  });

  // GET buzzer state
  server.on("/api/actuator/buzzer", HTTP_GET, []() {
    server.send(200, "text/plain", buzzerState ? "ON" : "OFF");
  });

  // ─── Threshold routes (catch-all) ───
  server.onNotFound([]() {
    String uri = server.uri();
    if (uri.startsWith("/api/threshold/")) {
      String sensor = uri.substring(15);
      if (server.method() == HTTP_GET) {
        String data = getThresholdData(sensor);
        if (data.length() > 0) {
          server.send(200, "application/json", formatThresholdsJson(data));
        } else {
          server.send(404, "text/plain", "unknown sensor");
        }
      } else if (server.method() == HTTP_PUT) {
        String body = readBody();
        if (body.length() > 0) {
          saveThresholdData(sensor, body);
          server.send(200, "application/json", formatThresholdsJson(body));
        } else {
          server.send(400, "text/plain", "invalid");
        }
      } else {
        server.send(405, "text/plain", "Method Not Allowed");
      }
    } else {
      server.send(404, "text/plain", "Not Found");
    }
  });

  server.begin();
  Serial.print("HTTP server started at http://");
  Serial.println(WiFi.localIP());
}

// ═══════════════════════════════════════════════
//  WiFi + MQTT
// ═══════════════════════════════════════════════
void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nWiFi failed, starting config portal");
    startConfigPortal();
    return;
  }
  Serial.println("\nWiFi connected");
  Serial.print("SSID: ");
  Serial.println(WiFi.SSID());
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("Gateway: ");
  Serial.println(WiFi.gatewayIP());
  Serial.print("Subnet: ");
  Serial.println(WiFi.subnetMask());
  Serial.print("Broker: ");
  Serial.print(mqttBroker);
  Serial.print(":");
  Serial.println(mqttPort);

  Serial.print("Testing TCP to broker... ");
  WiFiClient testClient;
  IPAddress brokerIP;
  if (brokerIP.fromString(mqttBroker)) {
    if (testClient.connect(brokerIP, mqttPort, 2000)) {
      Serial.println("OK (port open)");
      testClient.stop();
    } else {
      Serial.println("FAIL (connection refused or timeout)");
    }
  } else {
    Serial.println("FAIL (invalid IP string)");
  }

  if (MDNS.begin("fastiot-esp32")) {
    Serial.println("mDNS: fastiot-esp32.local");
  }
}

const char* mqttStateName(int state) {
  switch (state) {
    case -4: return "CONNECTION_TIMEOUT";
    case -3: return "CONNECTION_LOST";
    case -2: return "CONNECT_FAILED";
    case -1: return "DISCONNECTED";
    case 0:  return "CONNECTED";
    case 1:  return "CONNECT_BAD_PROTOCOL";
    case 2:  return "CONNECT_BAD_CLIENT_ID";
    case 3:  return "CONNECT_UNAVAILABLE";
    case 4:  return "CONNECT_BAD_CREDENTIALS";
    case 5:  return "CONNECT_UNAUTHORIZED";
    default: return "UNKNOWN";
  }
}

void connectMQTT() {
  int attempts = 0;
  while (!mqtt.connected() && attempts < 20) {
    Serial.print("Connecting MQTT...");
    String clientId = "FastIOT-" + String(random(0xFFFF), HEX);
    Serial.print(" clientId=");
    Serial.print(clientId);
    Serial.print(" broker=");
    Serial.print(mqttBroker);
    Serial.print(":");
    Serial.println(mqttPort);

    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" connected!");

      // Subscribe to device topics
      mqtt.subscribe(sensorTopic("buzzer").c_str());
      // Subscribe to config topics
      mqtt.subscribe(sensorTopic("config/interval_multiplier").c_str());
      mqtt.subscribe(sensorTopic("config/screen_timeout").c_str());
      mqtt.subscribe(sensorTopic("config/reset").c_str());

      mqtt.publish(sensorTopic("status").c_str(), "online", true);
    } else {
      int rc = mqtt.state();
      Serial.print(" failed, rc=");
      Serial.print(rc);
      Serial.print(" (");
      Serial.print(mqttStateName(rc));
      Serial.println(")");

      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WARNING: WiFi disconnected!");
      } else {
        Serial.print("WiFi OK, signal=");
        Serial.println(WiFi.RSSI());
      }

      attempts++;
      delay(3000);
    }
  }
  if (!mqtt.connected()) {
    Serial.println("MQTT failed after 20 attempts");
  }
}

// ═══════════════════════════════════════════════
//  MQTT Helpers
// ═══════════════════════════════════════════════
String sensorTopic(const char* name) {
  return mqttTopic + "/" + name;
}

// ═══════════════════════════════════════════════
//  MQTT Callback
// ═══════════════════════════════════════════════
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  char msg[length + 1];
  memcpy(msg, payload, length);
  msg[length] = '\0';
  String value = String(msg);
  value.trim();
  String t = String(topic);

  Serial.printf("MQTT: %s -> %s\n", topic, value.c_str());

  // ─── Actuator: Buzzer ───
  if (t.equals(sensorTopic("buzzer"))) {
    buzzerState = (value == "ON" || value == "1");
    digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    wakeScreen();
    buzzerManualOverride = true;
    buzzerOverrideUntil = millis() + 30000;
    return;
  }

  // ─── Config: Interval Multiplier ───
  if (t.equals(sensorTopic("config/interval_multiplier"))) {
    float m = value.toFloat();
    if (m > 0) {
      intervalMult = m;
      prefs.putFloat(KEY_MULT, intervalMult);
      Serial.printf("Interval multiplier set to %.1f\n", intervalMult);
      mqtt.publish(sensorTopic("config/interval_multiplier").c_str(), String(intervalMult).c_str(), true);
    }
    return;
  }

  // ─── Config: Screen Timeout ───
  if (t.equals(sensorTopic("config/screen_timeout"))) {
    int to = value.toInt();
    screenTimeout = to;
    prefs.putInt(KEY_SCR_TO, screenTimeout);
    Serial.printf("Screen timeout set to %d ms\n", screenTimeout);
    mqtt.publish(sensorTopic("config/screen_timeout").c_str(), String(screenTimeout).c_str(), true);
    if (screenTimeout < 0) { screenOn = true; updateDisplay(); }
    return;
  }

  // ─── Config: Factory Reset ───
  if (t.equals(sensorTopic("config/reset"))) {
    if (value == "1" || value == "ON") {
      mqtt.publish(sensorTopic("status").c_str(), "resetting", true);
      delay(500);
      clearConfig();
    }
    return;
  }
}

// ═══════════════════════════════════════════════
//  Sensors
// ═══════════════════════════════════════════════
void readSensors() {
  temperature = dht.readTemperature();
  humidity    = dht.readHumidity();
  lightLevel  = analogRead(LDR_PIN);
  gasLevel    = analogRead(MQ2_PIN);

  if (isnan(temperature)) temperature = NAN;
  if (isnan(humidity))    humidity    = NAN;

  Serial.printf("Temp: %.1f  Hum: %.1f  Light: %d  Gas: %d  Touch: %d\n",
                temperature, humidity, lightLevel, gasLevel, touchValue);
}

void publishSensors() {
  if (!isnan(temperature))
    mqtt.publish(sensorTopic("temperature").c_str(), String(temperature).c_str(), true);
  if (!isnan(humidity))
    mqtt.publish(sensorTopic("humidity").c_str(), String(humidity).c_str(), true);
  mqtt.publish(sensorTopic("light").c_str(), String(lightLevel).c_str(), true);
  mqtt.publish(sensorTopic("gas").c_str(), String(gasLevel).c_str(), true);

  bool touched = touchValue < 1500;
  mqtt.publish(sensorTopic("touch").c_str(), touched ? "1" : "0", true);
}

// ═══════════════════════════════════════════════
//  Touch / Screen
// ═══════════════════════════════════════════════
void handleTouch() {
  touchValue = touchRead(TOUCH_PIN);
  unsigned long now = millis();
  if (touchValue < 1000 && now - lastTouch > 1000) {
    lastTouch = now;
    wakeScreen();
  }
}

void wakeScreen() {
  lastScreenOn = millis();
  if (!screenOn) {
    screenOn = true;
    updateDisplay();
  }
}

String getThresholdLabel(int idx, float val) {
  String raw = threshData[idx];
  if (raw.length() == 0) return "";
  int start = 0;
  while (start < (int)raw.length()) {
    int end = raw.indexOf(';', start);
    if (end < 0) end = raw.length();
    String entry = raw.substring(start, end);
    int c1 = entry.indexOf(',');
    int c2 = entry.indexOf(',', c1 + 1);
    String lbl = entry.substring(0, c1);
    String minStr = entry.substring(c1 + 1, c2);
    String maxStr = entry.substring(c2 + 1);
    bool match = true;
    if (minStr.length() > 0) { if (val < minStr.toFloat()) match = false; }
    if (maxStr.length() > 0) { if (val > maxStr.toFloat()) match = false; }
    if (match) return lbl;
    start = end + 1;
  }
  return "";
}

void updateDisplay() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println("FastIOT");
  display.println("------------");
  display.print("Temp: ");
  if (!isnan(temperature)) { String lbl = getThresholdLabel(0, temperature); if (lbl.length() > 0) display.println(lbl); else { display.print(temperature, 1); display.println(" C"); } }
  else display.println("--");
  display.print("Hum:  ");
  if (!isnan(humidity)) { String lbl = getThresholdLabel(1, humidity); if (lbl.length() > 0) display.println(lbl); else { display.print(humidity, 1); display.println(" %"); } }
  else display.println("--");
  display.print("Light: ");
  { String lbl = getThresholdLabel(2, lightLevel); if (lbl.length() > 0) display.println(lbl); else display.println(lightLevel); }
  display.print("Gas:  ");
  { String lbl = getThresholdLabel(3, gasLevel); if (lbl.length() > 0) display.println(lbl); else display.println(gasLevel); }
  display.print("Mult: ");  display.println(intervalMult);
  display.display();
}

// ═══════════════════════════════════════════════
//  Buzzer — Gas alarm with hysteresis
// ═══════════════════════════════════════════════
void checkBuzzer() {
  if (buzzerManualOverride) {
    if (millis() >= buzzerOverrideUntil) {
      buzzerManualOverride = false;
    } else {
      return;
    }
  }
  if (gasLevel > GAS_ALARM_ON && !buzzerState) {
    buzzerState = true;
    digitalWrite(BUZZER_PIN, HIGH);
    mqtt.publish(sensorTopic("buzzer").c_str(), "ON", true);
  } else if (gasLevel < GAS_ALARM_OFF && buzzerState) {
    buzzerState = false;
    digitalWrite(BUZZER_PIN, LOW);
    mqtt.publish(sensorTopic("buzzer").c_str(), "OFF", true);
  }
}

// ═══════════════════════════════════════════════
//  Threshold — NVS persistence and HTTP API
// ═══════════════════════════════════════════════
void loadThresholds() {
  const char* keys[] = {KEY_THRESH_TEMP, KEY_THRESH_HUM, KEY_THRESH_LIGHT, KEY_THRESH_GAS};
  for (int i = 0; i < THRESH_SENSOR_COUNT; i++) {
    threshData[i] = prefs.getString(keys[i], "");
    if (threshData[i].length() == 0) {
      threshData[i] = DEFAULT_THRESHOLDS[i];
      prefs.putString(keys[i], threshData[i]);
    }
  }
}

String getThresholdData(const String& sensor) {
  for (int i = 0; i < THRESH_SENSOR_COUNT; i++) {
    if (sensor == THRESH_SENSORS[i]) {
      return threshData[i];
    }
  }
  return "";
}

void saveThresholdData(const String& sensor, const String& data) {
  const char* keys[] = {KEY_THRESH_TEMP, KEY_THRESH_HUM, KEY_THRESH_LIGHT, KEY_THRESH_GAS};
  for (int i = 0; i < THRESH_SENSOR_COUNT; i++) {
    if (sensor == THRESH_SENSORS[i]) {
      threshData[i] = data;
      prefs.putString(keys[i], data);
      return;
    }
  }
}

String formatThresholdsJson(const String& raw) {
  // raw: "label1,min1,max1;label2,min2,max2"
  // returns: [{"label":"...","min":null|N,"max":null|N},...]
  String json = "[";
  int start = 0;
  bool first = true;
  while (start < (int)raw.length()) {
    int end = raw.indexOf(';', start);
    if (end < 0) end = raw.length();
    String entry = raw.substring(start, end);
    int c1 = entry.indexOf(',');
    int c2 = entry.indexOf(',', c1 + 1);
    String label = entry.substring(0, c1);
    String minStr = entry.substring(c1 + 1, c2);
    String maxStr = entry.substring(c2 + 1);
    if (!first) json += ",";
    first = false;
    json += "{\"label\":\"" + label + "\"";
    if (minStr.length() > 0) json += ",\"min\":" + minStr;
    else json += ",\"min\":null";
    if (maxStr.length() > 0) json += ",\"max\":" + maxStr;
    else json += ",\"max\":null";
    json += "}";
    start = end + 1;
  }
  json += "]";
  return json;
}
