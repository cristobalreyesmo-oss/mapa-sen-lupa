import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "data", "history");
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = (process.env.CEN_API_BASE_URL || "https://sipub.api.coordinador.cl:443").replace(/\/$/, "");
const apiKey = process.env.CEN_API_KEY || "";
const startDate = mustDate(process.env.CEN_BACKFILL_START_DATE, "CEN_BACKFILL_START_DATE");
const endDate = mustDate(process.env.CEN_BACKFILL_END_DATE, "CEN_BACKFILL_END_DATE");
const datasets = (process.env.CEN_BACKFILL_DATASETS || "cmg-real")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const limit = Math.max(100, Math.min(2000, Number(process.env.CEN_BACKFILL_LIMIT || 1000)));
const maxPages = Math.max(1, Math.min(50, Number(process.env.CEN_BACKFILL_MAX_PAGES || 20)));

const configs = {
  "cmg-real": { path: "/costo-marginal-real/v4/findByDate", query: { type: "DEFINITIVO", limit }, normalize: normalizeCmg, historyId: "cmg" },
  "cmg-online": { path: "/costo-marginal-online/v4/findByDate", query: { limit }, normalize: normalizeCmg, historyId: "cmg" },
  "generacion-real": { path: "/generacion-real/v3/findByDate", query: { pageSize: limit }, normalize: normalizeGeneracion, historyId: "generacion" },
  "potencia-transitada": { path: "/potencia-transitada/v4/findByDate", query: { limit }, normalize: normalizeFlujos, historyId: "flujos" },
};

const progress = readJson(path.join(outDir, "progress.json")) || { schema: "sen-history-progress-v1", runs: [] };
const manifest = readJson(path.join(outDir, "manifest.json")) || { schema: "sen-etl-manifest-v1", generatedAt: "", window: {}, datasets: {} };
const run = { generatedAt: new Date().toISOString(), startDate, endDate, datasets: [], ok: false };

for (const id of datasets) {
  const config = configs[id];
  if (!config) {
    run.datasets.push({ id, ok: false, error: "dataset no soportado" });
    continue;
  }
  const rows = [];
  const attempts = [];
  for (const date of dateList(startDate, endDate)) {
    try {
      const dayRows = await requestDay(config, date);
      attempts.push({ date, rows: dayRows.length });
      rows.push(...dayRows);
      await delay(900);
    } catch (error) {
      attempts.push({ date, error: describeError(error) });
    }
  }
  const normalized = config.normalize(rows);
  const months = writeDatasetHistory(config.historyId, normalized);
  for (const month of months) {
    manifest.datasets[config.historyId] = addMonth(manifest.datasets[config.historyId], month, `history/${config.historyId}/${month}.json`);
  }
  run.datasets.push({ id, ok: months.length > 0, rawRows: rows.length, months, attempts: attempts.slice(0, 40) });
}

run.ok = run.datasets.some((dataset) => dataset.ok);
manifest.generatedAt = new Date().toISOString();
progress.runs = [run, ...(progress.runs || [])].slice(0, 30);
writeJson(path.join(outDir, "manifest.json"), manifest);
writeJson(path.join(outDir, "progress.json"), progress);
console.log(JSON.stringify(run, null, 2));

async function requestDay(config, date) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(baseUrl + config.path);
    url.searchParams.set("startDate", date);
    url.searchParams.set("endDate", date);
    url.searchParams.set("page", String(page));
    for (const [key, value] of Object.entries(config.query || {})) url.searchParams.set(key, String(value));
    if (apiKey) {
      url.searchParams.set("user_key", apiKey);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("apikey", apiKey);
    }
    const response = await fetch(url, { headers: apiHeaders() });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} ${(await response.text().catch(() => "")).slice(0, 180)}`.trim());
    const json = await response.json();
    const pageRows = unwrapRows(json);
    if (!pageRows.length) break;
    rows.push(...pageRows);
    const totalPages = Number(json?.totalPages ?? json?.page?.totalPages);
    if (Number.isFinite(totalPages) && page >= totalPages - 1) break;
    if (!Number.isFinite(totalPages) && pageRows.length < limit) break;
    await delay(500);
  }
  return rows;
}

function normalizeCmg(rows) {
  const byBar = new Map();
  const hours = new Set();
  for (const row of rows) {
    const name = readText(row, ["barra_transf", "barra_info", "barra", "nombre_barra"]);
    const key = normalizeKey(name);
    const timestamp = parseHourKey(readText(row, ["fecha_hora", "fecha_minuto", "fecha"]));
    const value = readNumber(row, ["cmg_mills_kwh_", "cmg_usd_mwh_", "cmg", "costo_marginal"]);
    if (!key || !timestamp || !Number.isFinite(value)) continue;
    hours.add(timestamp);
    if (!byBar.has(key)) byBar.set(key, { name, key, aliases: aliasKeys(name), values: new Map() });
    byBar.get(key).values.set(timestamp, value);
  }
  const sortedHours = [...hours].sort();
  return {
    schema: "sen-history-cmg-v1",
    hours: sortedHours,
    nodes: [...byBar.values()].map((row) => ({ name: row.name, key: row.key, aliases: row.aliases })),
    values: [...byBar.values()].map((row) => sortedHours.map((timestamp) => row.values.has(timestamp) ? row.values.get(timestamp) : null)),
  };
}

function normalizeGeneracion(rows) {
  const byPlant = new Map();
  const hours = new Set();
  for (const row of rows) {
    const timestamp = generationTimestamp(row);
    const name = readText(row, ["nombreCentralUnidad", "nombre_central_unidad", "central", "nombre"]);
    const key = normalizeKey(name);
    const value = readNumber(row, ["valor", "value"]);
    if (!timestamp || !key || !Number.isFinite(value)) continue;
    hours.add(timestamp);
    if (!byPlant.has(key)) byPlant.set(key, { name, key, idCentral: readText(row, ["idCentral", "id_central"]), technology: readText(row, ["tipoTecnologia", "tipo_tecnologia"]), aliases: aliasKeys(name), values: new Map() });
    byPlant.get(key).values.set(timestamp, (byPlant.get(key).values.get(timestamp) || 0) + value);
  }
  const sortedHours = [...hours].sort();
  return {
    schema: "sen-history-generacion-v1",
    hours: sortedHours,
    plants: [...byPlant.values()].map((row) => ({ name: row.name, key: row.key, aliases: row.aliases, idCentral: row.idCentral, technology: row.technology })),
    values: [...byPlant.values()].map((row) => sortedHours.map((timestamp) => row.values.has(timestamp) ? row.values.get(timestamp) : null)),
  };
}

function normalizeFlujos(rows) {
  const byLine = new Map();
  const hours = new Set();
  for (const row of rows) {
    const name = readText(row, ["nombre_linea", "nombreLinea", "linea"]);
    const key = normalizeKey(name);
    const timestamp = transitTimestamp(row);
    const value = readNumber(row, ["potencia_mwh", "potenciaMwh", "potencia_mw", "potenciaMw", "potencia_kwh"]);
    if (!key || !timestamp || !Number.isFinite(value)) continue;
    hours.add(timestamp);
    if (!byLine.has(key)) byLine.set(key, { name, key, aliases: aliasKeys(name), values: new Map() });
    byLine.get(key).values.set(timestamp, value);
  }
  const sortedHours = [...hours].sort();
  return {
    schema: "sen-history-flujos-v1",
    hours: sortedHours,
    lines: [...byLine.values()].map((row) => ({ name: row.name, key: row.key, aliases: row.aliases })),
    values: [...byLine.values()].map((row) => sortedHours.map((timestamp) => row.values.has(timestamp) ? row.values.get(timestamp) : null)),
  };
}

function writeDatasetHistory(dataset, normalized) {
  if (!normalized.hours.length) return [];
  const months = [...new Set(normalized.hours.map(monthKey).filter(Boolean))].sort();
  for (const month of months) {
    const existing = readJson(path.join(outDir, dataset, `${month}.json`));
    const merged = mergeHistory(existing, normalized, month, dataset);
    const dir = path.join(outDir, dataset);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, `${month}.json`), merged);
  }
  return months;
}

function mergeHistory(existing, incoming, month, dataset) {
  if (!existing || existing.schema !== incoming.schema) return sliceMonth(incoming, month);
  const entityKey = dataset === "generacion" ? "plants" : dataset === "flujos" ? "lines" : "nodes";
  const hours = [...new Set([...(existing.hours || []), ...incoming.hours.filter((hour) => monthKey(hour) === month)])].sort();
  const entities = mergeEntities(existing[entityKey] || [], incoming[entityKey] || []);
  const values = entities.map((entity) => {
    const row = new Map();
    fillValues(row, existing, entityKey, entity.key);
    fillValues(row, incoming, entityKey, entity.key);
    return hours.map((hour) => row.has(hour) ? row.get(hour) : null);
  });
  return { schema: incoming.schema, hours, [entityKey]: entities, values };
}

function sliceMonth(data, month) {
  const keep = data.hours.map((hour, index) => monthKey(hour) === month ? index : -1).filter((index) => index >= 0);
  const entityKey = data.plants ? "plants" : data.lines ? "lines" : "nodes";
  return { schema: data.schema, hours: keep.map((index) => data.hours[index]), [entityKey]: data[entityKey], values: data.values.map((row) => keep.map((index) => row[index] ?? null)) };
}

function mergeEntities(a, b) {
  const map = new Map();
  for (const row of [...a, ...b]) if (row?.key && !map.has(row.key)) map.set(row.key, row);
  return [...map.values()];
}

function fillValues(target, source, entityKey, key) {
  const index = (source[entityKey] || []).findIndex((row) => row.key === key);
  if (index < 0) return;
  (source.hours || []).forEach((hour, hourIndex) => {
    const value = source.values?.[index]?.[hourIndex];
    if (value !== null && value !== undefined) target.set(hour, value);
  });
}

function apiHeaders() {
  const headers = { accept: "application/json" };
  if (apiKey) {
    headers.apiKey = apiKey;
    headers.ApiKey = apiKey;
    headers.apikey = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
    headers["Ocp-Apim-Subscription-Key"] = apiKey;
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "items", "content", "results", "records"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function dateList(start, end) {
  const dates = [];
  for (let current = parseDate(start); current <= parseDate(end); current = addDays(current, 1)) dates.push(formatDate(current));
  return dates;
}

function generationTimestamp(row) {
  const fecha = readText(row, ["fecha", "date"]);
  const rawHour = Number(String(readText(row, ["hora", "hour"]) || "0").match(/\d+/)?.[0] || 0);
  if (!fecha) return "";
  return `${fecha} ${String(rawHour === 24 ? 23 : Math.max(0, Math.min(23, rawHour))).padStart(2, "0")}`;
}

function transitTimestamp(row) {
  const direct = parseHourKey(readText(row, ["fecha_hora", "fechaHora", "utc", "timestamp"]));
  if (direct) return direct;
  const fecha = readText(row, ["fecha", "date"]);
  const rawHour = Number(String(readText(row, ["hora", "hour"]) || "0").match(/\d+/)?.[0] || 0);
  if (!fecha) return "";
  return `${fecha} ${String(Math.max(0, Math.min(23, rawHour))).padStart(2, "0")}`;
}

function parseHourKey(value) {
  const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}` : "";
}

function readText(row, names) {
  for (const name of names) if (row?.[name] !== undefined && row[name] !== null && row[name] !== "") return String(row[name]);
  return "";
}

function readNumber(row, names) {
  for (const name of names) {
    if (row?.[name] === undefined || row[name] === null || row[name] === "") continue;
    const value = Number(String(row[name]).replace(",", "."));
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function aliasKeys(value) {
  const key = normalizeKey(value);
  const noVoltage = key.replace(/\b\d{2,3}\b/g, " ").replace(/\s+/g, " ").trim();
  return [...new Set([key, noVoltage].filter(Boolean))];
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(kv|barra|se|subestacion|subest|ba|bp|bp1|bp2|bp3|bp4)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addMonth(entry, month, file) {
  const current = entry || { months: [] };
  if (!current.months.some((row) => row.month === month)) current.months.push({ month, file });
  current.months.sort((a, b) => a.month.localeCompare(b.month));
  return current;
}

function monthKey(timestamp) {
  const match = String(timestamp || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function mustDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error(`${name} debe venir en formato YYYY-MM-DD`);
  return value;
}

function parseDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error) {
  return String(error?.message || error);
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}
