type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
  imageUrl: string;
  imageAlt: string;
  imageCredit: string;
};

const trackedSources = [
  { name: "Ibá", description: "Indústria Brasileira de Árvores", url: "https://iba.org/" },
  { name: "Embrapa Florestas", description: "Pesquisa florestal brasileira", url: "https://www.embrapa.br/florestas/busca-de-noticias" },
  { name: "Serviço Florestal Brasileiro", description: "Políticas, dados e manejo florestal", url: "https://www.gov.br/florestal/pt-br/assuntos/noticias" },
  { name: "SNIF", description: "Sistema Nacional de Informações Florestais", url: "https://snif.florestal.gov.br/pt-br/" },
];

const fallbackItems: NewsItem[] = [
  {
    id: "iba-pinus-sc-2025",
    title: "Tecnologia e drones apoiam o reflorestamento de pinus em Santa Catarina",
    url: "https://iba.org/comunicacao/noticias-do-setor/noticias-noticias-do-setor/irani-usa-drones-e-tecnologia-como-aliados-no-reflorestamento-em-sc/",
    source: "Ibá · Irani",
    publishedAt: "2025-09-02T12:00:00.000Z",
    summary: "Monitoramento aéreo acompanha mudas, falhas de plantio e indicadores ambientais em 11,2 mil hectares de pinus no oeste catarinense.",
    imageUrl: "https://iba.org/wp-content/uploads/2025/09/25-09-02-noticias-IraniDrone.png",
    imageAlt: "Plantação de pinus monitorada por drone em Santa Catarina",
    imageCredit: "Foto: Irani / Ibá",
  },
  {
    id: "iba-carbono-2026",
    title: "Mercado de carbono atrai capital para o setor florestal brasileiro",
    url: "https://iba.org/comunicacao/iba-na-midia/noticias/mercado-de-carbono-atrai-capital-para-o-setor-florestal-diz-symbiosis/",
    source: "Ibá",
    publishedAt: "2026-07-27T12:00:00.000Z",
    summary: "Investimentos, reflorestamento, madeira de espécies nativas e créditos de carbono ganham escala no setor florestal brasileiro.",
    imageUrl: "https://iba.org/wp-content/uploads/2026/07/26-07-27poder360-symbiosis.jpeg",
    imageAlt: "Área florestal brasileira apresentada na reportagem sobre mercado de carbono",
    imageCredit: "Foto: Symbiosis / Ibá",
  },
  {
    id: "iba-bahia-carbono-2026",
    title: "Projeto na Bahia mira 500 mil créditos de carbono em 40 anos",
    url: "https://iba.org/comunicacao/noticias-do-setor/iba-na-midia-pt/projeto-na-bahia-mira-500-mil-creditos-de-carbono-em-40-anos/",
    source: "Ibá",
    publishedAt: "2026-07-22T12:00:00.000Z",
    summary: "Restauração com espécies nativas, investimento climático e expansão de projetos para outros biomas brasileiros.",
    imageUrl: "https://iba.org/wp-content/uploads/2026/07/26-07-22-projetoBahia.webp",
    imageAlt: "Paisagem de projeto de restauração florestal na Bahia",
    imageCredit: "Foto: Ibá",
  },
];

function decodeXml(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function textFrom(tag: string, xml: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function plainText(value: string) {
  return decodeXml(value.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ").trim());
}

function imageFrom(value: string) {
  const match = value.match(/<img[^>]+src=["'](https:\/\/[^"']+)["']/i);
  return match ? decodeXml(match[1]) : "";
}

function parseRss(xml: string): NewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).flatMap((match, index) => {
    const item = match[1];
    const title = textFrom("title", item).replace(/\s+-\s+[^-]+$/, "").trim();
    const url = textFrom("link", item);
    const source = textFrom("source", item) || "Notícias ambientais";
    const publishedDate = new Date(textFrom("pubDate", item));
    const publishedAt = Number.isNaN(publishedDate.valueOf()) ? new Date().toISOString() : publishedDate.toISOString();
    const rawDescription = textFrom("description", item);
    const imageUrl = imageFrom(rawDescription);
    const description = plainText(rawDescription);
    if (!title || !/^https?:\/\//i.test(url) || !imageUrl) return [];
    return [{
      id: `${publishedAt}-${index}`,
      title,
      url,
      source,
      publishedAt,
      summary: description && description !== title ? description.slice(0, 240) : "Notícia selecionada pelo radar ambiental e florestal da ExportaTrust.",
      imageUrl,
      imageAlt: `Imagem de capa da notícia: ${title}`,
      imageCredit: `Capa da notícia · ${source}`,
    }];
  });
}

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const query = encodeURIComponent("(pinus OR setor florestal OR florestas plantadas OR reflorestamento OR madeira legal OR EUDR) Brasil");
    const response = await fetch(`https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, {
      headers: { "user-agent": "ExportaTrust-EUDR-News-Radar/1.0" },
      signal: controller.signal,
      next: { revalidate: 1800 },
    });
    const items = response.ok ? parseRss(await response.text()) : [];
    const illustratedItems = [...fallbackItems, ...items.filter((item) => !fallbackItems.some((curated) => curated.url === item.url))].slice(0, 6);
    return Response.json({
      items: illustratedItems,
      sources: trackedSources,
      updatedAt: new Date().toISOString(),
      live: items.length > 0,
    }, { headers: { "cache-control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600" } });
  } catch {
    return Response.json({ items: fallbackItems, sources: trackedSources, updatedAt: new Date().toISOString(), live: false }, {
      headers: { "cache-control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600" },
    });
  } finally {
    clearTimeout(timeout);
  }
}
