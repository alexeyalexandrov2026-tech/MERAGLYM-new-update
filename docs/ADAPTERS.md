# MERAGLYM Intelligence Adapter Registry

## Adapter Matrix

| ID | Name | Category | Status | Required Credentials |
| :--- | :--- | :--- | :---: | :--- |
| `phone_recon` | Phone Number & Telecom Intelligence (E.164) | Telecom | `OPERATIONAL` | None |
| `phone_person_correlator` | Person-Phone Correlator & Messenger De-anonymizer | Telecom | `OPERATIONAL` | None |
| `egrul_registry` | FNS Russia EGRUL / EGRIP Legal Entities Registry | CIS Registry | `OPERATIONAL` | None |
| `rfsd_financials` | GIR BO Financial Accounting Statements | CIS Registry | `OPERATIONAL` | None |
| `sudrf_courts` | SudRF Courts of General Jurisdiction | CIS Registry | `OPERATIONAL` | None |
| `kad_arbitr` | Arbitration Court Cases (KAD) | CIS Registry | `OPERATIONAL` | None |
| `fns_tax` | FNS Transparent Business Tax Screening | CIS Registry | `OPERATIONAL` | None |
| `efrsb_bankruptcy` | Fedresurs Bankruptcy Registry | CIS Registry | `OPERATIONAL` | None |
| `mvd_wanted` | MVD Russia Wanted List Search | CIS Registry | `OPERATIONAL` | None |
| `stix_ingest` | STIX 2.1 Threat Intel Ingestion Engine | CTI | `OPERATIONAL` | None |
| `holehe_recon` | Holehe 120+ Account Reconnaissance | Global OSINT | `OPERATIONAL` | None |
| `email_recon` | Google Gaia ID & Email Reconnaissance | Global OSINT | `OPERATIONAL` | None |
| `social_recon` | Social Profiles Reconnaissance (Maigret) | Global OSINT | `OPERATIONAL` | None |
| `metadata_extractor` | EXIF & Geolocation Metadata Extractor | Media | `OPERATIONAL` | None |
| `crypto_recon` | Blockchain Tracing Engine (BTC/ETH) | Crypto | `OPERATIONAL` | None |
| `geospatial_mapper` | BSSID / Wi-Fi Geospatial Mapper | Global OSINT | `OPERATIONAL` | None |
| `camera_recon` | CCTV & RTSP Surveillance Stream Locator | Media | `OPERATIONAL` | None |
| `darkweb_mapper` | Tor .onion Hidden Services Scanner | DarkWeb | `DEGRADED` | `TOR_SOCKS5_PROXY` |
| `fssp_check` | FSSP Court Bailiff Enforcement Proceedings | CIS Registry | `CREDENTIAL_REQUIRED` | `FSSP_API_KEY` |
| `spiderfoot_meta` | SpiderFoot OSINT Automation Framework | Global OSINT | `CREDENTIAL_REQUIRED` | `SPIDERFOOT_SERVER_URL` |
| `opencti_connector` | OpenCTI Enterprise Threat Intelligence | CTI | `CREDENTIAL_REQUIRED` | `OPENCTI_URL`, `OPENCTI_TOKEN` |
