interface Env {
  DB: D1Database;
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

const FALLBACK_ROOT_NODES: NodeRecord[] = [
  {
    id: 100,
    parentId: null,
    name: "🇷🇺 CIS & Russia Intelligence (Реестры и Базы РФ)",
    type: "folder",
    description: "Национальные реестры юридических лиц, налоговой службы, судов, банкротств и розыска",
    status: "Active",
    bestFor: "Корпоративная и персональная разведка по РФ и странам СНГ",
  },
  {
    id: 200,
    parentId: null,
    name: "✉️ Email & Account Reconnaissance (Почта и Аккаунты)",
    type: "folder",
    description: "Разведка учетных записей, привязок к сервисам и утечек учетных данных",
    status: "Active",
    bestFor: "Проверка адресов электронной почты и профилей Google/Apple",
  },
  {
    id: 300,
    parentId: null,
    name: "📱 Phone & Social Media Intelligence (Телефоны и Соцсети)",
    type: "folder",
    description: "Поиск цифрового следа по номеру телефона, никнеймам и социальным платформам",
    status: "Active",
    bestFor: "Анализ никнеймов, номеров телефонов и мессенджеров (Telegram, VK, etc.)",
  },
  {
    id: 400,
    parentId: null,
    name: "🌐 Network, Domain & Threat Intel (Домены, IP и CTI)",
    type: "folder",
    description: "Анализ доменов, DNS, WHOIS, инфраструктуры и сопоставление с графом угроз STIX/OpenCTI",
    status: "Active",
    bestFor: "Киберразведка угроз, обнаружение C2-серверов и анализ инфраструктуры",
  },
  {
    id: 500,
    parentId: null,
    name: "🗺️ Geospatial, Wireless & IoT (Геолокация, Wi-Fi, Камеры)",
    type: "folder",
    description: "Определение координат по BSSID точек доступа, открытым камерам видеонаблюдения и спутниковым снимкам",
    status: "Active",
    bestFor: "Геопространственный анализ, поиск устройств и хронология",
  },
  {
    id: 600,
    parentId: null,
    name: "💰 Cryptocurrency & DarkNet (Крипта и Даркнет)",
    type: "folder",
    description: "Анализ блокчейнов BTC, ETH, TRON, смарт-контрактов и парсинг onion-сайтов Tor",
    status: "Active",
    bestFor: "Расследование транзакций, отслеживание криптокошельков и теневых форумов",
  },
];

const FALLBACK_CHILD_NODES: Record<number, NodeRecord[]> = {
  100: [
    {
      id: 101,
      parentId: 100,
      name: "ФНС / ЕГРЮЛ (egrul.nalog.ru)",
      type: "url",
      url: "https://egrul.nalog.ru",
      description: "Официальный реестр юридических лиц и ИП ФНС России. Поиск по ИНН, ОГРН, наименованию.",
      status: "Active",
      pricing: "Free",
      bestFor: "Поиск реквизитов компаний, учредителей, директоров и выписок ЕГРЮЛ",
      input: "ИНН, ОГРН, Название компании, ФИО",
      output: "Выписка ЕГРЮЛ PDF, статус, адрес, учредители",
      opsec: "Low",
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
      pricing: "Free",
      bestFor: "Анализ баланса, выручки, чистой прибыли и финансовых рисков компаний РФ",
      input: "ИНН или ОГРН",
      output: "Бухгалтерский баланс, отчет о прибылях и убытках",
      opsec: "Low",
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
      pricing: "Free",
      bestFor: "Проверка физлиц и компаний на участие в судебных разбирательствах",
      input: "ФИО, Наименование, Номер дела",
      output: "Карточка судебного дела, текст судебного акта",
      opsec: "Medium",
    },
    {
      id: 104,
      parentId: 100,
      name: "КАД Арбитраж (kad.arbitr.ru)",
      type: "url",
      url: "https://kad.arbitr.ru",
      description: "Картотека арбитражных дел Российской Федерации. Споры между юридическими лицами.",
      status: "Active",
      pricing: "Free",
      bestFor: "Арбитражные иски, взыскания задолженностей и банкротные дела",
      input: "ИНН, ОГРН, Название, ФИО судьи",
      output: "Определения, решения арбитражного суда",
      opsec: "Medium",
    },
    {
      id: 105,
      parentId: 100,
      name: "ФССП Банк данных (fssp.gov.ru)",
      type: "url",
      url: "https://fssp.gov.ru",
      description: "Банк данных исполнительных производств Федеральной службы судебных приставов.",
      status: "Active",
      pricing: "Free",
      bestFor: "Проверка задолженностей, штрафов и арестов имущества",
      input: "ФИО + Дата рождения, либо ИНН/Название",
      output: "Номер ИП, сумма задолженности, отдел пристава",
      opsec: "Low",
    },
    {
      id: 106,
      parentId: 100,
      name: "ЕФРСБ Банкротства (bankrot.fedresurs.ru)",
      type: "url",
      url: "https://bankrot.fedresurs.ru",
      description: "Единый федеральный реестр сведений о банкротстве юридических и физических лиц.",
      status: "Active",
      pricing: "Free",
      bestFor: "Проверка статуса несостоятельности (банкротства) должников",
      input: "ИНН, СНИЛС, ФИО, ОГРН",
      output: "Сообщения арбитражного управляющего, реестр торгов",
      opsec: "Low",
    },
    {
      id: 107,
      parentId: 100,
      name: "Розыск МВД РФ (мвд.рф/wanted)",
      type: "url",
      url: "https://xn--b1aew.xn--p1ai/wanted",
      description: "База данных лиц, находящихся в федеральном и межгосударственном розыске МВД РФ.",
      status: "Active",
      pricing: "Free",
      bestFor: "Проверка нахождения физического лица в уголовном розыске",
      input: "ФИО, Год рождения",
      output: "Ориентировка розыска, орган инициатор",
      opsec: "Medium",
    },
  ],
  200: [
    {
      id: 201,
      parentId: 200,
      name: "Holehe OSINT Recon",
      type: "url",
      url: "#launch-tool",
      description: "Автоматизированная проверка регистрации адреса электронной почты на более чем 120+ веб-сайтах и сервисах.",
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: "Определение платформ и сервисов, где зарегистрирован целевой email",
      input: "Email address",
      output: "Список сервисов с подтвержденной регистрацией",
      opsec: "High",
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
      pricing: "Free / In-Project Tool",
      bestFor: "Извлечение имени, Gaia ID, отзывов Google Maps, альбомов и активности",
      input: "Gmail address / Google Gaia ID",
      output: "Профиль Google, фото, отзывы, координаты активности",
      opsec: "High",
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
      pricing: "Freemium",
      bestFor: "Быстрая пассивная разведка учетных записей по почте",
      input: "Email address",
      output: "Ассоциированные аккаунты, имя, аватар",
      opsec: "Low",
    },
  ],
  300: [
    {
      id: 301,
      parentId: 300,
      name: "Maigret Username Hunter",
      type: "url",
      url: "#launch-tool",
      description: "Сбор досье на человека по никнейму более чем на 3000+ сайтах и платформах.",
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: "Поиск профилей пользователя, веб-страниц и связывание псевдонимов",
      input: "Username / Nickname",
      output: "Ссылки на найденные профили, метаданные, теги",
      opsec: "Medium",
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
      pricing: "Free / In-Project Tool",
      bestFor: "Определение оператора, страны, формата E.164 и утекших реестров",
      input: "Phone number (E.164)",
      output: "Оператор, страна, тип линии, результаты доркинга",
      opsec: "Low",
      localInstall: true,
    },
    {
      id: 303,
      parentId: 300,
      name: "Telegram OSINT Bot Adapters",
      type: "url",
      url: "#launch-tool",
      description: "Модули поиска упоминаний ID, каналов, истории сообщений и привязок Telegram.",
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: "Поиск по Telegram ID, публичным чатам и каналам",
      input: "Telegram ID / Username / Phone",
      output: "Группы, сообщения, аватары, история никнеймов",
      opsec: "High",
    },
  ],
  400: [
    {
      id: 401,
      parentId: 400,
      name: "SpiderFoot OSINT Automation",
      type: "url",
      url: "#launch-tool",
      description: "Автоматизированная платформа разведки для сбора данных об IP, доменах, CIDR, email и сетях.",
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: "Глубокая автоматическая разведка доменной инфраструктуры",
      input: "Domain / IP / Hostname",
      output: "Граф взаимосвязей, открытые порты, утечки",
      opsec: "Medium",
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
      pricing: "Free / In-Project Tool",
      bestFor: "Сопоставление индикаторов компрометации (IoC), TTPs и хакерских группировок",
      input: "STIX 2.1 Bundle / IoC / CVE",
      output: "Граф сущностей и взаимосвязей (Threat Graph)",
      opsec: "Low",
      api: true,
    },
  ],
  500: [
    {
      id: 501,
      parentId: 500,
      name: "GeoWiFi & WiGLE BSSID Locator",
      type: "url",
      url: "https://wigle.net",
      description: "Геолокация беспроводных точек доступа по BSSID / MAC-адресам через базу WiGLE.",
      status: "Active",
      pricing: "Free API",
      bestFor: "Точное определение физических координат роутеров и мобильных точек",
      input: "BSSID (MAC address) или SSID",
      output: "Широта, долгота, карта, уровень сигнала",
      opsec: "Low",
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
      pricing: "Freemium",
      bestFor: "Обнаружение публично доступных камер по геолокации или ASN",
      input: "Координаты, IP-диапазон, город",
      output: "IP, порт, снимок потока, статус авторизации",
      opsec: "Medium",
    },
  ],
  600: [
    {
      id: 601,
      parentId: 600,
      name: "Legendary Crypto & Blockchain Tracing",
      type: "url",
      url: "#launch-tool",
      description: "Анализ транзакций, кластеризация кошельков и отслеживание перемещений в сетях Bitcoin, Ethereum, Tron.",
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: "Аудит криптовалютных транзакций и выявление биржевых депозитов",
      input: "Кошелек BTC/ETH/TRX или хэш транзакции",
      output: "Баланс, граф транзакций, связанные адреса",
      opsec: "Low",
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
      pricing: "Free / In-Project Tool",
      bestFor: "Сбор ссылок, заголовков и метаданных сайтов теневого интернета",
      input: "Onion URL / Ключевые слова",
      output: "Карта сайта, адреса кошельков, email, статус доступности",
      opsec: "High",
      localInstall: true,
    },
  ],
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const parentIdParam = url.searchParams.get("parentId");

  let parentId: number | null = null;
  if (parentIdParam !== null && parentIdParam !== "null" && parentIdParam !== "") {
    if (/^\d+$/.test(parentIdParam)) {
      parentId = Number(parentIdParam);
    }
  }

  try {
    if (env?.DB) {
      let stmt;
      if (parentId === null) {
        stmt = env.DB.prepare("SELECT * FROM Node WHERE parentId IS NULL OR parentId = 1 ORDER BY id ASC");
      } else {
        stmt = env.DB.prepare("SELECT * FROM Node WHERE parentId = ? ORDER BY id ASC").bind(parentId);
      }
      const { results } = await stmt.all();

      if (results && results.length > 0) {
        const mapped = results.map((row: Record<string, unknown>) => {
          let rawUrl = row.url ? String(row.url) : null;
          if (rawUrl && rawUrl.includes("github.com")) {
            rawUrl = "#launch-tool";
          }
          return {
            ...row,
            url: rawUrl,
            localInstall: Boolean(row.localInstall),
            googleDork: Boolean(row.googleDork),
            registration: Boolean(row.registration),
            editUrl: Boolean(row.editUrl),
            api: Boolean(row.api),
            invitationOnly: Boolean(row.invitationOnly),
            deprecated: Boolean(row.deprecated),
          };
        });
        return Response.json(mapped);
      }
    }
  } catch (error) {
    console.warn("D1 query fallback to internal fixture nodes:", error);
  }

  // Graceful high-fidelity fallback fixture
  if (parentId === null) {
    return Response.json(FALLBACK_ROOT_NODES);
  } else {
    const children = FALLBACK_CHILD_NODES[parentId] || [];
    return Response.json(children);
  }
};
