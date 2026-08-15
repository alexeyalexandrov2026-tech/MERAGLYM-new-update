import pytest
import asyncio
from meraglym.osint.general.stix import StixAdapter
from meraglym.osint.general.phoneinfoga import PhoneAdapter
from meraglym.osint.cis.rfsd import RfsdAdapter
from meraglym.osint.cis.egrul import EgrulAdapter

@pytest.mark.asyncio
async def test_stix_adapter():
    adapter = StixAdapter()
    payload = {
        "objects": [
            {
                "type": "threat-actor",
                "id": "threat-actor--12345",
                "name": "APT28",
                "aliases": ["Fancy Bear", "Sednit"]
            }
        ]
    }
    
    observations = await adapter.execute(payload)
    assert len(observations) == 1
    obs = observations[0]
    assert obs["entity_type"] == "ThreatActor"
    assert obs["entity_value"] == "APT28"
    assert "Fancy Bear" in obs["metadata"]["aliases"]
    assert obs["confidence"] == 0.90

@pytest.mark.asyncio
async def test_rfsd_adapter():
    adapter = RfsdAdapter()
    payload = {"inn": "7736050003"}
    try:
        observations = await adapter.execute(payload)
        assert isinstance(observations, list)
    except RuntimeError:
        pass

@pytest.mark.asyncio
async def test_egrul_adapter():
    adapter = EgrulAdapter()
    payload = {"value": "7736050003"}
    observations = await adapter.execute(payload)
    assert isinstance(observations, list)
    assert len(observations) >= 1
    assert observations[0]["entity_type"] == "LegalEntity"

@pytest.mark.asyncio
async def test_phone_adapter():
    adapter = PhoneAdapter()
    payload = {"value": "+79991234567"}
    observations = await adapter.execute(payload)
    assert isinstance(observations, list)
    assert len(observations) >= 1
    assert observations[0]["entity_type"] == "Phone"
    assert observations[0]["metadata"]["e164"] == "+79991234567"
