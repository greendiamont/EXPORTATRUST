import type { ForestDossierSatelliteMap } from "./forest-dossier-pdf";

type Point = [number, number];

function asText(value: unknown) { return value === null || value === undefined ? "" : String(value).trim(); }

function validRing(value: unknown): Point[] {
  return Array.isArray(value)
    ? value.filter((point): point is Point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))).map((point) => [Number(point[0]), Number(point[1])])
    : [];
}

function geometryRings(value: string): Point[][] {
  try {
    const input = JSON.parse(value) as { type?: string; coordinates?: unknown; geometry?: { type?: string; coordinates?: unknown }; features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }> };
    const geometries = input.type === "FeatureCollection"
      ? (input.features ?? []).map((feature) => feature.geometry).filter(Boolean)
      : [input.type === "Feature" ? input.geometry : input].filter(Boolean);
    return geometries.flatMap((geometry) => {
      if (geometry?.type === "Polygon") return [validRing((geometry.coordinates as number[][][])?.[0])];
      if (geometry?.type === "MultiPolygon") return ((geometry.coordinates as number[][][][]) ?? []).map((polygon) => validRing(polygon?.[0]));
      return [];
    }).filter((ring) => ring.length >= 3);
  } catch { /* geometry is optional */ }
  return [];
}

function webMercator([longitude, latitude]: Point): Point {
  const limitedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = longitude * 20037508.342789244 / 180;
  const y = Math.log(Math.tan((90 + limitedLatitude) * Math.PI / 360)) / (Math.PI / 180) * 20037508.342789244 / 180;
  return [x, y];
}

function fittedBbox(points: Point[], targetAspect: number): [number, number, number, number] {
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const rawWidth = Math.max(maxX - minX, 1);
  const rawHeight = Math.max(maxY - minY, 1);
  const paddedWidth = rawWidth * 1.22;
  const paddedHeight = rawHeight * 1.22;
  const width = Math.max(paddedWidth, paddedHeight * targetAspect);
  const height = Math.max(paddedHeight, paddedWidth / targetAspect);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  minX = centreX - width / 2;
  maxX = centreX + width / 2;
  minY = centreY - height / 2;
  maxY = centreY + height / 2;
  return [minX, minY, maxX, maxY];
}

export async function satelliteMap(geometryJson: string): Promise<ForestDossierSatelliteMap | undefined> {
  const rings = geometryRings(geometryJson);
  const points = rings.flat();
  if (points.length < 3) return undefined;

  try {
    const { env } = await import("cloudflare:workers");
    const googleKey = asText((env as unknown as Record<string, unknown>).GOOGLE_MAPS_API_KEY);
    if (googleKey) {
      const query = new URLSearchParams({ size: "640x400", scale: "2", maptype: "satellite", format: "jpg", key: googleKey });
      for (const ring of rings) {
        const step = Math.max(1, Math.ceil(ring.length / 55));
        const sampled = ring.filter((_, index) => index % step === 0);
        if (sampled[0] && sampled[sampled.length - 1] !== sampled[0]) sampled.push(sampled[0]);
        const path = sampled.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join("|");
        query.append("path", `color:0xffd500ff|weight:5|fillcolor:0x00000000|${path}`);
      }
      const response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${query}`, { signal: AbortSignal.timeout(12000) });
      if (response.ok && response.headers.get("content-type")?.includes("image")) return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "image/jpeg", provider: "Google Maps", boundaryIncluded: true };
    }
  } catch { /* licensed fallback below */ }

  try {
    const bbox = fittedBbox(points.map(webMercator), 1200 / 760);
    const query = new URLSearchParams({ bbox: bbox.join(","), bboxSR: "3857", imageSR: "3857", size: "1200,760", format: "jpg", f: "image" });
    const response = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${query}`, { signal: AbortSignal.timeout(12000) });
    if (response.ok && response.headers.get("content-type")?.includes("image")) return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "image/jpeg", provider: "Esri World Imagery", bbox, bboxCrs: "EPSG:3857" };
  } catch { /* vector map remains available */ }
  return undefined;
}
