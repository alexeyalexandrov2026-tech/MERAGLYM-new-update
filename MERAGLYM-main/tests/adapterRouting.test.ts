import test from "node:test";
import assert from "node:assert/strict";

import {
  LIVE_ADAPTER_IDS,
  isLiveAdapterId,
  resolveAdapterRoute,
} from "../src/lib/adapterRouting.ts";

const FOLDER_NODE = { type: "folder", name: "OSINT Framework" };
const URL_NODE = { type: "url", name: "ФНС / ЕГРЮЛ (egrul.nalog.ru)" };

test("regression: full name on a folder node routes to a live adapter, never the node name", () => {
  // Exact production failure: job type was "OSINT Framework" (the folder's
  // display name), which the consumer rejected with ADAPTER_NOT_FOUND.
  const result = resolveAdapterRoute("Александров Алексей Андреевич", FOLDER_NODE);

  assert.equal(result.adapterId, "fssp_check");
  assert.notEqual(result.adapterId as unknown as string, "OSINT Framework");
  assert.deepEqual(result.adapterId && result.payload, {
    target: "Александров Алексей Андреевич",
    name: "Александров Алексей Андреевич",
  });
});

test("invariant: routing only ever emits a deployed adapter id, or null", () => {
  const inputs = [
    "Александров Алексей Андреевич",
    "+79991234567",
    "89991234567",
    "7707083893",
    "1027700132195",
    "support@sberbank.ru",
    "0x00000000219ab540356cBB839Cbe05303d7705Fa",
    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "sberbank.ru",
    "APT28",
    "",
    "   ",
    "???",
  ];

  for (const node of [FOLDER_NODE, URL_NODE, null, { type: "spiderfoot_meta", name: "SpiderFoot" }]) {
    for (const input of inputs) {
      const { adapterId } = resolveAdapterRoute(input, node);
      assert.ok(
        adapterId === null || isLiveAdapterId(adapterId),
        `"${input}" on node ${node?.type ?? "null"} produced non-deployed id: ${adapterId}`
      );
    }
  }
});

test("phone numbers route to the phone correlator", () => {
  for (const phone of ["+79991234567", "89991234567", "8 (999) 123-45-67", "+7 999 123 45 67"]) {
    const result = resolveAdapterRoute(phone, FOLDER_NODE);
    assert.equal(result.adapterId, "phone_person_correlator", `failed for ${phone}`);
    assert.equal(result.adapterId && result.payload.phone, phone);
  }
});

test("INN and OGRN route to the EGRUL registry", () => {
  for (const id of ["7707083893", "500100732259", "1027700132195"]) {
    const result = resolveAdapterRoute(id, FOLDER_NODE);
    assert.equal(result.adapterId, "egrul_registry", `failed for ${id}`);
    assert.equal(result.adapterId && result.payload.inn, id);
  }
});

test("email routes to holehe and carries only the field that adapter reads", () => {
  const result = resolveAdapterRoute("support@sberbank.ru", FOLDER_NODE);
  assert.equal(result.adapterId, "holehe_recon");
  assert.equal(result.adapterId && result.payload.email, "support@sberbank.ru");
  // The old payload set every key to the same value; keys for other adapters
  // must no longer be present.
  assert.equal(result.adapterId && result.payload.phone, undefined);
  assert.equal(result.adapterId && result.payload.inn, undefined);
});

test("crypto addresses route to crypto_recon", () => {
  for (const addr of [
    "0x00000000219ab540356cBB839Cbe05303d7705Fa",
    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  ]) {
    const result = resolveAdapterRoute(addr, FOLDER_NODE);
    assert.equal(result.adapterId, "crypto_recon", `failed for ${addr}`);
  }
});

test("ambiguous input falls back to the node's adapter id, not its name", () => {
  const spiderfoot = resolveAdapterRoute("sberbank.ru", { type: "spiderfoot_meta", name: "SpiderFoot" });
  assert.equal(spiderfoot.adapterId, "spiderfoot_meta");
  assert.equal(spiderfoot.adapterId && spiderfoot.matchedBy, "node");

  const stix = resolveAdapterRoute("APT28", { type: "stix_ingest", name: "STIX 2.1" });
  assert.equal(stix.adapterId, "stix_ingest");
});

test("ambiguous input on a node with no adapter id is unroutable", () => {
  const result = resolveAdapterRoute("sberbank.ru", FOLDER_NODE);
  assert.equal(result.adapterId, null);
  assert.equal(result.adapterId === null && result.reason, "NO_MATCHING_ADAPTER");

  const onUrlNode = resolveAdapterRoute("что-то непонятное", URL_NODE);
  assert.equal(onUrlNode.adapterId, null);
});

test("empty input is reported distinctly from an unmatched target", () => {
  for (const empty of ["", "   ", "\n"]) {
    const result = resolveAdapterRoute(empty, FOLDER_NODE);
    assert.equal(result.adapterId, null);
    assert.equal(result.adapterId === null && result.reason, "EMPTY_INPUT");
  }
});

test("the whitelist matches the adapters the consumer actually registers", () => {
  // Mirrors the ids extracted from the deployed meraglym-consumer bundle.
  assert.deepEqual([...LIVE_ADAPTER_IDS].sort(), [
    "crypto_recon",
    "egrul_registry",
    "fssp_check",
    "holehe_recon",
    "opencti_connector",
    "phone_person_correlator",
    "phone_recon",
    "spiderfoot_meta",
    "stix_ingest",
  ]);
});
