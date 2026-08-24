export type CatalogEntryType = "raw_material" | "species";

export type ProductCatalogSeed = {
  product: string;
  entryType: CatalogEntryType;
  value: string;
  scientificName?: string;
  sortOrder: number;
};

export const PRODUCT_CATALOG_SEEDS: ProductCatalogSeed[] = [
  { product: "Madeira serrada", entryType: "raw_material", value: "Toras de Pinus", sortOrder: 10 },
  { product: "Madeira serrada", entryType: "raw_material", value: "Madeira bruta de Pinus", sortOrder: 20 },
  { product: "Madeira serrada", entryType: "raw_material", value: "Toras de Eucalipto", sortOrder: 30 },
  { product: "Madeira serrada", entryType: "raw_material", value: "Madeira bruta de Eucalipto", sortOrder: 40 },
  { product: "Madeira serrada", entryType: "species", value: "Pinus", scientificName: "Pinus taeda", sortOrder: 10 },
  { product: "Madeira serrada", entryType: "species", value: "Pinus", scientificName: "Pinus elliottii", sortOrder: 20 },
  { product: "Madeira serrada", entryType: "species", value: "Eucalipto", scientificName: "Eucalyptus grandis", sortOrder: 30 },
  { product: "Madeira serrada", entryType: "species", value: "Eucalipto", scientificName: "Eucalyptus dunnii", sortOrder: 40 },

  { product: "Pellets de madeira", entryType: "raw_material", value: "Resíduos de Pinus", sortOrder: 10 },
  { product: "Pellets de madeira", entryType: "raw_material", value: "Serragem de Pinus", sortOrder: 20 },
  { product: "Pellets de madeira", entryType: "raw_material", value: "Cavacos de Pinus", sortOrder: 30 },
  { product: "Pellets de madeira", entryType: "raw_material", value: "Resíduos de Eucalipto", sortOrder: 40 },
  { product: "Pellets de madeira", entryType: "species", value: "Pinus", scientificName: "Pinus taeda", sortOrder: 10 },
  { product: "Pellets de madeira", entryType: "species", value: "Pinus", scientificName: "Pinus elliottii", sortOrder: 20 },
  { product: "Pellets de madeira", entryType: "species", value: "Eucalipto", scientificName: "Eucalyptus grandis", sortOrder: 30 },

  { product: "Móveis de madeira", entryType: "raw_material", value: "Madeira maciça de Pinus", sortOrder: 10 },
  { product: "Móveis de madeira", entryType: "raw_material", value: "Madeira maciça de Eucalipto", sortOrder: 20 },
  { product: "Móveis de madeira", entryType: "raw_material", value: "Painel de madeira MDF", sortOrder: 30 },
  { product: "Móveis de madeira", entryType: "raw_material", value: "Painel de madeira MDP", sortOrder: 40 },
  { product: "Móveis de madeira", entryType: "species", value: "Pinus", scientificName: "Pinus taeda", sortOrder: 10 },
  { product: "Móveis de madeira", entryType: "species", value: "Eucalipto", scientificName: "Eucalyptus grandis", sortOrder: 20 },

  { product: "Café verde", entryType: "raw_material", value: "Café arábica em grão verde", sortOrder: 10 },
  { product: "Café verde", entryType: "raw_material", value: "Café robusta/conilon em grão verde", sortOrder: 20 },
  { product: "Café verde", entryType: "species", value: "Café arábica", scientificName: "Coffea arabica", sortOrder: 10 },
  { product: "Café verde", entryType: "species", value: "Café robusta/conilon", scientificName: "Coffea canephora", sortOrder: 20 },

  { product: "Cacau e derivados", entryType: "raw_material", value: "Amêndoas de cacau", sortOrder: 10 },
  { product: "Cacau e derivados", entryType: "raw_material", value: "Massa de cacau", sortOrder: 20 },
  { product: "Cacau e derivados", entryType: "species", value: "Cacau", scientificName: "Theobroma cacao", sortOrder: 10 },

  { product: "Soja", entryType: "raw_material", value: "Soja em grão", sortOrder: 10 },
  { product: "Soja", entryType: "raw_material", value: "Farelo de soja", sortOrder: 20 },
  { product: "Soja", entryType: "species", value: "Soja", scientificName: "Glycine max", sortOrder: 10 },

  { product: "Borracha natural", entryType: "raw_material", value: "Látex natural", sortOrder: 10 },
  { product: "Borracha natural", entryType: "raw_material", value: "Borracha natural tecnicamente especificada", sortOrder: 20 },
  { product: "Borracha natural", entryType: "species", value: "Seringueira", scientificName: "Hevea brasiliensis", sortOrder: 10 },

  { product: "Óleo de palma", entryType: "raw_material", value: "Fruto de palma", sortOrder: 10 },
  { product: "Óleo de palma", entryType: "raw_material", value: "Óleo de palma bruto", sortOrder: 20 },
  { product: "Óleo de palma", entryType: "species", value: "Palma de óleo", scientificName: "Elaeis guineensis", sortOrder: 10 },

  { product: "Gado bovino / couro", entryType: "raw_material", value: "Bovino vivo", sortOrder: 10 },
  { product: "Gado bovino / couro", entryType: "raw_material", value: "Couro bovino", sortOrder: 20 },
  { product: "Gado bovino / couro", entryType: "species", value: "Bovino doméstico", scientificName: "Bos taurus", sortOrder: 10 },
];

export async function ensureProductCatalog(organizationId: number) {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS product_traceability_catalog (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    organization_id integer DEFAULT 1 NOT NULL,
    product text NOT NULL,
    entry_type text NOT NULL,
    value text NOT NULL,
    scientific_name text DEFAULT '' NOT NULL,
    active integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(organization_id, product, entry_type, value)
  )`).run();
  const existing = await env.DB.prepare("SELECT id FROM product_traceability_catalog WHERE organization_id = ? LIMIT 1").bind(organizationId).first();
  if (existing) return;
  await env.DB.batch(PRODUCT_CATALOG_SEEDS.map((entry) => env.DB.prepare(
    "INSERT OR IGNORE INTO product_traceability_catalog (organization_id,product,entry_type,value,scientific_name,active,sort_order) VALUES (?,?,?,?,?,1,?)"
  ).bind(organizationId, entry.product, entry.entryType, entry.value, entry.scientificName ?? "", entry.sortOrder)));
}
