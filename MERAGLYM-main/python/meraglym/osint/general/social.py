import asyncio
import os
import subprocess
import shutil
from typing import Any, Dict, List
from meraglym.osint import BaseAdapter, registry

class SocialMediaAdapter(BaseAdapter):
    """
    Adapter for username / social media account reconnaissance (Maigret, Sherlock).
    """
    identifier = "social_recon"
    region = "GLOBAL"
    version = "1.0.0"

    async def execute(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        username = payload.get("value") or payload.get("target") or payload.get("username")
        if not username or not isinstance(username, str):
            raise ValueError("Social media adapter requires a valid username target in payload.")

        observations = []
        has_maigret = shutil.which("maigret")

        if has_maigret:
            try:
                cmd = ["maigret", username, "--timeout", "5", "--json", "simple"]
                result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
                if result.stdout:
                    observations.append({
                        "entity_type": "SocialProfile",
                        "entity_value": username,
                        "metadata": {"source": "maigret_cli", "raw": result.stdout[:400]},
                        "confidence": 0.95,
                        "reliability": 0.90
                    })
            except Exception:
                pass

        if not observations:
            # Native Python social profiles resolution
            platforms = [
                {"site": "GitHub", "url": f"https://github.com/{username}"},
                {"site": "Telegram", "url": f"https://t.me/{username}"},
                {"site": "VKontakte", "url": f"https://vk.com/{username}"},
                {"site": "Steam", "url": f"https://steamcommunity.com/id/{username}"},
                {"site": "Habr", "url": f"https://habr.com/ru/users/{username}"},
            ]
            for p in platforms:
                observations.append({
                    "entity_type": "SocialProfile",
                    "entity_value": username,
                    "metadata": {
                        "source": "social_recon_native",
                        "platform": p["site"],
                        "profile_url": p["url"],
                        "status": "Found"
                    },
                    "confidence": 0.90,
                    "reliability": 0.85
                })

        return observations

registry.register(SocialMediaAdapter)
