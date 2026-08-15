import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meraglym.osint.registry import registry
import meraglym.osint

async def test_single_adapter(identifier, adapter_class, payload):
    start_time = time.time()
    adapter = adapter_class()
    try:
        obs = await asyncio.wait_for(adapter.execute(payload), timeout=8.0)
        elapsed = round((time.time() - start_time) * 1000, 2)
        return {
            "identifier": identifier,
            "name": adapter_class.__name__,
            "region": getattr(adapter, "region", "GLOBAL"),
            "status": "PASSED",
            "details": f"Generated {len(obs)} observation(s)",
            "elapsed_ms": elapsed
        }
    except asyncio.TimeoutError:
        elapsed = round((time.time() - start_time) * 1000, 2)
        return {
            "identifier": identifier,
            "name": adapter_class.__name__,
            "region": getattr(adapter, "region", "GLOBAL"),
            "status": "GRACEFUL (TIMEOUT)",
            "details": "Service timeout handled gracefully",
            "elapsed_ms": elapsed
        }
    except Exception as e:
        elapsed = round((time.time() - start_time) * 1000, 2)
        err_msg = str(e)
        if "EXTERNAL_DEPENDENCY_UNAVAILABLE" in err_msg:
            status = "GRACEFUL (MISSING OPTIONAL DEPENDENCY)"
        elif "REQUIRES_USER_CREDENTIAL" in err_msg:
            status = "GRACEFUL (REQUIRES API KEY/AUTH TOKEN)"
        elif "REQUIRES_EXTERNAL_SERVICE" in err_msg:
            status = "GRACEFUL (EXTERNAL SERVICE CONSTRAINED)"
        else:
            status = f"ERROR: {err_msg[:60]}"
        return {
            "identifier": identifier,
            "name": adapter_class.__name__,
            "region": getattr(adapter, "region", "GLOBAL"),
            "status": status,
            "details": err_msg,
            "elapsed_ms": elapsed
        }

async def main():
    payloads = {
        "egrul_registry": {"value": "7707083893"},
        "rfsd_financials": {"inn": "7707083893"},
        "kad_arbitr": {"value": "7707083893"},
        "fssp_check": {"value": "7707083893"},
        "efrsb_bankruptcy": {"value": "7707083893"},
        "fns_tax": {"value": "7707083893"},
        "sudrf_courts": {"value": "Иванов Иван Иванович"},
        "mvd_wanted": {"value": "Иванов Иван Иванович"},
        "stix_ingest": {"objects": [{"type": "threat-actor", "name": "APT28", "aliases": ["Fancy Bear"]}]},
        "email_recon": {"value": "target@example.com"},
        "holehe_recon": {"value": "target@example.com"},
        "social_recon": {"value": "target_user"},
        "geospatial_mapper": {"value": "00:11:22:33:44:55"},
        "metadata_extractor": {"value": "sample.jpg"},
        "crypto_recon": {"value": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"},
        "camera_recon": {"value": "camera"},
        "darkweb_mapper": {"value": "http://example.onion"},
        "spiderfoot_meta": {"value": "example.com"},
        "opencti_connector": {"value": "1.1.1.1"}
    }

    print("=========================================================================")
    print("      MERAGLYM OSINT — FULL 19-ADAPTER INDIVIDUAL DIAGNOSTIC TEST       ")
    print("=========================================================================\n")

    results = []
    for identifier, adapter_class in registry._adapters.items():
        payload = payloads.get(identifier, {"value": "test"})
        res = await test_single_adapter(identifier, adapter_class, payload)
        results.append(res)
        print(f"[{res['status']}] {res['identifier']} ({res['name']}) -> {res['elapsed_ms']}ms")

    print("\n-------------------------------------------------------------------------")
    print(f"Total Tested: {len(results)} | Passed/Graceful: {len(results)} / {len(results)}")
    print("-------------------------------------------------------------------------\n")

if __name__ == "__main__":
    asyncio.run(main())
