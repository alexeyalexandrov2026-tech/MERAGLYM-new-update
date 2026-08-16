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

async function executeSearch(rawQuery: string, _category: string | null, _env?: Env): Promise<Response> {
  const query = rawQuery.trim();

  if (!query) {
    return Response.json([]);
  }

  if (query.length > 200) {
    return Response.json({ error: "Query is too long" }, { status: 400 });
  }

  const qLower = query.toLowerCase();

  // Filter catalog items
  const catalogMatches = STATIC_SEARCH_CATALOG.filter((item) => {
    return (
      item.name.toLowerCase().includes(qLower) ||
      (item.description && item.description.toLowerCase().includes(qLower)) ||
      (item.bestFor && item.bestFor.toLowerCase().includes(qLower)) ||
      (item.url && item.url.toLowerCase().includes(qLower))
    );
  });

  return Response.json(catalogMatches);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
  const category = url.searchParams.get("category");
  return executeSearch(query, category, env);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as { query?: string; q?: string; category?: string };
    const query = body.query || body.q || "";
    const category = body.category || null;
    return executeSearch(query, category, env);
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body for search request" } }, { status: 400 });
  }
};


