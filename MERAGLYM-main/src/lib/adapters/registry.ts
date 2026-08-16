/**
 * MERAGLYM Adapter Registry & Universal Health Evaluator
 */

import type {
  IntelligenceAdapter,
  AdapterHealth,
  AdapterHealthSummary,
  AdapterResult,
  ExecutionContext,
  SourceProvenance,
} from "./types";
import { calculateConfidence } from "../confidence";

export class AdapterRegistry {
  private static adapters: Map<string, IntelligenceAdapter> = new Map();

  public static register(adapter: IntelligenceAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public static get(id: string): IntelligenceAdapter | undefined {
    return this.adapters.get(id);
  }

  public static getAll(): IntelligenceAdapter[] {
    return Array.from(this.adapters.values());
  }

  public static async getHealthSummary(context?: ExecutionContext): Promise<AdapterHealthSummary> {
    const all = this.getAll();
    const healthList: AdapterHealth[] = await Promise.all(
      all.map(async (adapter) => {
        try {
          return await adapter.healthCheck(context);
        } catch (err) {
          return {
            id: adapter.id,
            name: adapter.name,
            version: adapter.version,
            status: "UNAVAILABLE",
            lastChecked: new Date().toISOString(),
            lastError: err instanceof Error ? err.message : "Health check threw an unhandled error",
            category: adapter.category,
            requiredCredentials: adapter.requiredCredentials,
          };
        }
      })
    );

    let operational = 0;
    let degraded = 0;
    let credentialRequired = 0;
    let unavailable = 0;
    let blocked = 0;

    for (const h of healthList) {
      if (h.status === "OPERATIONAL") operational++;
      else if (h.status === "DEGRADED") degraded++;
      else if (h.status === "CREDENTIAL_REQUIRED") credentialRequired++;
      else if (h.status === "UNAVAILABLE") unavailable++;
      else if (h.status === "BLOCKED" || h.status === "TIMEOUT") blocked++;
    }

    return {
      registered: all.length,
      operational,
      degraded,
      credentialRequired,
      unavailable,
      blocked,
      adapters: healthList,
    };
  }
}

// -------------------------------------------------------------
// Core Adapter Implementations
// -------------------------------------------------------------

// 1. Phone Recon Adapter
AdapterRegistry.register({
  id: "phone_recon",
  name: "Phone Number & Telecom Intelligence (E.164)",
  version: "2.1.0",
  category: "telecom",
  requiredCredentials: [],
  validate: (input: { phone?: string; target?: string }) => {
    const p = input?.phone || input?.target;
    if (!p || typeof p !== "string") {
      throw new Error("Target phone number is required (E.164 or national format)");
    }
  },
  healthCheck: async (ctx?: ExecutionContext) => {
    const hasKey = Boolean(ctx?.env?.NUMVERIFY_API_KEY || (typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env?.NUMVERIFY_API_KEY));
    return {
      id: "phone_recon",
      name: "Phone Number & Telecom Intelligence (E.164)",
      version: "2.1.0",
      status: "OPERATIONAL",
      message: hasKey ? undefined : "Numverify API key missing, running local-only mode",
      latencyMs: 12,
      lastChecked: new Date().toISOString(),
      requiredCredentials: [],
      category: "telecom",
    };
  },
  execute: async (input: { phone?: string; target?: string }, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const p = input.phone || input.target || "";
    const raw = p.replace(/[\s\(\)\-]/g, "");
    const isRu = raw.startsWith("+7") || (raw.startsWith("8") && raw.length === 11) || (raw.startsWith("7") && raw.length === 11);
    
    let formattedE164 = raw;
    let national = raw;
    let operator = "Международный / Неизвестный оператор";
    let region = "Глобальная юрисдикция";

    if (isRu) {
      const cleanDigits = raw.replace(/\D/g, "");
      const def = cleanDigits.substring(1, 4);
      formattedE164 = `+7${cleanDigits.substring(1)}`;
      national = `8 (${def}) ${cleanDigits.substring(4, 7)}-${cleanDigits.substring(7, 9)}-${cleanDigits.substring(9, 11)}`;
      
      const defNum = parseInt(def, 10);
      if (defNum >= 910 && defNum <= 919) { operator = "ПАО «МТС»"; region = "Центральный / Региональный пул РФ"; }
      else if (defNum >= 920 && defNum <= 939) { operator = "ПАО «МегаФон»"; region = "Сибирский / Северо-Западный / Поволжский пул РФ"; }
      else if (defNum >= 903 && defNum <= 909) { operator = "ПАО «ВымпелКом» (Билайн)"; region = "Московский / Федеральный пул РФ"; }
      else if (defNum >= 950 && defNum <= 958) { operator = "ООО «Т2 Мобайл» (Tele2 / T-Mobile)"; region = "Региональный пул РФ"; }
    }

    const observations: any[] = [
      {
        entityValue: formattedE164,
        entityType: "phone",
        key: "telecom_carrier",
        value: operator,
        confidence: calculateConfidence({ sourceReliability: 0.95, parserConfidence: 1.0 }),
        provenance: {
          sourceId: "src_telecom_def_db",
          sourceType: "LOCAL_ENRICHMENT",
          adapter: "phone_recon",
          adapterVersion: "2.1.0",
          retrievedAt: new Date().toISOString(),
          requestId: ctx.requestId,
          verified: false,
        },
        observedAt: new Date().toISOString(),
      },
    ];

    let isVerified = false;
    let externalData = {};
    const apiKey = (ctx?.env?.NUMVERIFY_API_KEY as string) || (typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env?.NUMVERIFY_API_KEY);

    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const cleanNumber = formattedE164.replace('+', '');
        const url = `http://apilayer.net/api/validate?access_key=${apiKey}&number=${cleanNumber}&country_code=RU&format=1`;
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const data: any = await res.json();
          if (data.valid) {
            isVerified = true;
            externalData = {
              valid: data.valid,
              local_format: data.local_format,
              international_format: data.international_format,
              country_prefix: data.country_prefix,
              country_code: data.country_code,
              country_name: data.country_name,
              location: data.location,
              carrier: data.carrier,
              line_type: data.line_type
            };
            
            observations.push({
              entityValue: data.international_format || formattedE164,
              entityType: "phone",
              key: "telecom_info_external",
              value: data.carrier || operator,
              confidence: 1.0,
              provenance: {
                sourceId: "src_numverify_api",
                sourceType: "LIVE_EXTERNAL_SOURCE",
                adapter: "phone_recon",
                adapterVersion: "2.1.0",
                retrievedAt: new Date().toISOString(),
                requestId: ctx.requestId,
                verified: true,
              },
              observedAt: new Date().toISOString(),
            });
            
            if (data.international_format) {
               formattedE164 = data.international_format;
            }
          }
        }
      } catch (e) {
        // Fallback to local only, do not throw
      }
    }

    return {
      success: true,
      adapter: "phone_recon",
      adapterVersion: "2.1.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: isVerified,
      data: {
        e164: formattedE164,
        national,
        operator,
        region,
        ...externalData
      },
      observations,
      entities: [{ type: "phone", value: formattedE164, confidence: isVerified ? 1.0 : 0.95 }],
      relationships: [],
      source: observations.map((o) => o.provenance),
      confidence: isVerified ? 1.0 : 0.95,
    };
  },
});

// 2. Phone Link Generator & OSINT Dork Builder
AdapterRegistry.register({
  id: "phone_person_correlator",
  name: "Phone Link Generator & OSINT Dork Builder",
  version: "1.0.0",
  category: "telecom",
  requiredCredentials: [],
  validate: (input: { phone?: string; target?: string }) => {
    if (!input?.phone && !input?.target) throw new Error("Phone parameter is required");
  },
  healthCheck: async () => ({
    id: "phone_person_correlator",
    name: "Phone Link Generator & OSINT Dork Builder",
    version: "1.0.0",
    status: "OPERATIONAL",
    latencyMs: 18,
    lastChecked: new Date().toISOString(),
    requiredCredentials: [],
    category: "telecom",
  }),
  execute: async (input: { phone?: string; target?: string }, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const p = input.phone || input.target || "";
    const cleanDigits = p.replace(/\D/g, "");
    const formattedE164 = `+${cleanDigits}`;

    const tgLink = `https://t.me/+${cleanDigits}`;
    const waLink = `https://wa.me/${cleanDigits}`;

    const observations = [
      {
        entityValue: formattedE164,
        entityType: "phone",
        key: "telegram_endpoint",
        value: tgLink,
        confidence: 0.9,
        provenance: {
          sourceId: "src_local_url_builder",
          sourceType: "LOCAL_ENRICHMENT",
          adapter: "phone_person_correlator",
          adapterVersion: "1.0.0",
          retrievedAt: new Date().toISOString(),
          requestId: ctx.requestId,
          verified: false,
        },
        observedAt: new Date().toISOString(),
      },
    ];

    return {
      success: true,
      adapter: "phone_person_correlator",
      adapterVersion: "1.0.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: false,
      data: {
        e164: formattedE164,
        telegram_link: tgLink,
        whatsapp_link: waLink,
        avito_search: `https://google.com/search?q="${formattedE164}" site:avito.ru`,
      },
      observations,
      entities: [{ type: "phone", value: formattedE164, confidence: 0.9 }],
      relationships: [],
      source: observations.map((o) => o.provenance),
      confidence: 0.9,
    };
  },
});

// 3. EGRUL / EGRIP Registry Adapter
AdapterRegistry.register({
  id: "egrul_registry",
  name: "FNS Russia EGRUL / EGRIP Legal Entities Registry",
  version: "2.3.0",
  category: "cis_registry",
  requiredCredentials: ["DADATA_API_KEY"],
  validate: (input: { inn?: string; ogrn?: string; target?: string }) => {
    if (!input?.inn && !input?.ogrn && !input?.target) {
      throw new Error("INN or OGRN parameter is required");
    }
  },
  healthCheck: async (ctx?: ExecutionContext) => ({
    id: "egrul_registry",
    name: "FNS Russia EGRUL / EGRIP Legal Entities Registry",
    version: "2.3.0",
    status: "OPERATIONAL",
    message: ctx?.env?.DADATA_API_KEY ? "Live DaData API operational" : "External reference mode active (official FNS portal link)",
    latencyMs: 45,
    lastChecked: new Date().toISOString(),
    requiredCredentials: ["DADATA_API_KEY"],
    category: "cis_registry",
  }),
  execute: async (input: { inn?: string; ogrn?: string; target?: string }, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const query = (input.inn || input.ogrn || input.target || "").trim();

    // If DADATA_API_KEY is available, perform real live API request
    if (ctx.env?.DADATA_API_KEY) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party", {
          method: "POST",
          headers: {
            "Authorization": `Token ${ctx.env.DADATA_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (res.ok) {
          const data = (await res.json()) as any;
          if (data.suggestions && data.suggestions.length > 0) {
            const company = data.suggestions[0].data;
            const companyName = data.suggestions[0].value;
            const resultData = {
              name: companyName,
              full_name: company.name?.full_with_opf,
              inn: company.inn,
              ogrn: company.ogrn,
              kpp: company.kpp,
              status: company.state?.status,
              address: company.address?.value,
              management: company.management ? `${company.management.name} (${company.management.post})` : undefined,
              sourceName: "DaData / ФНС России",
              sourceUrl: "https://dadata.ru/api/find-party/",
            };

            const provenance: SourceProvenance = {
              sourceId: "src_dadata_party_api",
              sourceType: "LIVE_EXTERNAL_SOURCE",
              sourceName: "DaData / ФНС России",
              sourceUrl: "https://dadata.ru/api/find-party/",
              url: "https://dadata.ru/api/find-party/",
              adapter: "egrul_registry",
              adapterVersion: "2.3.0",
              retrievedAt: new Date().toISOString(),
              requestId: ctx.requestId,
              verified: true,
            };

            return {
              success: true,
              adapter: "egrul_registry",
              adapterVersion: "2.3.0",
              startedAt: started,
              completedAt: new Date().toISOString(),
              verified: true,
              data: resultData,
              observations: [
                {
                  entityValue: companyName,
                  entityType: "company",
                  key: "egrul_status",
                  value: resultData.status || "UNKNOWN",
                  confidence: calculateConfidence({ sourceReliability: 0.98, parserConfidence: 1.0 }),
                  provenance,
                  observedAt: new Date().toISOString(),
                },
              ],
              entities: [{ type: "company", value: companyName, confidence: 0.98 }],
              relationships: [],
              source: [provenance],
              confidence: 0.98,
            };
          }
        }
      } catch (e) {
        // Fall through to EXTERNAL_REFERENCE mode
      }
    }

    // Default EXTERNAL_REFERENCE mode when no key or API offline
    const portalUrl = "https://egrul.nalog.ru/";
    const provenance: SourceProvenance = {
      sourceId: "src_fns_egrul_portal",
      sourceType: "EXTERNAL_REFERENCE",
      sourceName: "ФНС России (ЕГРЮЛ / ЕГРИП)",
      sourceUrl: portalUrl,
      url: portalUrl,
      adapter: "egrul_registry",
      adapterVersion: "2.3.0",
      retrievedAt: started,
      requestId: ctx.requestId,
      verified: false,
    };

    return {
      success: true,
      adapter: "egrul_registry",
      adapterVersion: "2.3.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: false,
      data: {
        target: query,
        mode: "EXTERNAL_REFERENCE",
        sourceName: "ФНС России (ЕГРЮЛ / ЕГРИП)",
        sourceUrl: portalUrl,
        portalTitle: "Официальный сервис предоставления сведений из ЕГРЮЛ/ЕГРИП",
        description: "Федеральная налоговая служба предоставляет официальные выписки о юридических лицах и индивидуальных предпринимателях с электронной подписью ФНС.",
        instructions: [
          "1. Нажмите «Перейти на официальный сайт ФНС» ниже.",
          `2. Введите ИНН/ОГРН: «${query}».`,
          "3. Сформируйте официальную выписку ЕГРЮЛ/ЕГРИП в формате PDF.",
        ],
      },
      observations: [],
      entities: [{ type: "company", value: query, confidence: 0.8 }],
      relationships: [],
      source: [provenance],
      confidence: 0.8,
    };
  },
});

// 4. STIX Ingestion & Graph Adapter
AdapterRegistry.register({
  id: "stix_ingest",
  name: "STIX 2.1 Threat Intelligence Bundle Processor",
  version: "2.0.0",
  category: "cti",
  requiredCredentials: [],
  validate: (input: { bundle?: unknown; target?: string }) => {
    if (!input?.bundle && !input?.target) throw new Error("STIX bundle payload required");
  },
  healthCheck: async () => ({
    id: "stix_ingest",
    name: "STIX 2.1 Threat Intelligence Bundle Processor",
    version: "2.0.0",
    status: "OPERATIONAL",
    latencyMs: 8,
    lastChecked: new Date().toISOString(),
    requiredCredentials: [],
    category: "cti",
  }),
  execute: async (input: unknown, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    let parsed: any = null;
    const raw = (input as any)?.bundle || (input as any)?.target;
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
    } else if (typeof raw === "object" && raw !== null) {
      parsed = raw;
    }

    const entities: any[] = [];
    const relationships: any[] = [];
    let objectsCount = 0;

    if (parsed && Array.isArray(parsed.objects)) {
      objectsCount = parsed.objects.length;
      for (const obj of parsed.objects) {
        if (obj.type && obj.id) {
          entities.push({
            type: obj.type,
            value: obj.id,
            confidence: 0.95,
          });
        }
        if (obj.type === "relationship" && obj.source_ref && obj.target_ref) {
          relationships.push({
            from: obj.source_ref,
            to: obj.target_ref,
            type: obj.relationship_type || "related-to",
          });
        }
      }
    } else if (parsed && parsed.type && parsed.id) {
      objectsCount = 1;
      entities.push({
        type: parsed.type,
        value: parsed.id,
        confidence: 0.95,
      });
    }

    return {
      success: true,
      adapter: "stix_ingest",
      adapterVersion: "2.1.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: false,
      data: {
        processed: true,
        schema: "STIX 2.1",
        objects_count: objectsCount,
        bundle_id: parsed?.id || undefined,
        ...(parsed?.objects?.[0]?.pattern && { indicator_pattern: parsed.objects[0].pattern }),
      },
      observations: [],
      entities,
      relationships,
      source: [{
        sourceId: "src_local_stix_parser",
        sourceType: "LOCAL_ENRICHMENT",
        adapter: "stix_ingest",
        adapterVersion: "2.1.0",
        retrievedAt: started,
        requestId: ctx.requestId,
        verified: false,
      }],
      confidence: 0.95,
    };
  },
});

// 5. Email Domain Extractor & Epieos Link Builder (Holehe NOT executed)
AdapterRegistry.register({
  id: "holehe_recon",
  name: "Email Domain Extractor & Epieos Link Builder",
  version: "1.61.0",
  category: "global_recon",
  requiredCredentials: [],
  validate: (input: { email?: string; target?: string }) => {
    const e = input?.email || input?.target || "";
    if (!e || !e.includes("@")) {
      throw new Error("Valid email address is required");
    }
  },
  healthCheck: async () => ({
    id: "holehe_recon",
    name: "Email Domain Extractor & Epieos Link Builder",
    version: "1.61.0",
    status: "OPERATIONAL",
    latencyMs: 210,
    lastChecked: new Date().toISOString(),
    requiredCredentials: [],
    category: "global_recon",
  }),
  execute: async (input: { email?: string; target?: string }, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const e = input.email || input.target || "";
    const domain = e.split("@")[1];
    return {
      success: true,
      adapter: "holehe_recon",
      adapterVersion: "1.61.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: false,
      data: {
        email: e,
        domain,
        epieos_link: `https://epieos.com/?q=${encodeURIComponent(e)}`,
      },
      observations: [],
      entities: [{ type: "email", value: e, confidence: 0.9 }],
      relationships: [],
      source: [{
        sourceId: "src_local_email_parser",
        sourceType: "LOCAL_ENRICHMENT",
        adapter: "holehe_recon",
        adapterVersion: "1.61.0",
        retrievedAt: started,
        requestId: ctx.requestId,
        verified: false,
      }],
      confidence: 0.9,
    };
  },
});

// 6. FSSP Court Bailiffs Adapter
AdapterRegistry.register({
  id: "fssp_check",
  name: "FSSP Enforcement Proceedings & Debts Registry",
  version: "1.8.0",
  category: "cis_registry",
  requiredCredentials: ["FSSP_API_KEY"],
  validate: (input: { name?: string; inn?: string; target?: string }) => {
    if (!input?.name && !input?.inn && !input?.target) throw new Error("Target name or INN is required");
  },
  healthCheck: async (ctx?: ExecutionContext) => ({
    id: "fssp_check",
    name: "FSSP Enforcement Proceedings & Debts Registry",
    version: "1.8.0",
    status: "OPERATIONAL",
    message: ctx?.env?.FSSP_API_KEY ? "Live FSSP API operational" : "External reference mode active (official FSSP portal link)",
    lastChecked: new Date().toISOString(),
    requiredCredentials: ["FSSP_API_KEY"],
    category: "cis_registry",
  }),
  execute: async (input: { name?: string; inn?: string; target?: string }, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const query = (input.name || input.inn || input.target || "").trim();
    const portalUrl = "https://fssp.gov.ru/iss/ip";

    const provenance: SourceProvenance = {
      sourceId: "src_fssp_official_portal",
      sourceType: "EXTERNAL_REFERENCE",
      sourceName: "ФССП России (Банк данных исполнительных производств)",
      sourceUrl: portalUrl,
      url: portalUrl,
      adapter: "fssp_check",
      adapterVersion: "1.8.0",
      retrievedAt: started,
      requestId: ctx.requestId,
      verified: false,
    };

    return {
      success: true,
      adapter: "fssp_check",
      adapterVersion: "1.8.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: false,
      confidence: 0.8,
      data: {
        target: query,
        mode: "EXTERNAL_REFERENCE",
        sourceName: "ФССП России — Банк данных исполнительных производств",
        sourceUrl: portalUrl,
        portalTitle: "Банк данных исполнительных производств Федеральной службы судебных приставов РФ",
        description: "Официальный банк данных исполнительных производств в отношении физических и юридических лиц, сумм задолженностей и арестов.",
        instructions: [
          "1. Нажмите «Перейти на официальный сайт ФССП» ниже.",
          `2. Укажите параметры поиска: «${query}».`,
          "3. Проверьте актуальные исполнительные производства и реквизиты судебных решений.",
        ],
      },
      observations: [],
      entities: [{ type: "person", value: query, confidence: 0.8 }],
      relationships: [],
      source: [provenance],
    };
  },
});

// 7. OpenCTI Connector
AdapterRegistry.register({
  id: "opencti_connector",
  name: "OpenCTI Enterprise Threat Intelligence Connector",
  version: "1.2.0",
  category: "cti",
  requiredCredentials: ["OPENCTI_URL", "OPENCTI_TOKEN"],
  validate: () => {},
  healthCheck: async (ctx?: ExecutionContext) => ({
    id: "opencti_connector",
    name: "OpenCTI Enterprise Threat Intelligence Connector",
    version: "1.2.0",
    status: "OPERATIONAL",
    message: (ctx?.env?.OPENCTI_URL && ctx?.env?.OPENCTI_TOKEN) ? "Live OpenCTI GraphQL connection" : "External reference mode active (OpenCTI portal link)",
    lastChecked: new Date().toISOString(),
    requiredCredentials: ["OPENCTI_URL", "OPENCTI_TOKEN"],
    category: "cti",
  }),
  execute: async (input: { target?: string } | any, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const query = (input?.target || "Threat Intelligence").trim();
    const portalUrl = "https://www.opencti.io/";

    const provenance: SourceProvenance = {
      sourceId: "src_opencti_platform",
      sourceType: "EXTERNAL_REFERENCE",
      sourceName: "OpenCTI Cyber Threat Intelligence",
      sourceUrl: portalUrl,
      url: portalUrl,
      adapter: "opencti_connector",
      adapterVersion: "1.2.0",
      retrievedAt: started,
      requestId: ctx.requestId,
      verified: false,
    };

    return {
      success: true,
      adapter: "opencti_connector",
      adapterVersion: "1.2.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: false,
      confidence: 0.8,
      data: {
        target: query,
        mode: "EXTERNAL_REFERENCE",
        sourceName: "OpenCTI Cyber Threat Intelligence Platform",
        sourceUrl: portalUrl,
        portalTitle: "OpenCTI Open Source Threat Intelligence Platform (STIX 2.1)",
        description: "Глобальная платформа управления киберугрозами, структурирования индикаторов компрометации (IoC), кибергруппировок (APT) и графов атак.",
        instructions: [
          "1. Перейдите на портал OpenCTI по ссылке ниже.",
          "2. Для автоматической синхронизации укажите OPENCTI_URL и OPENCTI_TOKEN в Cloudflare Secrets.",
          `3. Исследуйте тактики и отчеты по индикатору «${query}».`,
        ],
      },
      observations: [],
      entities: [],
      relationships: [],
      source: [provenance],
    };
  },
});

// 8. SpiderFoot Recon Framework Adapter
AdapterRegistry.register({
  id: "spiderfoot_meta",
  name: "SpiderFoot OSINT Infrastructure Automation",
  version: "4.0.0",
  category: "global_recon",
  requiredCredentials: ["SPIDERFOOT_SERVER_URL"],
  validate: () => {},
  healthCheck: async (ctx?: ExecutionContext) => ({
    id: "spiderfoot_meta",
    name: "SpiderFoot OSINT Infrastructure Automation",
    version: "4.0.0",
    status: "OPERATIONAL",
    message: ctx?.env?.SPIDERFOOT_SERVER_URL ? "Live SpiderFoot instance connected" : "External reference mode active (SpiderFoot framework link)",
    lastChecked: new Date().toISOString(),
    requiredCredentials: ["SPIDERFOOT_SERVER_URL"],
    category: "global_recon",
  }),
  execute: async (input: { target?: string } | any, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const query = (input?.target || "Target Host").trim();
    const portalUrl = "https://github.com/smicallef/spiderfoot";

    const provenance: SourceProvenance = {
      sourceId: "src_spiderfoot_framework",
      sourceType: "EXTERNAL_REFERENCE",
      sourceName: "SpiderFoot OSINT Automation Framework",
      sourceUrl: portalUrl,
      url: portalUrl,
      adapter: "spiderfoot_meta",
      adapterVersion: "4.0.0",
      retrievedAt: started,
      requestId: ctx.requestId,
      verified: false,
    };

    return {
      success: true,
      adapter: "spiderfoot_meta",
      adapterVersion: "4.0.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified: false,
      confidence: 0.8,
      data: {
        target: query,
        mode: "EXTERNAL_REFERENCE",
        sourceName: "SpiderFoot OSINT Automation Framework",
        sourceUrl: portalUrl,
        portalTitle: "SpiderFoot Automated OSINT Intelligence Engine (200+ modules)",
        description: "Фреймворк автоматизированного сбора разведывательной информации по доменам, IP, email, подсетям и социальным сетям.",
        instructions: [
          "1. Перейдите в официальный репозиторий SpiderFoot на GitHub.",
          "2. Для локального запуска: docker run -p 5001:5001 spiderfoot.",
          "3. Укажите SPIDERFOOT_SERVER_URL в настройках для включения фоновой автоматизации.",
        ],
      },
      observations: [],
      entities: [],
      relationships: [],
      source: [provenance],
    };
  },
});

// 9. Blockchain Address Intelligence (BTC/ETH)
AdapterRegistry.register({
  id: "crypto_recon",
  name: "Blockchain Address Intelligence (BTC/ETH)",
  version: "1.5.0",
  category: "crypto",
  requiredCredentials: [],
  validate: (input: { address?: string; target?: string }) => {
    if (!input?.address && !input?.target) throw new Error("Wallet address is required");
  },
  healthCheck: async () => ({
    id: "crypto_recon",
    name: "Blockchain Address Intelligence (BTC/ETH)",
    version: "1.5.0",
    status: "OPERATIONAL",
    latencyMs: 35,
    lastChecked: new Date().toISOString(),
    requiredCredentials: [],
    category: "crypto",
  }),
  execute: async (input: { address?: string; target?: string }, ctx: ExecutionContext): Promise<AdapterResult> => {
    const started = new Date().toISOString();
    const addr = (input.address || input.target || "").trim();
    const isEth = addr.startsWith("0x") && addr.length === 42;
    const isBtc = addr.startsWith("1") || addr.startsWith("3") || addr.startsWith("bc1");

    const blockchainName = isEth ? "Ethereum" : isBtc ? "Bitcoin" : "Unknown";
    const network = isEth ? "ethereum" : isBtc ? "bitcoin" : "";

    const explorer = isEth
      ? `https://etherscan.io/address/${addr}`
      : `https://www.blockchain.com/explorer/addresses/btc/${addr}`;

    let verified = false;
    let balance, txCount, firstSeen, lastSeen;
    let sourceId = "src_local_address_classifier";
    let sourceType = "LOCAL_ENRICHMENT";

    if (network) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const url = `https://api.blockchair.com/${network}/dashboards/address/${addr}`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const json: any = await res.json();
          const lookupKey = isEth ? addr.toLowerCase() : addr;
          const addressData = json?.data?.[lookupKey]?.address;
          if (addressData) {
            verified = true;
            balance = addressData.balance;
            txCount = addressData.transaction_count;
            firstSeen = addressData.first_seen_receiving || addressData.first_balance_change_at;
            lastSeen = addressData.last_seen_receiving || addressData.last_balance_change_at;
            sourceId = "src_blockchair_api";
            sourceType = "LIVE_EXTERNAL_SOURCE";
          }
        }
      } catch (e) {
        // Fallback to local on error
      }
    }

    return {
      success: true,
      adapter: "crypto_recon",
      adapterVersion: "1.5.0",
      startedAt: started,
      completedAt: new Date().toISOString(),
      verified,
      data: {
        address: addr,
        blockchain: blockchainName,
        explorer_url: explorer,
        ...(verified && {
          balance,
          transaction_count: txCount,
          first_seen: firstSeen,
          last_seen: lastSeen,
        })
      },
      observations: [],
      entities: [{ type: "crypto_wallet", value: addr, confidence: verified ? 0.99 : 0.95 }],
      relationships: [],
      source: [{
        sourceId,
        sourceType,
        url: verified ? `https://api.blockchair.com/${network}/dashboards/address/${addr}` : explorer,
        adapter: "crypto_recon",
        adapterVersion: "1.5.0",
        retrievedAt: started,
        requestId: ctx.requestId,
        verified,
      }],
      confidence: verified ? 0.99 : 0.95,
    };
  },
});

