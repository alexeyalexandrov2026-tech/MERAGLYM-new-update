import test from "node:test";
import assert from "node:assert/strict";

import { resolveAdapterRoute, type AdapterId } from "../src/lib/adapterRouting.ts";

/**
 * Contract test against the adapters that are actually deployed.
 *
 * Jobs are executed by the `meraglym-consumer` Worker, not by this codebase, so
 * a payload that looks fine here can still be rejected in production. The
 * predicates below are transcribed verbatim from that Worker's bundled
 * `validate()` implementations. If routing ever emits a payload one of them
 * would throw on, the job fails in production with the user seeing nothing
 * useful — so assert it here instead.
 */
type Payload = Record<string, string>;

const DEPLOYED_VALIDATORS: Record<AdapterId, (input: Payload) => void> = {
  phone_recon: (input) => {
    const p = input?.phone || input?.target;
    if (!p || typeof p !== "string") throw new Error("Target phone number is required (E.164 or national format)");
  },
  phone_person_correlator: (input) => {
    if (!input?.phone && !input?.target) throw new Error("Phone parameter is required");
  },
  egrul_registry: (input) => {
    if (!input?.inn && !input?.ogrn && !input?.target) throw new Error("INN or OGRN parameter is required");
  },
  holehe_recon: (input) => {
    const e = input?.email || input?.target || "";
    if (!e || !e.includes("@")) throw new Error("Valid email address is required");
  },
  fssp_check: (input) => {
    if (!input?.name && !input?.inn && !input?.target) throw new Error("Target name or INN is required");
  },
  crypto_recon: (input) => {
    if (!input?.address && !input?.target) throw new Error("Wallet address is required");
  },
  stix_ingest: (input) => {
    if (!input?.bundle && !input?.target) throw new Error("STIX bundle payload required");
  },
  // Deployed as `validate: () => {}` — accepts anything.
  opencti_connector: () => {},
  spiderfoot_meta: () => {},
};

const CASES: Array<{ input: string; node: { type: string; name: string } | null; expected: AdapterId }> = [
  { input: "Александров Алексей Андреевич", node: { type: "folder", name: "OSINT Framework" }, expected: "fssp_check" },
  { input: "+79991234567", node: { type: "folder", name: "OSINT Framework" }, expected: "phone_person_correlator" },
  { input: "89991234567", node: null, expected: "phone_person_correlator" },
  { input: "7707083893", node: null, expected: "egrul_registry" },
  { input: "1027700132195", node: null, expected: "egrul_registry" },
  { input: "support@sberbank.ru", node: null, expected: "holehe_recon" },
  { input: "0x00000000219ab540356cBB839Cbe05303d7705Fa", node: null, expected: "crypto_recon" },
  { input: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", node: null, expected: "crypto_recon" },
  { input: "sberbank.ru", node: { type: "spiderfoot_meta", name: "SpiderFoot" }, expected: "spiderfoot_meta" },
  { input: "APT28", node: { type: "stix_ingest", name: "STIX 2.1" }, expected: "stix_ingest" },
  { input: "APT28", node: { type: "opencti_connector", name: "OpenCTI" }, expected: "opencti_connector" },
  { input: "+74957397000", node: { type: "phone_recon", name: "PhoneInfoga" }, expected: "phone_person_correlator" },
];

for (const { input, node, expected } of CASES) {
  test(`"${input}" → ${expected}, and the deployed validator accepts its payload`, () => {
    const result = resolveAdapterRoute(input, node);

    assert.equal(result.adapterId, expected);
    if (result.adapterId === null) return;

    assert.doesNotThrow(
      () => DEPLOYED_VALIDATORS[result.adapterId](result.payload),
      `deployed ${result.adapterId}.validate() would reject ${JSON.stringify(result.payload)}`
    );
  });
}

test("every deployed adapter has a validator transcribed here", () => {
  // Guards against a new adapter being added to the whitelist without checking
  // what the deployed Worker requires of its payload.
  assert.equal(Object.keys(DEPLOYED_VALIDATORS).length, 9);
});
