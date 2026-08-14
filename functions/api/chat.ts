interface Env {
  DB?: D1Database;
  AI?: {
    run: (model: string, options: unknown) => Promise<{ response?: string; description?: string }>;
  };
}

interface NodeRow {
  id: number;
  name: string;
  type: string;
  description: string | null;
  url: string | null;
  bestFor?: string | null;
  [key: string]: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const prompt = (body?.prompt || body?.message || "").toString().trim();
    const userLocale = (body?.locale || "").toString().trim().toLowerCase();

    if (!prompt) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }

    return await handleChatQuery(prompt, userLocale, env);
  } catch (error) {
    console.error("Error processing chat request:", error);
    return Response.json({ error: "Failed to process request", details: String(error) }, { status: 500 });
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const prompt = url.searchParams.get("prompt")?.trim() || url.searchParams.get("q")?.trim() || "";
  const userLocale = url.searchParams.get("locale")?.trim().toLowerCase() || "";

  if (!prompt) {
    return Response.json({ error: "Prompt parameter is required" }, { status: 400 });
  }

  return await handleChatQuery(prompt, userLocale, env);
};

async function handleChatQuery(prompt: string, userLocale: string, env: Env) {
  let matchedNodes: NodeRow[] = [];

  if (env?.DB) {
    try {
      const pattern = `%${prompt}%`;
      const { results } = await env.DB.prepare(
        `SELECT * FROM Node 
         WHERE name LIKE ? OR description LIKE ? OR bestFor LIKE ? OR input LIKE ? OR output LIKE ? 
         LIMIT 6`
      ).bind(pattern, pattern, pattern, pattern, pattern).all();
      matchedNodes = (results as unknown as NodeRow[]) || [];
    } catch (e) {
      console.warn("D1 lookup during chat failed or empty:", e);
    }
  }

  const isRussian = userLocale === "ru" || /[а-яА-ЯёЁ]/.test(prompt);

  // 1. Try Cloudflare Workers AI if available
  if (env?.AI) {
    try {
      const context = matchedNodes.map((n) => `- ${n.name}: ${n.description} (URL: ${n.url || "N/A"})`).join("\n");
      const systemPrompt = `You are MERAGLYM AI Agent, an elite Open Source Intelligence (OSINT) and Cyber Threat Intelligence assistant. Answer user questions accurately, with step-by-step methodologies in ${isRussian ? "Russian" : "English"}.\nRelevant OSINT Tools Context:\n${context || "No specific tools found in database."}`;

      const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      });

      const responseText = aiResponse?.response || aiResponse?.description || "";
      if (responseText) {
        return Response.json({
          answer: responseText,
          sources: matchedNodes.map((n) => ({ id: n.id, name: n.name, url: n.url })),
          timestamp: new Date().toISOString(),
        });
      }
    } catch (aiErr) {
      console.warn("Workers AI execution fallback:", aiErr);
    }
  }

  // 2. Specialized Tactical OSINT Intelligence Generator
  const responseText = generateTacticalOSINTResponse(prompt, isRussian, matchedNodes);

  return Response.json({
    answer: responseText,
    sources: matchedNodes.map((n) => ({ id: n.id, name: n.name, url: n.url })),
    timestamp: new Date().toISOString(),
  });
}

function generateTacticalOSINTResponse(prompt: string, isRussian: boolean, nodes: NodeRow[]): string {
  const lower = prompt.toLowerCase();

  if (isRussian) {
    if (lower.includes("привет") || lower.includes("здравствуй") || lower.includes("кто ты") || lower.includes("start")) {
      return `Приветствую! Я ИИ-агент платформы разведки **MERAGLYM Open Intelligence**.\n\nЯ помогу вам провести глубокую разведку по любым целям:\n• **Реестры РФ и СНГ**: ЕГРЮЛ, ФНС, БО Налог, ГАС Правосудие, КАД Арбитраж, ФССП, ЕФРСБ, МВД розыск\n• **Проверка Email и аккаунтов**: Holehe, GHunt, Epieos, DeHashed\n• **Телефоны и соцсети**: PhoneInfoga, Maigret, Telegram OSINT\n• **Киберразведка и угрозы**: STIX 2.1, OpenCTI, SpiderFoot\n• **Блокчейн и DarkNet**: BTC/ETH трейсинг, TorBot\n\nНапишите ваш запрос или выберите готовый сценарий!`;
    }

    if (lower.includes("инн") || lower.includes("огрн") || lower.includes("налог") || lower.includes("компан") || lower.includes("егрюл") || lower.includes("бо налог")) {
      return `📋 **Методика проверки юридических лиц и ИП в РФ (MERAGLYM CIS Layer):**\n\n1. **ЕГРЮЛ / ФНС (egrul.nalog.ru)**: Получение официальной выписки, проверка статуса (действующая / ликвидирована), учредителей, генерального директора, юридического адреса и истории изменений.\n2. **ГИР БО (bo.nalog.ru / RFSD Adapter)**: Анализ бухгалтерского баланса, динамики выручки, чистой прибыли и кредиторской задолженности.\n3. **КАД Арбитраж (kad.arbitr.ru)**: Поиск судебных исков, споров с контрагентами, банкротных производств.\n4. **ФССП (fssp.gov.ru)**: Проверка непогашенных исполнительных листов и арестов счетов.\n5. **ЕФРСБ (bankrot.fedresurs.ru)**: Проверка наличия сообщений о намерении обратиться в суд с заявлением о банкротстве.\n\n💡 *Вы можете запустить прямой запрос к адаптерам egrul_registry, fns_tax или rfsd_financials через панель задач.*`;
    }

    if (lower.includes("физлиц") || lower.includes("человек") || lower.includes("мвд") || lower.includes("суд") || lower.includes("пристав") || lower.includes("роспуск") || lower.includes("розыск")) {
      return `👤 **Методика комплексной проверки физического лица в РФ:**\n\n1. **МВД РФ Розыск (мвд.рф/wanted / MvdAdapter)**: Проверка нахождения в федеральном или межгосударственном розыске по ФИО и дате рождения.\n2. **ГАС Правосудие (sudrf.ru / SudrfAdapter)**: Поиск уголовных, гражданских и административных дел в судах общей юрисдикции по месту жительства и регистрации.\n3. **Банк данных ФССП (fssp.gov.ru / FsspAdapter)**: Выявление долгов по кредитам, налогам, штрафам ГИБДД и алиментам.\n4. **Реестр банкротств (bankrot.fedresurs.ru / EfrsbAdapter)**: Проверка статуса банкротства гражданина.\n5. **ИНН физического лица (service.nalog.ru)**: Определение ИНН по паспортным данным для последующего поиска статуса самозанятого или учредителя бизнеса.`;
    }

    if (lower.includes("email") || lower.includes("почт") || lower.includes("holehe") || lower.includes("ghunt")) {
      return `✉️ **Методика OSINT-разведки по Email адресам:**\n\n1. **Holehe Recon (holehe_recon)**: Проверка привязки адреса к 120+ сервисам (Instagram, Twitter, Spotify, GitHub, Delivery, Pornhub и др.) без отправки уведомлений жертве.\n2. **GHunt (email_recon)**: Извлечение скрытых данных аккаунта Google (имя, Google ID, фото профиля, отзывы на Google Maps с геолокацией, календарь).\n3. **Epieos / DeHashed**: Проверка наличия адреса в утекших базах данных паролей и компрометации.\n4. **DNS MX & SPF/DMARC**: Анализ корпоративного почтового сервера и конфигурации безопасности.`;
    }

    if (lower.includes("phone") || lower.includes("телефон") || lower.includes("номер")) {
      return `📱 **Методика проверки номеров телефонов:**\n\n1. **PhoneInfoga**: Определение валидности формата E.164, оператора связи (MNP перенос), региона регистрации и репутационного скоринга.\n2. **Мессенджер-разведка (Telegram / WhatsApp / Viber)**: Поиск аватаров, никнеймов и публичных профилей.\n3. **Утечки и реестры**: Проверка привязки номера к объявлениям (Avito, Циан, Auto.ru) и базам доставки.`;
    }

    if (lower.includes("крипт") || lower.includes("btc") || lower.includes("eth") || lower.includes("usdt") || lower.includes("tron") || lower.includes("блокчейн")) {
      return `💰 **Методика расследования криптовалютных транзакций (Legendary Crypto):**\n\n1. **Кластеризация адресов**: Объединение кошельков на основе анализа входов с общими расходами (Common-input ownership heuristic).\n2. **Выявление биржевых депозитов**: Идентификация кошельков Binance, Bybit, Garantex, OKX для направления официальных запросов.\n3. **Анализ смарт-контрактов**: Проверка взаимодействия с миксерами (Tornado Cash), мостами (Bridges) и DeFi-протоколами.`;
    }

    if (lower.includes("stix") || lower.includes("opencti") || lower.includes("корреляц") || lower.includes("граф")) {
      return `🛡️ **Граф киберразведки и модель STIX 2.1 в MERAGLYM:**\n\n• Платформа автоматически нормализует разрозненные наблюдения (Observations) от всех 19 адаптеров в единый граф сущностей (Entity Graph).\n• Модуль **Entity Resolution** устраняет дубликаты и склеивает псевдонимы (например, никнейм, email и телефон одного субъекта).\n• Модуль **STIX 2.1 Ingest** поддерживает стандартизированные объекты: threat-actor, indicator, malware, identity, observed-data для бесшовного экспорта в OpenCTI и SIEM.`;
    }

    if (nodes && nodes.length > 0) {
      const toolList = nodes
        .map((n) => `• **${n.name}** (${n.type}): ${n.description || "Инструмент разведки"} ${n.url ? `[Ссылка](${n.url})` : ""}`)
        .join("\n");
      return `По вашему запросу «*${prompt}*» в базе знаний MERAGLYM найдены следующие инструменты:\n\n${toolList}\n\nВы можете запустить выбранный инструмент или запросить пошаговую инструкцию по его интеграции.`;
    }

    return `Запрос «*${prompt}*» проанализирован ядром разведки MERAGLYM. В базе проиндексировано более 1300+ инструментов и 19 активных адаптеров. Воспользуйтесь панелью глобального поиска или запустите адаптер через Очередь задач (Worker Jobs).`;
  } else {
    // English responses
    if (lower.includes("hello") || lower.includes("hi") || lower.includes("who are you") || lower.includes("start")) {
      return `Hello! I am the **MERAGLYM Open Intelligence AI Agent**.\n\nI can assist you with:\n• **CIS & Russian Corporate / Person Intelligence**: EGRUL, FNS, Bo Nalog, SudRF, KAD Arbitr, FSSP, EFRSB, MVD Wanted\n• **Email & Account Reconnaissance**: Holehe, GHunt, Epieos, DeHashed\n• **Phone & Social Media Recon**: PhoneInfoga, Maigret, Telegram OSINT\n• **Cyber Threat Intelligence**: STIX 2.1, OpenCTI, SpiderFoot\n• **Cryptocurrency & DarkNet**: BTC/ETH tracing, TorBot\n\nAsk any question or select a quick query from the suggestions above!`;
    }

    if (lower.includes("inn") || lower.includes("company") || lower.includes("fns") || lower.includes("russia") || lower.includes("egrul")) {
      return `📋 **Methodology for Investigating Russian Legal Entities (MERAGLYM CIS Layer):**\n\n1. **EGRUL / FNS (egrul.nalog.ru)**: Official company profile, active/liquidated status, founders, general director, registered address, and historical changes.\n2. **GIR BO (bo.nalog.ru / RFSD Adapter)**: Financial statements, revenue, net profit, balance sheet, and financial solvency.\n3. **KAD Arbitr (kad.arbitr.ru)**: Active commercial arbitration cases, disputes, and bankruptcy filings.\n4. **FSSP (fssp.gov.ru)**: Outstanding court enforcement proceedings and asset freezes.\n5. **EFRSB (bankrot.fedresurs.ru)**: Formal bankruptcy registries and auction records.`;
    }

    if (lower.includes("email") || lower.includes("holehe") || lower.includes("ghunt")) {
      return `✉️ **Email Reconnaissance Methodology:**\n\n1. **Holehe (holehe_recon)**: Passively detects account registrations across 120+ online platforms without alerting the target.\n2. **GHunt (email_recon)**: Extracts target Google metadata (Google Gaia ID, name, Google Maps reviews with coordinates, YouTube activity).\n3. **Epieos / HaveIBeenPwned**: Checks public breaches and associated profile avatars.\n4. **MX & Security Headers**: Analyzes corporate mail server configuration.`;
    }

    if (lower.includes("crypto") || lower.includes("btc") || lower.includes("blockchain")) {
      return `💰 **Cryptocurrency Tracing Methodology (Legendary Crypto):**\n\n1. **Cluster Identification**: Groups addresses using common-input heuristics.\n2. **Exchange Attribution**: Identifies known deposit/withdrawal addresses of major exchanges.\n3. **Bridge & Mixer Detection**: Traces funds moving through cross-chain bridges or Tornado Cash.`;
    }

    if (lower.includes("stix") || lower.includes("opencti") || lower.includes("graph")) {
      return `🛡️ **MERAGLYM Threat Graph & STIX 2.1 Architecture:**\n\n• Unifies observations from all 19 adapters into a canonical Graph.\n• Real-time **Entity Resolution** merges aliases, emails, and phone numbers.\n• Supports standard STIX 2.1 objects: threat-actor, indicator, malware, identity for seamless OpenCTI integration.`;
    }

    if (nodes && nodes.length > 0) {
      const toolList = nodes
        .map((n) => `• **${n.name}** (${n.type}): ${n.description || "Intelligence Resource"} ${n.url ? `[Link](${n.url})` : ""}`)
        .join("\n");
      return `Matching intelligence resources for "*${prompt}*":\n\n${toolList}`;
    }

    return `Processed query "*${prompt}*". MERAGLYM Intelligence Engine indexed 1300+ OSINT resources and 19 active adapters. Use the Search Panel or trigger automated worker pipelines in the Jobs Panel.`;
  }
}
