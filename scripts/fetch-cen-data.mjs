import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "data");
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = (process.env.CEN_API_BASE_URL || "https://sipub.api.coordinador.cl:443").replace(/\/$/, "");
const apiKey = process.env.CEN_API_KEY || "";
const today = formatDate(new Date());
const startDate = process.env.CEN_START_DATE || today;
const endDate = process.env.CEN_END_DATE || today;

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
    path: "/demanda-real-estimada/v4/findByDate",
    mode: "raw",
  },
  {
    id: "hidrologia",
    file: "embalse-real-last.json",
    path: "/embalse-real/v3/findLast",
    mode: "raw",
    noDateParams: true,
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
  const url = new URL(baseUrl + dataset.path);
  if (!dataset.noDateParams) {
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
  }
  const headers = { accept: "application/json" };
  if (apiKey) {
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("subscription-key", apiKey);
    url.searchParams.set("subscription_key", apiKey);
    url.searchParams.set("api-key", apiKey);
    headers.apiKey = apiKey;
    headers.ApiKey = apiKey;
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
  return response.json();
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
  const rows = unwrapRows(payload);
  if (dataset.mode === "latestByBar") {
    return {
      id: dataset.id,
      ok: true,
      updatedAt: new Date().toISOString(),
      source: dataset.path,
      range: { startDate, endDate },
      records: latestByName(rows).map((row) => ({
        name: readText(row, ["barra", "nombre_barra", "nombreBarra", "bar", "node", "nodo", "nombre"]),
        key: normalizeKey(readText(row, ["barra", "nombre_barra", "nombreBarra", "bar", "node", "nodo", "nombre"])),
        value: readNumber(row, ["cmg", "costo_marginal", "costoMarginal", "valor", "value", "usdMWh"]),
        timestamp: readText(row, ["fecha", "fecha_hora", "fechaHora", "date", "datetime", "hora"]),
        raw: row,
      })).filter((row) => row.key && Number.isFinite(row.value)),
    };
  }
  return {
    id: dataset.id,
    ok: true,
    updatedAt: new Date().toISOString(),
    source: dataset.path,
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
    const name = readText(row, ["barra", "nombre_barra", "nombreBarra", "bar", "node", "nodo", "nombre"]);
    const key = normalizeKey(name);
    if (!key) continue;
    const timestamp = readText(row, ["fecha", "fecha_hora", "fechaHora", "date", "datetime", "hora"]);
    const current = picked.get(key);
    if (!current || String(timestamp) > String(current.timestamp || "")) {
      picked.set(key, { ...row, timestamp });
    }
  }
  return [...picked.values()];
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

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
