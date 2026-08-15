interface Env {
  DB?: D1Database;
}

interface NodeRecord {
  id: number;
  parentId: number | null;
  name: string;
  type: string;
  url?: string | null;
  description?: string | null;
  status?: string | null;
  pricing?: string | null;
  bestFor?: string | null;
  input?: string | null;
  output?: string | null;
  opsec?: string | null;
  opsecNote?: string | null;
  localInstall?: boolean;
  googleDork?: boolean;
  registration?: boolean;
  editUrl?: boolean;
  api?: boolean;
  invitationOnly?: boolean;
  deprecated?: boolean;
}

const STATIC_SEARCH_CATALOG: NodeRecord[] = [
  {
    id: 101,
    parentId: 100,
    name: "ФНС / ЕГРЮЛ (egrul.nalog.ru)",
    type: "url",
    url: "https://egrul.nalog.ru",
    description: "Официальный реестр юридических лиц и ИП ФНС России. Поиск по ИНН, ОГРН, наименованию.",
    status: "Active",
    bestFor: "Поиск реквизитов компаний, учредителей, директоров и выписок ЕГРЮЛ",
    api: true,
  },
  {
    id: 102,
    parentId: 100,
    name: "БО Налог / RFSD (bo.nalog.ru)",
    type: "url",
    url: "https://bo.nalog.ru",
    description: "Государственный информационный ресурс бухгалтерской (финансовой) отчетности организаций (ГИР БО).",
    status: "Active",
    bestFor: "Анализ баланса, выручки, чистой прибыли и финансовых рисков компаний РФ",
    api: true,
  },
  {
    id: 103,
    parentId: 100,
    name: "ГАС Правосудие / СудРФ (sudrf.ru)",
    type: "url",
    url: "https://sudrf.ru",
    description: "Единая база судов общей юрисдикции РФ. Поиск уголовных, гражданских и административных дел.",
    status: "Active",
    bestFor: "Проверка физлиц и компаний на участие в судебных разбирательствах",
  },
  {
    id: 104,
    parentId: 100,
    name: "КАД Арбитраж (kad.arbitr.ru)",
    type: "url",
    url: "https://kad.arbitr.ru",
    description: "Картотека арбитражных дел Российской Федерации. Споры между юридическими лицами.",
    status: "Active",
    bestFor: "Арбитражные иски, взыскания задолженностей и банкротные дела",
  },
  {
    id: 105,
    parentId: 100,
    name: "ФССП Банк данных (fssp.gov.ru)",
    type: "url",
    url: "https://fssp.gov.ru",
    description: "Банк данных исполнительных производств Федеральной службы судебных приставов.",
    status: "Active",
    bestFor: "Проверка задолженностей, штрафов и арестов имущества",
  },
  {
    id: 106,
    parentId: 100,
    name: "ЕФРСБ Банкротства (bankrot.fedresurs.ru)",
    type: "url",
    url: "https://bankrot.fedresurs.ru",
    description: "Единый федеральный реестр сведений о банкротстве юридических и физических лиц.",
    status: "Active",
    bestFor: "Проверка статуса несостоятельности (банкротства) должников",
  },
  {
    id: 107,
    parentId: 100,
    name: "Розыск МВД РФ (мвд.рф/wanted)",
    type: "url",
    url: "https://xn--b1aew.xn--p1ai/wanted",
    description: "База данных лиц, находящихся в федеральном и межгосударственном розыске МВД РФ.",
    status: "Active",
    bestFor: "Проверка нахождения физического лица в уголовном розыске",
  },
  {
    id: 201,
    parentId: 200,
    name: "Holehe OSINT Recon",
    type: "url",
    url: "#launch-tool",
    description: "Автоматизированная проверка регистрации адреса электронной почты на более чем 120+ веб-сайтах и сервисах.",
    status: "Active",
    bestFor: "Определение платформ и сервисов, где зарегистрирован целевой email",
    localInstall: true,
  },
  {
    id: 202,
    parentId: 200,
    name: "GHunt Google OSINT",
    type: "url",
    url: "#launch-tool",
    description: "Модульный инструмент для исследования учетных записей Google по Gmail-адресу, Google ID или Maps.",
    status: "Active",
    bestFor: "Извлечение имени, Gaia ID, отзывов Google Maps, альбомов и активности",
    localInstall: true,
  },
  {
    id: 203,
    parentId: 200,
    name: "Epieos Email Lookup",
    type: "url",
    url: "https://epieos.com",
    description: "Обратный поиск по email без отправки оповещений цели. Проверка Google, Skype, Proton, Gravatar.",
    status: "Active",
    bestFor: "Быстрая пассивная разведка учетных записей по почте",
  },
  {
    id: 301,
    parentId: 300,
    name: "Maigret Username Hunter",
    type: "url",
    url: "#launch-tool",
    description: "Сбор досье на человека по никнейму более чем на 3000+ сайтах и платформах.",
    status: "Active",
    bestFor: "Поиск профилей пользователя, веб-страниц и связывание псевдонимов",
    localInstall: true,
  },
  {
    id: 302,
    parentId: 300,
    name: "PhoneInfoga Phone Recon",
    type: "url",
    url: "#launch-tool",
    description: "Продвинутый инструмент разведки телефонных номеров с использованием открытых источников и Google Dorks.",
    status: "Active",
    bestFor: "Определение оператора, страны, формата E.164 и утекших реестров",
    localInstall: true,
  },
  {
    id: 401,
    parentId: 400,
    name: "SpiderFoot OSINT Automation",
    type: "url",
    url: "#launch-tool",
    description: "Автоматизированная платформа разведки для сбора данных об IP, доменах, CIDR, email и сетях.",
    status: "Active",
    bestFor: "Глубокая автоматическая разведка доменной инфраструктуры",
    localInstall: true,
  },
  {
    id: 402,
    parentId: 400,
    name: "STIX 2.1 & OpenCTI Connector",
    type: "url",
    url: "#launch-tool",
    description: "Шлюз нормализации киберразведки в стандарт STIX 2.1 для построения графов угроз.",
    status: "Active",
    bestFor: "Сопоставление индикаторов компрометации (IoC), TTPs и хакерских группировок",
    api: true,
  },
  {
    id: 501,
    parentId: 500,
    name: "GeoWiFi & WiGLE BSSID Locator",
    type: "url",
    url: "https://wigle.net",
    description: "Геолокация беспроводных точек доступа по BSSID / MAC-адресам через базу WiGLE.",
    status: "Active",
    bestFor: "Точное определение физических координат роутеров и мобильных точек",
    api: true,
  },
  {
    id: 502,
    parentId: 500,
    name: "CCTVScan & Shodan Camera Recon",
    type: "url",
    url: "https://www.shodan.io",
    description: "Поиск открытых потоков камер видеонаблюдения, веб-камер и RTSP/HTTP стримов.",
    status: "Active",
    bestFor: "Обнаружение публично доступных камер по геолокации или ASN",
  },
  {
    id: 601,
    parentId: 600,
    name: "Legendary Crypto & Blockchain Tracing",
    type: "url",
    url: "#launch-tool",
    description: "Анализ транзакций, кластеризация кошельков и отслеживание перемещений в сетях Bitcoin, Ethereum, Tron.",
    status: "Active",
    bestFor: "Аудит криптовалютных транзакций и выявление биржевых депозитов",
    api: true,
  },
  {
    id: 602,
    parentId: 600,
    name: "TorBot DarkWeb Crawler",
    type: "url",
    url: "#launch-tool",
    description: "OSINT-инструмент для глубокого сбора информации и сканирования .onion ресурсов в сети Tor.",
    status: "Active",
    bestFor: "Сбор ссылок, заголовков и метаданных сайтов теневого интернета",
    localInstall: true,
  },
];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return Response.json([]);
  }

  if (query.length > 200) {
    return Response.json({ error: "Query is too long" }, { status: 400 });
  }

  const qLower = query.toLowerCase();

  // Dynamic Synthesis for Direct Search Queries (Phone, INN, Email, Person, Crypto)
  const syntheticResults: NodeRecord[] = [];

  const isPhone = /^(\+?\d{1,4}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}$/.test(query.replace(/\s+/g, "")) || (query.length >= 7 && /^\+?\d+$/.test(query.replace(/[\s()-]/g, "")));
  const isInn = /^\d{10}$|^\d{12}$/.test(query.trim());
  const isEmail = query.includes("@") && query.includes(".");
  const isCrypto = (query.startsWith("1") || query.startsWith("3") || query.startsWith("bc1") || query.startsWith("0x")) && query.length > 24;

  if (isPhone) {
    syntheticResults.push({
      id: 9901,
      parentId: 300,
      name: `📱 PhoneInfoga OSINT Разведка Телефона: ${query}`,
      type: "phone_recon",
      url: "#launch-tool",
      description: `Анализ номера ${query}: Валидация формата E.164, определение оператора связи (МТС/Мегафон/Билайн/T-Mobile), MNP-перенос, мессенджеры Telegram/WhatsApp и утекшие объявления.`,
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: `Разведка владельца номера ${query}`,
      input: query,
      output: "Оператор, регион, Telegram ID, WhatsApp статус, Avito",
      opsec: "Low",
      localInstall: true,
    });

    syntheticResults.push({
      id: 9905,
      parentId: 300,
      name: `👤 Идентификатор Владельца Номера (Reverse Phone Lookup): ${query}`,
      type: "phone_person_correlator",
      url: "#launch-tool",
      description: `Высокотехнологичный модуль корреляции ФИО и личности по номеру ${query}: Запросы в ЕГРИП/Госзакупки, извлечение профиля VCard Telegram/WhatsApp и дорки Авито/HH.ru.`,
      status: "Active",
      pricing: "Free / In-Project High-Tech Module",
      bestFor: `Установление ФИО, псевдонима и бизнеса по номеру ${query}`,
      input: query,
      output: "ФИО владельца, ИП/ООО связка, Telegram VCard, Dorking findings",
      opsec: "High",
      localInstall: true,
    });
  }

  if (isInn || qLower.includes("сбер") || qLower.includes("яндекс") || qLower.includes("газпром") || qLower.includes("ооо") || qLower.includes("пао")) {
    syntheticResults.push({
      id: 9902,
      parentId: 100,
      name: `🏢 ЕГРЮЛ / ФНС / ГИР БО Разведка Компании (${query})`,
      type: "company_recon",
      url: "https://egrul.nalog.ru",
      description: `Комплексная выписка ЕГРЮЛ ФНС РФ по цели «${query}»: Проверка учредителей, генерального директора, финансовых отчетов БО Налог, арбитражных споров КАД и приставов ФССП.`,
      status: "Active",
      pricing: "Free / Official Registry",
      bestFor: `Глубокая корпоративная проверка по цели ${query}`,
      input: query,
      output: "Выписка ЕГРЮЛ, Бухгалтерский баланс, Судебные иски",
      opsec: "Low",
      api: true,
    });
  }

  if (isEmail) {
    syntheticResults.push({
      id: 9903,
      parentId: 200,
      name: `✉️ Holehe & GHunt OSINT Разведка Почты: ${query}`,
      type: "email_recon",
      url: "#launch-tool",
      description: `Пассивная проверка email адреса ${query} по 120+ веб-сервисам (Holehe) и извлечение Google Gaia ID, аватаров и отзывов Google Maps (GHunt).`,
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: `Разведка профилей и аккаунтов по ${query}`,
      input: query,
      output: "Зарегистрированные сервисы, Google ID, Breaches",
      opsec: "High",
      localInstall: true,
    });
  }

  if (isCrypto) {
    syntheticResults.push({
      id: 9904,
      parentId: 600,
      name: `💰 Legendary Crypto Трейсинг Кошелька: ${query}`,
      type: "crypto_recon",
      url: "#launch-tool",
      description: `Расследование криптовалютных транзакций кошелька ${query}: Кластеризация входов, выявление биржевых депозитов (Binance/Garantex/OKX) и отслеживание смарт-контрактов.`,
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: `Анализ движений средств кошелька ${query}`,
      input: query,
      output: "Баланс, Граф транзакций, Exchange Deposit",
      opsec: "Low",
      api: true,
    });
  }

  // Filter catalog items
  const catalogMatches = STATIC_SEARCH_CATALOG.filter((item) => {
    return (
      item.name.toLowerCase().includes(qLower) ||
      (item.description && item.description.toLowerCase().includes(qLower)) ||
      (item.bestFor && item.bestFor.toLowerCase().includes(qLower)) ||
      (item.url && item.url.toLowerCase().includes(qLower))
    );
  });

  const combined = [...syntheticResults, ...catalogMatches];

  // If query returned no exact catalog matches but user searched something, generate default OSINT resolution card
  if (combined.length === 0) {
    combined.push({
      id: 9999,
      parentId: 100,
      name: `🔍 Исполнительный Модуль Разведки MERAGLYM по запросу «${query}»`,
      type: "universal_recon",
      url: "#launch-tool",
      description: `Полномасштабный поиск и нормализация сущностей по запросу «${query}» в 19 базах данных и граф STIX 2.1.`,
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: `Запуск разведки по запросу ${query}`,
      input: query,
      output: "Граф сущностей STIX, результаты 19 адаптеров",
      opsec: "High",
      localInstall: true,
    });
  }

  return Response.json(combined);
};
