import os
import json
from ollama import AsyncClient


class AIService:
    def __init__(self):
        self.host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_MODEL", "gemma4eb")
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = AsyncClient(host=self.host)
        return self._client

    async def get_insight(self, prompt: str, device_context: list[dict] | None = None) -> dict:
        has_question = bool(prompt and prompt.strip())

        if has_question:
            system_prompt = (
                "You are an AI assistant for an IoT monitoring platform called FastIOT. "
                "You analyze historical sensor data from connected devices to assess room conditions. "
                "Always respond with valid JSON only, using this exact format:\n"
                '{\n'
                '  "status": "Normal|Caution|Danger|Critical",\n'
                '  "recommendations": ["recommendation 1", "recommendation 2", ...],\n'
                '  "answer": "Direct answer to the user\'s specific question"\n'
                '}\n'
                "Status meanings:\n"
                "- Normal: All readings within safe ranges.\n"
                "- Caution: Some readings slightly outside optimal ranges.\n"
                "- Danger: Several readings significantly outside safe ranges.\n"
                "- Critical: Immediate attention required.\n"
                "Provide 2-5 actionable recommendations to improve room conditions. "
                "The `answer` field must directly address the user's question."
            )
        else:
            system_prompt = (
                "You are an AI assistant for an IoT monitoring platform called FastIOT. "
                "You analyze historical sensor data from connected devices to assess room conditions. "
                "Always respond with valid JSON only, using this exact format:\n"
                '{\n'
                '  "status": "Normal|Caution|Danger|Critical",\n'
                '  "recommendations": ["recommendation 1", "recommendation 2", ...]\n'
                '}\n'
                "Status meanings:\n"
                "- Normal: All readings within safe ranges.\n"
                "- Caution: Some readings slightly outside optimal ranges.\n"
                "- Danger: Several readings significantly outside safe ranges.\n"
                "- Critical: Immediate attention required.\n"
                "Provide 2-5 actionable recommendations to improve room conditions. "
                "Do NOT include an `answer` field."
            )

        context = ""
        if device_context:
            context = "Here are the latest readings for each device (most recent first):\n"
            for d in device_context:
                name = d.get("name", "unknown")
                dtype = d.get("device_type", "unknown")
                unit = d.get("unit", "")
                readings = d.get("readings", [])
                values_str = ", ".join(str(r) for r in readings) if readings else "No data"
                context += f"- {name} ({dtype}): [{values_str}]{f' {unit}' if unit else ''}\n"

        messages = [
            {"role": "system", "content": system_prompt},
        ]
        if context:
            messages.append({"role": "user", "content": context})
        if has_question:
            messages.append({"role": "user", "content": prompt})

        try:
            response = await self.client.chat(model=self.model, messages=messages)
            content = response["message"]["content"]
        except Exception as e:
            return {
                "status": "Caution",
                "recommendations": [f"AI service unavailable: {e}"],
            }

        result = self._try_parse_json(content)
        if result is not None:
            return result

        return {
            "status": "Caution",
            "recommendations": ["AI returned an unparseable response. Try again."],
        }

    def _try_parse_json(self, text: str) -> dict | None:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        import re
        match = re.search(r'```(?:json)?\s*(.*?)\s*```', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        return None


ai_service = AIService()
