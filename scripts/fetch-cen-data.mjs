import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "data");
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = (process.env.CEN_API_BASE_URL || "https://sipub.api.coordinador.cl:443").replace(/\/$/, "");
const apiKey = process.env.CEN_API_KEY || "";
const defaultDate = formatDate(addDays(new Date(), -1));
const startDate = process.env.CEN_START_DATE || defaultDate;
const endDate = process.env.CEN_END_DATE || defaultDate;

const datasets = [
  {
    id: "cmg-online",
    file: "cmg-online-latest.json",
    path: "/costo-marginal-online/v4/findByDate",
    mode: "latestByBar",
  },
  {
    id: "cmg-real",
    file: "cmg-real-latest.json",
    path: "/costo-marginal-real/v4/findByDate",
    mode: "latestByBar",
  },
  {
    id: "demanda",
    file: "demanda-real-estimada.json",
    path: "/demanda/v4/findByDate",
    fallbackPaths: ["/demanda-real/v4/findByDate", "/demanda-real-estimada/v4/findByDate"],
    mode: "raw",
  },
  {
    id: "hidrologia",
    file: "embalse-real-last.json",
    path: "/cotas-embalses-reales/v3/findAll",
    mode: "raw",
  },
];

const status = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  startDate,
  endDate,
  hasApiKey: Boolean(apiKey),
  ok: false,
  datasets: [],
};

for (const dataset of datasets) {
  const target = path.join(outDir, dataset.file);
  try {
    const payload = await requestDataset(dataset);
    const normalized = normalizeDataset(dataset, payload);
    writeJson(target, normalized);
    status.datasets.push({
      id: dataset.id,
      file: `data/${dataset.file}`,
      ok: true,
      records: normalized.records?.length ?? normalized.rawCount ?? 0,
      updatedAt: normalized.updatedAt,
    });
  } catch (error) {
    const fallback = {
      id: dataset.id,
      ok: false,
      updatedAt: new Date().toISOString(),
      error: describeError(error),
      records: [],
    };
    writeJson(target, fallback);
    status.datasets.push({
      id: dataset.id,
      file: `data/${dataset.file}`,
      ok: false,
      error: fallback.error,
      records: 0,
    });
  }
}

status.ok = status.datasets.some((dataset) => dataset.ok);
writeJson(path.join(outDir, "status.json"), status);
console.log(JSON.stringify(status, null, 2));

async function requestDataset(dataset) {
  const paths = [dataset.path, ...(dataset.fallbackPaths || [])];
  let lastError;
  for (const candidatePath of paths) {
    try {
      return await requestPath(dataset, candidatePath);
    } catch (error) {
      lastError = error;
      if (!String(error?.message || "").startsWith("404 ")) throw error;
    }
  }
  throw lastError;
}

async function requestPath(dataset, candidatePath) {
  const url = new URL(baseUrl + candidatePath);
  if (!dataset.noDateParams) {
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
    url.searchParams.set("page", "0");
  }
  const headers = { accept: "application/json" };
  if (apiKey) {
    url.searchParams.set("user_key", apiKey);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("subscription-key", apiKey);
    url.searchParams.set("subscription_key", apiKey);
    url.searchParams.set("api-key", apiKey);
    headers.apiKey = apiKey;
    headers.ApiKey = apiKey;
    headers.apikey = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
    headers["Ocp-Apim-Subscription-Key"] = apiKey;
    headers["subscription-key"] = apiKey;
    headers["Subscription-Key"] = apiKey;
    headers["x-api-key"] = apiKey;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${body.slice(0, 280)}`.trim());
  }
  const json = await response.json();
  if (candidatePath !== dataset.path) {
    return { __sourcePath: candidatePath, __payload: json };
  }
  return json;
}

function describeError(error) {
  const parts = [String(error?.message || error)];
  if (error?.cause?.code) parts.push(`code=${error.cause.code}`);
  if (error?.cause?.hostname) parts.push(`host=${error.cause.hostname}`);
  if (error?.cause?.address) parts.push(`address=${error.cause.address}`);
  if (error?.cause?.port) parts.push(`port=${error.cause.port}`);
  return parts.join(" | ");
}

function normalizeDataset(dataset, payload) {
  const sourcePath = payload?.__sourcePath || dataset.path;
  const actualPayload = payload?.__payload || payload;
  const rows = unwrapRows(actualPayload);
  if (dataset.mode === "latestByBar") {
    const records = latestByName(rows).map((row) => ({
      name: readText(row, barNameFields()),
      key: normalizeKey(readText(row, barNameFields())),
      value: readNumber(row, cmgValueFields()),
      timestamp: readText(row, timestampFields()),
      raw: row,
    })).filter((row) => row.key && Number.isFinite(row.value));
    return {
      id: dataset.id,
      ok: true,
      updatedAt: new Date().toISOString(),
      source: sourcePath,
      range: { startDate, endDate },
      rawCount: rows.length,
      sampleKeys: sampleKeys(rows),
      sampleRows: records.length ? [] : rows.slice(0, 3),
      records,
    };
  }
  return {
    id: dataset.id,
    ok: true,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range: dataset.noDateParams ? null : { startDate, endDate },
    rawCount: rows.length,
    records: rows.slice(0, 5000),
  };
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "items", "content", "results", "records"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  for (const value of Object.values(payload || {})) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = unwrapRows(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function latestByName(rows) {
  const picked = new Map();
  for (const row of rows) {
    const name = readText(row, barNameFields());
    const key = normalizeKey(name);
    if (!key) continue;
    const timestamp = readText(row, timestampFields());
    const current = picked.get(key);
    if (!current || String(timestamp) > String(current.timestamp || "")) {
      picked.set(key, { ...row, timestamp });
    }
  }
  return [...picked.values()];
}

function barNameFields() {
  return [
    "barra",
    "nombre_barra",
    "nombreBarra",
    "nombre_barra_transmision",
    "nombreBarraTransmision",
    "barra_transmision",
    "barraTransmision",
    "bar",
    "node",
    "nodo",
    "nombre",
    "name",
  ];
}

function cmgValueFields() {
  return [
    "cmg",
    "costo_marginal",
    "costoMarginal",
    "costo_marginal_usd",
    "costoMarginalUsd",
    "valor",
    "value",
    "usdMWh",
    "usd_mwh",
  ];
}

function timestampFields() {
  return ["fecha", "fecha_hora", "fechaHora", "date", "datetime", "hora", "timestamp"];
}

function readText(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row[name] !== null && row[name] !== "") return String(row[name]);
  }
  return "";
}

function readNumber(row, names) {
  for (const name of names) {
    const value = Number(String(row?.[name] ?? "").replace(",", "."));
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(kv|barra|se|subestacion|subest)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function sampleKeys(rows) {
  return [...new Set(rows.slice(0, 5).flatMap((row) => Object.keys(row || {})))].slice(0, 80);
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
