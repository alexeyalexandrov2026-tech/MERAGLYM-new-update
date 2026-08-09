import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

interface NodeRow {
  id: number;
  name: string;
  type: string;
  description: string | null;
  url: string | null;
}

export async function POST(request: Request) {
  try {
    const body = ((await request.json()) || {}) as Record<string, unknown>;
    const prompt = (body?.prompt || body?.message || "").toString().trim();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    let matchedNodes: NodeRow[] = [];
    try {
      const results = await prisma.node.findMany({
        where: {
          OR: [
            { name: { contains: prompt } },
            { description: { contains: prompt } },
            { bestFor: { contains: prompt } },
            { input: { contains: prompt } },
            { output: { contains: prompt } }
          ]
        },
        take: 5
      });
      matchedNodes = results as NodeRow[];
    } catch (e) {
      console.warn("Prisma chat query fallback:", e);
    }

    const answer = generateOSINTAIResponse(prompt, matchedNodes);

    return NextResponse.json({
      answer,
      sources: matchedNodes.map((n) => ({ id: n.id, name: n.name, url: n.url })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in chat route:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const prompt = (searchParams.get("prompt") || searchParams.get("q") || "").trim();

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  let matchedNodes: NodeRow[] = [];
  try {
    const results = await prisma.node.findMany({
      where: {
        OR: [
          { name: { contains: prompt } },
          { description: { contains: prompt } },
          { bestFor: { contains: prompt } }
        ]
      },
      take: 5
    });
    matchedNodes = results as NodeRow[];
  } catch (e) {
    console.warn("Prisma chat query fallback:", e);
  }

  const answer = generateOSINTAIResponse(prompt, matchedNodes);

  return NextResponse.json({
    answer,
    sources: matchedNodes.map((n) => ({ id: n.id, name: n.name, url: n.url })),
    timestamp: new Date().toISOString()
  });
}

function generateOSINTAIResponse(prompt: string, nodes: NodeRow[]): string {
  const lower = prompt.toLowerCase();
  const isRussian = /[а-яА-ЯёЁ]/.test(prompt);

  if (isRussian) {
    if (lower.includes("привет") || lower.includes("здравствуй") || lower.includes("кто ты")) {
      return `Приветствую! Я ИИ-агент платформы разведки **MERAGLYM Open Intelligence**. Я готов ответить на любые вопросы по OSINT-разведке, анализу сущностей, поиску угроз (CTI) и использованию специализированных инструментов. Как я могу вам помочь?`;
    }
    
    if (nodes && nodes.length > 0) {
      const toolList = nodes.map((n) => `• **${n.name}** (${n.type}): ${n.description || 'Инструмент разведки'} ${n.url ? `[Ссылка](${n.url})` : ''}`).join('\n');
      return `По вашему запросу «*${prompt}*» я нашёл следующие релевантные инструменты в базе данных разведки MERAGLYM:\n\n${toolList}\n\nВы можете запустить разведку или запросить детальную инструкцию по любому из этих адаптеров.`;
    }

    if (lower.includes("email") || lower.includes("почт")) {
      return `Для проведения OSINT-разведки по Email адресам рекомендуются следующие методы:\n1. **Holehe / GHunt**: Проверка регистрации Email на 120+ веб-сервисах и сервисах Google.\n2. **EPIOS & Epieos**: Поиск профилей и скрытых учетных записей по адресам электронной почты.\n3. **DeHashed & HaveIBeenPwned**: Проверка утечек учетных данных и хешей паролей.\n\nЗапустите эти адаптеры через панель задач (Jobs Panel) в MERAGLYM.`;
    }

    if (lower.includes("phone") || lower.includes("телефон") || lower.includes("номер")) {
      return `Для проверки номеров телефонов в OSINT системе доступно сочетание адаптеров:\n1. **Ignorant**: Разведка привязки номера к аккаунтам в мессенджерах.\n2. **PhoneInfoga**: Автоматический анализ кодов стран, операторов и утекших реестров.\n3. **Telegram OSINT Bot Adapters**: Поиск упоминаний и каналов.`;
    }

    return `Анализ запроса «*${prompt}*» выполнен успешно. В базе знаний MERAGLYM проиндексировано более 1300+ OSINT ресурсов. Рекомендуется воспользоваться поисковой панелью (Search Panel) или запустить автоматизированный адаптер корреляции сущностей.`;
  } else {
    if (lower.includes("hello") || lower.includes("hi") || lower.includes("who are you")) {
      return `Hello! I am the **MERAGLYM Open Intelligence AI Agent**. I can assist you with OSINT queries, threat intelligence analysis (CTI), entity resolution, and tool selection. How can I help you today?`;
    }

    if (nodes && nodes.length > 0) {
      const toolList = nodes.map((n) => `• **${n.name}** (${n.type}): ${n.description || 'Intelligence Tool'} ${n.url ? `[Link](${n.url})` : ''}`).join('\n');
      return `Based on your query "*${prompt}*", I retrieved the following matching intelligence resources:\n\n${toolList}`;
    }

    return `Processed query "*${prompt}*". MERAGLYM Intelligence Engine indexed 1300+ OSINT resources. Use the Search Panel or trigger automated adapter pipelines in the Jobs Panel to run direct queries.`;
  }
}
