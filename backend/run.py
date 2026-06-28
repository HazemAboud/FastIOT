import logging
import uvicorn

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("amqtt.broker").setLevel(logging.WARNING)
logging.getLogger("amqtt.mqtt.protocol.broker_handler").setLevel(logging.WARNING)
logging.getLogger("amqtt.plugins.authentication").setLevel(logging.WARNING)

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
