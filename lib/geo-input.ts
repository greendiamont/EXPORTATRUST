export type ParsedGeoInput =
  | { kind: "coordinates"; latitude: number; longitude: number; format: "decimal" | "dms" | "utm"; label: string }
  | { kind: "unknown"; error: string };

function numberValue(value: string) {
  return Number(value.replace(",", "."));
}

function validPoint(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function dmsValue(degrees: string, minutes: string | undefined, seconds: string | undefined, hemisphere: string) {
  const value = numberValue(degrees) + numberValue(minutes || "0") / 60 + numberValue(seconds || "0") / 3600;
  return /[SW]/i.test(hemisphere) ? -value : value;
}

function parseDms(input: string) {
  const normalized = input.replaceAll("º", "°").replaceAll("’", "'").replaceAll("′", "'").replaceAll("”", '"').replaceAll("″", '"');
  const latitude = normalized.match(/(\d{1,2})(?:\s*°|\s+)(?:\s*(\d{1,2})(?:\s*'|\s+))?(?:\s*(\d{1,2}(?:[.,]\d+)?)(?:\s*"|\s+))?\s*([NS])\b/i);
  const longitude = normalized.match(/(\d{1,3})(?:\s*°|\s+)(?:\s*(\d{1,2})(?:\s*'|\s+))?(?:\s*(\d{1,2}(?:[.,]\d+)?)(?:\s*"|\s+))?\s*([EWOL])\b/i);
  if (!latitude || !longitude) return null;
  const lat = dmsValue(latitude[1], latitude[2], latitude[3], latitude[4]);
  const lonHemisphere = /[OL]/i.test(longitude[4]) ? (longitude[4].toUpperCase() === "L" ? "E" : "W") : longitude[4];
  const lon = dmsValue(longitude[1], longitude[2], longitude[3], lonHemisphere);
  return validPoint(lat, lon) ? { latitude: lat, longitude: lon } : null;
}

export function utmToLatLon(zone: number, easting: number, northing: number, northernHemisphere: boolean) {
  const a = 6378137;
  const eccSquared = 0.00669438;
  const k0 = 0.9996;
  const eccPrimeSquared = eccSquared / (1 - eccSquared);
  const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
  const x = easting - 500000;
  let y = northing;
  if (!northernHemisphere) y -= 10000000;
  const longOrigin = (zone - 1) * 6 - 180 + 3;
  const m = y / k0;
  const mu = m / (a * (1 - eccSquared / 4 - 3 * eccSquared ** 2 / 64 - 5 * eccSquared ** 3 / 256));
  const phi1Rad = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const n1 = a / Math.sqrt(1 - eccSquared * Math.sin(phi1Rad) ** 2);
  const t1 = Math.tan(phi1Rad) ** 2;
  const c1 = eccPrimeSquared * Math.cos(phi1Rad) ** 2;
  const r1 = a * (1 - eccSquared) / (1 - eccSquared * Math.sin(phi1Rad) ** 2) ** 1.5;
  const d = x / (n1 * k0);
  const latRad = phi1Rad - (n1 * Math.tan(phi1Rad) / r1) * (
    d ** 2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * eccPrimeSquared) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * eccPrimeSquared - 3 * c1 ** 2) * d ** 6 / 720
  );
  const longitude = longOrigin + (
    d
    - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * eccPrimeSquared + 24 * t1 ** 2) * d ** 5 / 120
  ) / Math.cos(phi1Rad) * 180 / Math.PI;
  const latitude = latRad * 180 / Math.PI;
  return { latitude, longitude };
}

function parseUtm(input: string) {
  const normalized = input.trim().toUpperCase().replace(/\b(LESTE|EASTING)\b/g, "E").replace(/\b(NORTE|NORTHING)\b/g, "N");
  const zoneMatch = normalized.match(/^(?:UTM\s*)?(?:Z(?:ONE|ONA)?\s*)?(\d{1,2})\s*([C-HJ-NP-X]|N|S)?(?:\s+|[,;/:-]+)/i);
  if (!zoneMatch) return null;
  const zone = Number(zoneMatch[1]);
  if (zone < 18 || zone > 25) return null;
  const band = (zoneMatch[2] || "").toUpperCase();
  const remainder = normalized.slice(zoneMatch[0].length).replace(/\b[EN]\s*[:=]?/g, " ");
  const numbers = remainder.match(/\d+(?:[.,]\d+)?/g)?.map(numberValue) ?? [];
  if (numbers.length < 2) return null;
  const [easting, northing] = numbers;
  if (easting < 100000 || easting > 900000 || northing < 0 || northing > 10000000) return null;
  // In Brazilian cadastral practice "22S" commonly means UTM zone 22, southern hemisphere.
  // A latitude band C-M is also southern; N-X is northern. Without a band, Brazil defaults south.
  const northern = band ? (band === "S" ? false : band === "N" ? true : band >= "N") : false;
  const point = utmToLatLon(zone, easting, northing, northern);
  return validPoint(point.latitude, point.longitude) ? { ...point, zone, band: band || "S" } : null;
}

function parseDecimal(input: string) {
  const tokens = input.match(/[-+]?\d{1,3}(?:[.,]\d+)?/g) ?? [];
  if (tokens.length !== 2) return null;
  const latitude = numberValue(tokens[0]);
  const longitude = numberValue(tokens[1]);
  return validPoint(latitude, longitude) ? { latitude, longitude } : null;
}

export function parseGeographicInput(input: string): ParsedGeoInput {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "unknown", error: "Informe CAR, coordenadas ou UTM." };

  const dms = parseDms(trimmed);
  if (dms) return { kind: "coordinates", ...dms, format: "dms", label: "Graus, minutos e segundos" };

  const utm = parseUtm(trimmed);
  if (utm) return { kind: "coordinates", latitude: utm.latitude, longitude: utm.longitude, format: "utm", label: `UTM zona ${utm.zone}${utm.band}` };

  const decimal = parseDecimal(trimmed);
  if (decimal) return { kind: "coordinates", ...decimal, format: "decimal", label: "Graus decimais" };

  return { kind: "unknown", error: "Formato não reconhecido. Use CAR, latitude/longitude ou UTM com zona, leste e norte." };
}
