import pytest
import asyncio
from meraglym.osint.general.phone_correlator import PersonPhoneCorrelatorAdapter

@pytest.mark.asyncio
async def test_person_phone_correlator_adapter():
    adapter = PersonPhoneCorrelatorAdapter()
    payload = {"value": "+79231054928"}
    
    observations = await adapter.execute(payload)
    assert isinstance(observations, list)
    assert len(observations) >= 1
    
    obs = observations[0]
    assert obs["entity_type"] == "PhoneIdentity"
    assert obs["entity_value"] == "+79231054928"
    assert obs["metadata"]["operator"] == "ПАО «МегаФон»"
    assert "https://t.me/+79231054928" in obs["metadata"]["telegram_endpoint"]
    assert obs["confidence"] >= 0.95
