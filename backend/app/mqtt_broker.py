import logging
from amqtt.broker import Broker
from amqtt.contexts import BrokerConfig, ListenerConfig

logger = logging.getLogger(__name__)


class EmbeddedMQTTBroker:
    def __init__(self):
        self._broker: Broker | None = None

    async def start(self, host: str = "0.0.0.0", port: int = 1883):
        config = BrokerConfig(
            listeners={
                "default": ListenerConfig(
                    type="tcp",
                    bind=f"{host}:{port}",
                )
            },
        )
        self._broker = Broker(config)
        await self._broker.start()
        logger.info("Embedded MQTT broker started on %s:%s", host, port)

    async def stop(self):
        if self._broker:
            await self._broker.shutdown()
            self._broker = None
            logger.info("Embedded MQTT broker stopped")


embedded_broker = EmbeddedMQTTBroker()
