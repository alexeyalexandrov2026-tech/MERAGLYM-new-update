"use client";

import React, { useState, useEffect, useMemo } from "react";
import type { Node } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";

interface SidebarProps {
  initialNodes: Node[];
  onSelectNode: (node: Node) => void;
  selectedNodeId?: number | null;
}

const DEFAULT_ROOT_NODES: Node[] = [
  {
    id: 100,
    parentId: null,
    name: "🇷🇺 CIS & Russia Intelligence (Реестры и Базы РФ)",
    type: "folder",
    description: "Национальные реестры юридических лиц, налоговой службы, судов, банкротств и розыска",
    status: "Active",
    pricing: "Free",
    bestFor: "Корпоративная и персональная разведка по РФ и странам СНГ",
    url: null,
    input: "ИНН, ОГРН, ФИО, Паспорт",
    output: "ЕГРЮЛ, Бухгалтерский баланс, Исполнительные листы, Розыск",
    opsec: "Low",
    opsecNote: "Публичные государственные источники",
    localInstall: false,
    googleDork: false,
    registration: false,
    editUrl: false,
    api: true,
    invitationOnly: false,
    deprecated: false,
    createdAt: new Date(),
  },
  {
    id: 200,
    parentId: null,
    name: "✉️ Email & Account Reconnaissance (Почта и Утечки)",
    type: "folder",
    description: "Разведка учетных записей, привязок к сервисам и утечек учетных данных",
    status: "Active",
    pricing: "Free / Open Source",
    bestFor: "Проверка адресов электронной почты и профилей Google/Apple",
    url: null,
    input: "Email address",
    output: "Зарегистрированные сервисы, Gaia ID, альбомы",
    opsec: "High",
    opsecNote: "Пассивные проверки без отправки уведомлений жертве",
    localInstall: true,
    googleDork: false,
    registration: false,
    editUrl: false,
    api: true,
    invitationOnly: false,
    deprecated: false,
    createdAt: new Date(),
  },
  {
    id: 300,
    parentId: null,
    name: "📱 Phone & Social Media Intelligence (Телефоны и Соцсети)",
    type: "folder",
    description: "Поиск цифрового следа по номеру телефона, никнеймам и социальным платформам",
    status: "Active",
    pricing: "Free",
    bestFor: "Анализ никнеймов, номеров телефонов и мессенджеров (Telegram, VK, etc.)",
    url: null,
    input: "Phone number (E.164), Username",
    output: "Оператор связи, аккаунты в соцсетях, объявления",
    opsec: "Medium",
    opsecNote: "Сбор данных по публичным профилям",
    localInstall: true,
    googleDork: true,
    registration: false,
    editUrl: false,
    api: false,
    invitationOnly: false,
    deprecated: false,
    createdAt: new Date(),
  },
  {
    id: 400,
    parentId: null,
    name: "🌐 Network, Domain & Threat Intel (Домены, IP и CTI)",
    type: "folder",
    description: "Анализ доменов, DNS, WHOIS, инфраструктуры и сопоставление с графом угроз STIX/OpenCTI",
    status: "Active",
    pricing: "Free / Open Source",
    bestFor: "Киберразведка угроз, обнаружение C2-серверов и анализ инфраструктуры",
    url: null,
    input: "Domain, IP address, STIX Bundle",
    output: "WHOIS, DNS records, STIX Graph IoC",
    opsec: "Low",
    opsecNote: "Запросы к публичным DNS и WHOIS реестрам",
    localInstall: true,
    googleDork: false,
    registration: false,
    editUrl: false,
    api: true,
    invitationOnly: false,
    deprecated: false,
    createdAt: new Date(),
  },
  {
    id: 500,
    parentId: null,
    name: "🗺️ Geospatial, Wireless & IoT (Геолокация, Wi-Fi, Камеры)",
    type: "folder",
    description: "Определение координат по BSSID точек доступа, открытым камерам видеонаблюдения и снимкам",
    status: "Active",
    pricing: "Free API",
    bestFor: "Геопространственный анализ, поиск устройств и хронология",
    url: null,
    input: "BSSID MAC, Coordinates, IP range",
    output: "GPS координаты, адрес, RTSP видеопотоки",
    opsec: "Low",
    opsecNote: "Запросы к публичной базе WiGLE и Shodan",
    localInstall: false,
    googleDork: false,
    registration: false,
    editUrl: false,
    api: true,
    invitationOnly: false,
    deprecated: false,
    createdAt: new Date(),
  },
  {
    id: 600,
    parentId: null,
    name: "💰 Cryptocurrency & DarkNet (Крипта и Даркнет)",
    type: "folder",
    description: "Анализ блокчейнов BTC, ETH, TRON, смарт-контрактов и парсинг onion-сайтов Tor",
    status: "Active",
    pricing: "Free",
    bestFor: "Расследование транзакций, отслеживание криптокошельков и теневых форумов",
    url: null,
    input: "BTC/ETH/TRX Wallet, Onion URL",
    output: "Граф транзакций, баланс, метаданные сайтов .onion",
    opsec: "High",
    opsecNote: "Сбор через Tor прокси изолированный контейнер",
    localInstall: true,
    googleDork: false,
    registration: false,
    editUrl: false,
    api: true,
    invitationOnly: false,
    deprecated: false,
    createdAt: new Date(),
  },
];

const DEFAULT_CHILD_NODES: Record<number, Node[]> = {
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
      opsecNote: "Официальный публичный портал ФНС",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Официальный ресурс ФНС РФ",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Публичные судебные реестры",
      localInstall: false,
      googleDork: true,
      registration: false,
      editUrl: false,
      api: false,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Запросы к картотеке арбитража",
      localInstall: false,
      googleDork: true,
      registration: false,
      editUrl: false,
      api: false,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Публичный реестр должников ФССП",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: false,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Официальный реестр Федресурс",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Запрос к публичному сервису МВД",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: false,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный инструмент в проекте MERAGLYM",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Пассивный инспекционный сервис",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: false,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: true,
      registration: false,
      editUrl: false,
      api: false,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Запросы к API WiGLE",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Поисковый движок IoT устройств",
      localInstall: false,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
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
      opsecNote: "Интегрированный модуль проекта",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
    },
  ],
};

const TreeNode = ({
  node,
  level,
  onSelectNode,
  selectedNodeId,
}: {
  node: Node;
  level: number;
  onSelectNode: (node: Node) => void;
  selectedNodeId?: number | null;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const mightHaveChildren = node.type === "folder";
  const isSelected = selectedNodeId === node.id;

  const handleToggle = async () => {
    if (!expanded && !hasFetched && mightHaveChildren) {
      setLoading(true);
      try {
        const res = await fetch(`/api/nodes?parentId=${node.id}`);
        if (res.ok) {
          const data = (await res.json()) as Node[];
          if (Array.isArray(data) && data.length > 0) {
            setChildren(data);
          } else {
            setChildren(DEFAULT_CHILD_NODES[node.id] || []);
          }
        } else {
          setChildren(DEFAULT_CHILD_NODES[node.id] || []);
        }
      } catch (err) {
        console.warn("Failed to load node children from API, using default child fixtures:", err);
        setChildren(DEFAULT_CHILD_NODES[node.id] || []);
      } finally {
        setLoading(false);
        setHasFetched(true);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div style={{ marginLeft: level > 0 ? "14px" : "0" }}>
      <div
        className={`node-item ${isSelected ? "node-active" : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 12px",
          borderLeft: "2px solid transparent",
          color: isSelected ? "var(--text-accent)" : "var(--text-primary)",
          fontSize: "13px",
          userSelect: "none",
          cursor: "pointer",
        }}
        onClick={() => {
          if (mightHaveChildren) handleToggle();
          onSelectNode(node);
        }}
      >
        <span
          style={{
            marginRight: "6px",
            fontFamily: "var(--font-mono)",
            opacity: 0.7,
            width: "18px",
            display: "inline-block",
            textAlign: "center",
            fontSize: "11px",
          }}
        >
          {loading ? "..." : mightHaveChildren ? (expanded ? "[-]" : "[+]") : "›"}
        </span>
        <span
          style={{
            fontFamily: node.type === "folder" ? "var(--font-mono)" : "var(--font-sans)",
            fontWeight: node.type === "folder" ? "bold" : "normal",
            letterSpacing: node.type === "folder" ? "0.4px" : "normal",
            fontSize: node.type === "folder" ? "12px" : "13px",
          }}
        >
          {node.name}
        </span>
      </div>
      {expanded && children.length > 0 && (
        <div style={{ borderLeft: "1px dashed var(--border-muted)", marginLeft: "8px" }}>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              onSelectNode={onSelectNode}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function Sidebar({ initialNodes, onSelectNode, selectedNodeId }: SidebarProps) {
  const { t, locale } = useI18n();
  const hasInitialPassed = Boolean(initialNodes && initialNodes.length > 0);
  const [nodes, setNodes] = useState<Node[]>(hasInitialPassed ? initialNodes! : DEFAULT_ROOT_NODES);
  const [loading, setLoading] = useState(!hasInitialPassed);
  const [filterRegion, setFilterRegion] = useState<"ALL" | "CIS" | "GLOBAL">("ALL");
  const [searchFilter, setSearchFilter] = useState("");

  useEffect(() => {
    let isMounted = true;
    fetch("/api/nodes")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (isMounted && Array.isArray(data) && data.length > 0) {
          setNodes(data as Node[]);
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch root nodes from API, keeping default root fixtures:", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (searchFilter.trim()) {
        const query = searchFilter.toLowerCase();
        const matchName = node.name.toLowerCase().includes(query);
        const matchDesc = node.description ? node.description.toLowerCase().includes(query) : false;
        if (!matchName && !matchDesc) return false;
      }

      if (filterRegion === "CIS") {
        const isCis =
          node.name.toLowerCase().includes("cis") ||
          node.name.toLowerCase().includes("russia") ||
          node.name.toLowerCase().includes("рф") ||
          node.name.toLowerCase().includes("росси") ||
          node.name.toLowerCase().includes("егрюл") ||
          node.name.toLowerCase().includes("фнс") ||
          node.name.toLowerCase().includes("суд");
        return isCis;
      }

      if (filterRegion === "GLOBAL") {
        const isCis =
          node.name.toLowerCase().includes("cis") ||
          node.name.toLowerCase().includes("russia") ||
          node.name.toLowerCase().includes("рф") ||
          node.name.toLowerCase().includes("росси");
        return !isCis;
      }

      return true;
    });
  }, [nodes, filterRegion, searchFilter]);

  return (
    <div
      className="gotham-panel"
      style={{
        width: "360px",
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border-highlight)",
        borderTop: "none",
        borderBottom: "none",
        borderLeft: "none",
      }}
    >
      {/* Sticky Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-primary)",
          position: "sticky",
          top: 0,
          background: "var(--bg-panel)",
          zIndex: 10,
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <h2 style={{ color: "var(--text-accent)", fontSize: "14px", margin: 0 }}>
            {t("sidebar.rootCategories")}
          </h2>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            {filteredNodes.length} {t("sidebar.entries")}
          </div>
        </div>

        {/* Filter Pills */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
          <button
            onClick={() => setFilterRegion("ALL")}
            style={{
              flex: 1,
              padding: "3px 0",
              background: filterRegion === "ALL" ? "rgba(0, 255, 204, 0.15)" : "transparent",
              border: `1px solid ${filterRegion === "ALL" ? "var(--border-highlight)" : "var(--border-primary)"}`,
              color: filterRegion === "ALL" ? "var(--text-accent)" : "var(--text-secondary)",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              borderRadius: "2px",
            }}
          >
            {t("sidebar.filterAll")}
          </button>
          <button
            onClick={() => setFilterRegion("CIS")}
            style={{
              flex: 1,
              padding: "3px 0",
              background: filterRegion === "CIS" ? "rgba(0, 255, 204, 0.15)" : "transparent",
              border: `1px solid ${filterRegion === "CIS" ? "var(--border-highlight)" : "var(--border-primary)"}`,
              color: filterRegion === "CIS" ? "var(--text-accent)" : "var(--text-secondary)",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              borderRadius: "2px",
            }}
          >
            🇷🇺 {t("sidebar.filterCIS")}
          </button>
          <button
            onClick={() => setFilterRegion("GLOBAL")}
            style={{
              flex: 1,
              padding: "3px 0",
              background: filterRegion === "GLOBAL" ? "rgba(0, 255, 204, 0.15)" : "transparent",
              border: `1px solid ${filterRegion === "GLOBAL" ? "var(--border-highlight)" : "var(--border-primary)"}`,
              color: filterRegion === "GLOBAL" ? "var(--text-accent)" : "var(--text-secondary)",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              borderRadius: "2px",
            }}
          >
            🌐 {t("sidebar.filterGlobal")}
          </button>
        </div>

        {/* Quick Filter Input */}
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder={t("sidebar.searchTreePlaceholder")}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(0, 255, 204, 0.04)",
            border: "1px solid var(--border-primary)",
            color: "var(--text-primary)",
            padding: "6px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            borderRadius: "2px",
            outline: "none",
          }}
        />
      </div>

      {/* Tree View Nodes */}
      <div style={{ padding: "8px 0", flex: 1 }}>
        {loading && nodes.length === 0 && (
          <div style={{ padding: "20px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
            {t("sidebar.loading")}
          </div>
        )}

        {filteredNodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            onSelectNode={onSelectNode}
            selectedNodeId={selectedNodeId}
          />
        ))}

        {!loading && filteredNodes.length === 0 && (
          <div style={{ padding: "20px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px", textAlign: "center" }}>
            {locale === "ru" ? "Нет элементов по фильтру" : "No elements matching filter"}
          </div>
        )}
      </div>
    </div>
  );
}
