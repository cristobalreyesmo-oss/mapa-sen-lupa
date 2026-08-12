import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "data");
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = (process.env.CEN_API_BASE_URL || "https://sipub.api.coordinador.cl:443").replace(/\/$/, "");
const apiKey = process.env.CEN_API_KEY || "";
const operacionBaseUrl = (process.env.CEN_OPERACION_API_BASE_URL || "https://operacion.api.coordinador.cl:443").replace(/\/$/, "");
const operacionUserKey = process.env.CEN_OPERACION_USER_KEY || "";
const defaultEndDate = formatDate(new Date());
const defaultStartDate = formatDate(addDays(new Date(), -1));
const startDate = process.env.CEN_START_DATE || defaultStartDate;
const endDate = process.env.CEN_END_DATE || defaultEndDate;
const lookbackDays = Number(process.env.CEN_LOOKBACK_DAYS || 2);
const cmgDays = Math.max(1, Math.min(7, Number(process.env.CEN_CMG_DAYS || 7)));
const generationDays = Math.max(1, Math.min(7, Number(process.env.CEN_GENERACION_DAYS || 7)));
const enabledDatasetIds = new Set(
  (process.env.CEN_DATASETS || "cmg-online,cmg-real,demanda,hidrologia,generacion-real")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const TECH_CANON = {
  "hidraulica": "Hidráulica",
  "hidro": "Hidráulica",
  "hidroelectrico": "Hidráulica",
  "carbon": "Carbón",
  "carbon pulverizado": "Carbón",
  "gas natural": "Gas Natural",
  "termica": "Térmica",
  "gnl": "Gas Natural",
  "gn": "Gas Natural",
  "eolica": "Eólica",
  "solar": "Solar",
  "solar fv": "Solar",
  "fotovoltaica": "Solar",
  "solar fotovoltaica": "Solar",
  "biomasa": "Biomasa",
  "biogas": "Biogás",
  "geotermia": "Geotermia",
  "petroleo diesel": "Petróleo Diésel",
  "diesel": "Petróleo Diésel",
  "cogeneracion": "Cogeneración",
  "fuel oil": "Fuel Oil",
  "otros": "Otros",
};

const datasets = [
  {
    id: "cmg-online",
    file: "cmg-online-latest.json",
    path: "/costo-marginal-online/v4/findByDate",
    fallbackPaths: ["/cmg-online/v4/findByDate", "/costos-marginales-online/v4/findByDate"],
    mode: "latestByBar",
    paginate: true,
    multiDateDays: cmgDays,
    tryLookback: true,
  },
  {
    id: "cmg-real",
    file: "cmg-real-latest.json",
    path: "/costo-marginal-real/v4/findByDate",
    fallbackPaths: ["/cmg-real/v4/findByDate", "/costos-marginales-reales/v4/findByDate"],
    mode: "latestByBar",
    paginate: true,
    multiDateDays: cmgDays,
    tryLookback: true,
  },
  {
    id: "demanda",
    file: "demanda-real-estimada.json",
    path: "/demanda/v4/findByDate",
    fallbackPaths: ["/demanda-real/v4/findByDate", "/demanda-real-estimada/v4/findByDate"],
    mode: "raw",
    tryLookback: true,
  },
  {
    id: "hidrologia",
    file: "embalse-real-last.json",
    path: "/cotas-embalses-reales/v3/findAll",
    mode: "raw",
    tryLookback: true,
  },
  {
    id: "generacion-real",
    file: "generacion-real-last-24h.json",
    baseUrl: operacionBaseUrl,
    apiKey: operacionUserKey,
    path: "/reportes/v3/generation",
    fallbackPaths: [],
    mode: "operacionGenerationDaily",
    rangeSpanDays: 1,
    tryLookback: true,
    dateParam: "date",
    dateValue: "endDate",
    noRangeParams: true,
    multiDateDays: generationDays,
  },
];

const status = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  startDate,
  endDate,
  lookbackDays,
  cmgDays,
  generationDays,
  enabledDatasets: [...enabledDatasetIds],
  hasApiKey: Boolean(apiKey),
  hasOperacionUserKey: Boolean(operacionUserKey),
  ok: false,
  datasets: [],
};

for (const dataset of datasets.filter((item) => enabledDatasetIds.has(item.id))) {
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
      rawCount: normalized.rawCount ?? null,
      sampleKeys: normalized.sampleKeys || [],
      updatedAt: normalized.updatedAt,
      source: normalized.source,
      range: normalized.range,
      attempts: summarizeAttempts(normalized.attempts || []),
    });
  } catch (error) {
    const preserved = preserveExistingDataset(target, dataset, error);
    if (preserved) {
      status.datasets.push({
        id: dataset.id,
        file: `data/${dataset.file}`,
        ok: true,
        stale: true,
        error: describeError(error),
        records: preserved.records?.length ?? preserved.rawCount ?? 0,
        rawCount: preserved.rawCount ?? null,
        sampleKeys: preserved.sampleKeys || [],
        updatedAt: preserved.updatedAt,
        source: preserved.source,
        range: preserved.range,
        attempts: summarizeAttempts(error?.attempts || []),
      });
      continue;
    }
    const fallback = {
      id: dataset.id,
      ok: false,
      updatedAt: new Date().toISOString(),
      error: describeError(error),
      attempts: error?.attempts || [],
      records: [],
    };
    writeJson(target, fallback);
    status.datasets.push({
      id: dataset.id,
      file: `data/${dataset.file}`,
      ok: false,
      error: fallback.error,
      records: 0,
      attempts: summarizeAttempts(fallback.attempts || []),
    });
  }
}

status.ok = status.datasets.some((dataset) => dataset.ok);
writeJson(path.join(outDir, "status.json"), status);
console.log(JSON.stringify(status, null, 2));

async function requestDataset(dataset) {
  if (dataset.mode === "operacionGenerationDaily" && dataset.multiDateDays) {
    return requestOperationGenerationWindow(dataset);
  }
  if (dataset.mode === "latestByBar" && dataset.multiDateDays) {
    return requestMultiDateWindow(dataset);
  }
  const paths = [dataset.path, ...(dataset.fallbackPaths || [])];
  const ranges = candidateRanges(dataset);
  let lastError;
  const attempts = [];
  for (const range of ranges) {
    for (const candidatePath of paths) {
      try {
        await delay(900);
        const json = dataset.paginate ? await requestPagedPath(dataset, candidatePath, range) : await requestPath(dataset, candidatePath, range);
        const rows = unwrapRows(json);
        attempts.push({ path: candidatePath, startDate: range.startDate, endDate: range.endDate, rows: rows.length });
        if (rows.length || !dataset.tryLookback) {
          return { __sourcePath: candidatePath, __range: range, __attempts: attempts, __payload: json };
        }
      } catch (error) {
        lastError = error;
        attempts.push({ path: candidatePath, startDate: range.startDate, endDate: range.endDate, error: describeError(error) });
        const message = String(error?.message || "");
        if (!message.startsWith("404 ") && !message.startsWith("500 ")) {
          error.attempts = attempts;
          throw error;
        }
      }
    }
  }
  if (lastError) {
    lastError.attempts = attempts;
    throw lastError;
  }
  return { __sourcePath: dataset.path, __range: ranges[0], __attempts: attempts, __payload: [] };
}

async function requestOperationGenerationWindow(dataset) {
  const attempts = [];
  const content = [];
  let lastError;
  for (let offset = dataset.multiDateDays - 1; offset >= 0; offset -= 1) {
    const date = formatDate(addDays(new Date(), -offset));
    const range = { startDate: date, endDate: date };
    try {
      await delay(900);
      const json = await requestPath(dataset, dataset.path, range);
      const rows = unwrapRows(json);
      attempts.push({ path: dataset.path, startDate: date, endDate: date, rows: rows.length });
      content.push(...rows);
    } catch (error) {
      lastError = error;
      attempts.push({ path: dataset.path, startDate: date, endDate: date, error: describeError(error) });
      const message = String(error?.message || "");
      if (!message.startsWith("404 ") && !message.startsWith("429 ") && !message.startsWith("500 ")) {
        error.attempts = attempts;
        throw error;
      }
    }
  }
  if (!content.length && lastError) {
    lastError.attempts = attempts;
    throw lastError;
  }
  return { __sourcePath: dataset.path, __range: { startDate: formatDate(addDays(new Date(), -(dataset.multiDateDays - 1))), endDate }, __attempts: attempts, __payload: { content } };
}

async function requestMultiDateWindow(dataset) {
  const attempts = [];
  const content = [];
  const paths = [dataset.path, ...(dataset.fallbackPaths || [])];
  let lastError;
  for (let offset = dataset.multiDateDays - 1; offset >= 0; offset -= 1) {
    const date = formatDate(addDays(new Date(), -offset));
    const range = { startDate: date, endDate: date };
    for (const candidatePath of paths) {
      try {
        await delay(900);
        const json = dataset.paginate ? await requestPagedPath(dataset, candidatePath, range) : await requestPath(dataset, candidatePath, range);
        const rows = unwrapRows(json);
        attempts.push({ path: candidatePath, startDate: date, endDate: date, rows: rows.length });
        content.push(...rows);
        break;
      } catch (error) {
        lastError = error;
        attempts.push({ path: candidatePath, startDate: date, endDate: date, error: describeError(error) });
        const message = String(error?.message || "");
        if (!message.startsWith("404 ") && !message.startsWith("429 ") && !message.startsWith("500 ")) {
          error.attempts = attempts;
          throw error;
        }
      }
    }
  }
  if (!content.length && lastError) {
    lastError.attempts = attempts;
    throw lastError;
  }
  return { __sourcePath: dataset.path, __range: { startDate: formatDate(addDays(new Date(), -(dataset.multiDateDays - 1))), endDate }, __attempts: attempts, __payload: { content } };
}

async function requestPagedPath(dataset, candidatePath, range) {
  const content = [];
  let firstPayload = null;
  const maxPages = Math.max(1, Math.min(50, Number(dataset.maxPages || 20)));
  for (let page = 0; page < maxPages; page += 1) {
    const json = await requestPath(dataset, candidatePath, range, page);
    if (!firstPayload) firstPayload = json;
    const rows = unwrapRows(json);
    if (!rows.length) break;
    content.push(...rows);
    const totalPages = Number(json?.totalPages ?? json?.page?.totalPages);
    const hasPagingMetadata = json?.totalPages !== undefined || json?.page?.totalPages !== undefined;
    if (!hasPagingMetadata) break;
    if (Number.isFinite(totalPages) && page >= totalPages - 1) break;
    if (rows.length && !Number.isFinite(totalPages) && rows.length < Number(json?.pageSize || json?.size || 1)) break;
    await delay(600);
  }
  return { ...(firstPayload || {}), content };
}

async function requestPath(dataset, candidatePath, range, page = 0) {
  const url = new URL((dataset.baseUrl || baseUrl) + candidatePath);
  if (dataset.dateParam) {
    url.searchParams.set(dataset.dateParam, range[dataset.dateValue || "startDate"] || range.endDate || range.startDate);
    url.searchParams.set("page", String(page));
  } else if (!dataset.noDateParams && !dataset.noRangeParams) {
    url.searchParams.set("startDate", range.startDate);
    url.searchParams.set("endDate", range.endDate);
    url.searchParams.set("page", String(page));
  }
  const headers = { accept: "application/json" };
  const key = dataset.apiKey || apiKey;
  if (key) {
    url.searchParams.set("user_key", key);
    url.searchParams.set("apiKey", key);
    url.searchParams.set("apikey", key);
    url.searchParams.set("subscription-key", key);
    url.searchParams.set("subscription_key", key);
    url.searchParams.set("api-key", key);
    headers.apiKey = key;
    headers.ApiKey = key;
    headers.apikey = key;
    headers.Authorization = `Bearer ${key}`;
    headers["Ocp-Apim-Subscription-Key"] = key;
    headers["subscription-key"] = key;
    headers["Subscription-Key"] = key;
    headers["x-api-key"] = key;
  }
  const response = await fetchWithRetry(url, headers);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${body.slice(0, 280)}`.trim());
  }
  const json = await response.json();
  return json;
}

async function fetchWithRetry(url, headers) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers });
    if (response.status !== 429 || attempt === 2) return response;
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await delay(Math.max(retryAfter * 1000, 15000 * (attempt + 1)));
  }
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
  const range = payload?.__range || { startDate, endDate };
  const actualPayload = payload?.__payload || payload;
  const rows = unwrapRows(actualPayload);
  if (dataset.mode === "generacion") {
    return normalizeGeneracion(rows, sourcePath, range, payload?.__attempts || []);
  }
  if (dataset.mode === "operacionGenerationDaily") {
    return normalizeOperacionGenerationDaily(rows, sourcePath, range, payload?.__attempts || []);
  }
  if (dataset.mode === "latestByBar") {
    const records = latestByName(rows).map((row) => ({
      name: readText(row, barNameFields()),
      key: normalizeKey(readText(row, barNameFields())),
      aliases: aliasKeysForRow(row),
      value: readNumber(row, cmgValueFields()),
      timestamp: readText(row, timestampFields()),
      raw: row,
    })).filter((row) => row.key && Number.isFinite(row.value));
    const history = cmgHistoryByBar(rows);
    return {
      id: dataset.id,
      ok: true,
      updatedAt: new Date().toISOString(),
      source: sourcePath,
      range,
      attempts: payload?.__attempts || [],
      rawCount: rows.length,
      sampleKeys: sampleKeys(rows),
      sampleRows: records.length ? [] : rows.slice(0, 3),
      records,
      hours: history.hours,
      history: history.records,
    };
  }
  return {
    id: dataset.id,
    ok: true,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range: dataset.noDateParams ? null : range,
    attempts: payload?.__attempts || [],
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

function cmgHistoryByBar(rows) {
  const hourKeys = new Set();
  const byBar = new Map();
  for (const row of rows) {
    const name = readText(row, barNameFields());
    const key = normalizeKey(name);
    const timestamp = readText(row, timestampFields());
    const hourKey = parseHourKey(timestamp);
    const value = readNumber(row, cmgValueFields());
    if (!key || !hourKey || !Number.isFinite(value)) continue;
    hourKeys.add(hourKey);
    if (!byBar.has(key)) byBar.set(key, { name, key, aliases: aliasKeysForRow(row), values: new Map() });
    byBar.get(key).values.set(hourKey, value);
  }
  const hours = [...hourKeys].sort();
  return {
    hours,
    records: [...byBar.values()].map((bar) => ({
      name: bar.name,
      key: bar.key,
      aliases: bar.aliases,
      values: hours.map((timestamp) => ({ timestamp, value: Number.isFinite(bar.values.get(timestamp)) ? bar.values.get(timestamp) : null })),
    })),
  };
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
    "barra_info",
    "barra_transf",
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
    "cmg_usd_mwh_",
    "cmg_clp_kwh_",
    "valor",
    "value",
    "usdMWh",
    "usd_mwh",
  ];
}

function timestampFields() {
  return ["fecha_hora", "fecha_minuto", "fechaHora", "fecha", "date", "datetime", "hora", "timestamp"];
}

function aliasKeysForRow(row) {
  const values = [
    readText(row, ["barra_info"]),
    readText(row, ["barra_transf"]),
    readText(row, barNameFields()),
  ];
  const aliases = new Set();
  for (const value of values) {
    const normalized = normalizeKey(value);
    if (normalized) aliases.add(normalized);
    const noVoltage = normalized.replace(/\b\d{2,3}\b/g, " ").replace(/\s+/g, " ").trim();
    if (noVoltage) aliases.add(noVoltage);
  }
  return [...aliases];
}

function readText(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row[name] !== null && row[name] !== "") return String(row[name]);
  }
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

function tecnologiaFields() {
  return ["tecnologia", "tipo_tecnologia", "tipo", "fuente", "combustible", "energia_primaria", "grupo_tecnologia", "tecnologia_grupo"];
}

function generacionValueFields() {
  return [
    "generacion_mw",
    "generacion_MWh",
    "generacion_mwh",
    "generacion",
    "energia_mw",
    "energia",
    "potencia",
    "potencia_generacion",
    "mw",
    "valor",
    "value",
    "mwh",
  ];
}

function canonicalTech(value) {
  const key = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return TECH_CANON[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Sin clasificar");
}

function parseHourKey(value) {
  const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}` : null;
}

function normalizeGeneracion(rows, sourcePath, range, attempts) {
  const buckets = new Map();
  for (const row of rows) {
    const hourKey = parseHourKey(readText(row, timestampFields()));
    if (!hourKey) continue;
    const mw = readNumber(row, generacionValueFields());
    if (!Number.isFinite(mw) || mw <= 0) continue;
    const tech = canonicalTech(readText(row, tecnologiaFields()));
    if (!buckets.has(hourKey)) buckets.set(hourKey, new Map());
    const byTech = buckets.get(hourKey);
    byTech.set(tech, (byTech.get(tech) || 0) + mw);
  }

  const hourKeys = [...buckets.keys()].sort();
  const window = hourKeys.slice(-24);
  const techNames = new Set();
  for (const hourKey of window) {
    for (const tech of buckets.get(hourKey).keys()) techNames.add(tech);
  }
  const orderedTechs = [...techNames].sort();

  const series = orderedTechs.map((tech) => ({
    technology: tech,
    values: window.map((hourKey) => Math.max(0, Math.round((buckets.get(hourKey).get(tech) || 0) / 10) * 10)),
  }));
  const total = window.map((hourKey) => {
    let sum = 0;
    for (const tech of orderedTechs) sum += buckets.get(hourKey).get(tech) || 0;
    return Math.round(sum / 10) * 10;
  });

  return {
    id: "generacion-real",
    ok: true,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range,
    attempts,
    rawCount: rows.length,
    hours: window,
    series,
    total,
  };
}

function normalizeOperacionGenerationDaily(rows, sourcePath, range, attempts) {
  const records = rows
    .map((row) => ({
      technology: canonicalTech(readText(row, ["description", "tecnologia", "technology"])),
      dailyGWh: readNumber(row, ["dailyCurrent", "daily_current", "daily", "valor", "value"]),
      monthlyGWh: readNumber(row, ["monthlyCurrentTodate", "monthly_current_todate"]),
      annualGWh: readNumber(row, ["annualCurrentTodate", "annual_current_todate"]),
      date: readText(row, ["date", "fecha"]),
      raw: row,
    }))
    .filter((row) => row.technology && Number.isFinite(row.dailyGWh));
  return {
    id: "generacion-real",
    ok: records.length > 0,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range,
    attempts,
    rawCount: rows.length,
    granularity: "daily",
    unit: "GWh",
    records,
  };
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

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function dateRanges() {
  if (process.env.CEN_START_DATE || process.env.CEN_END_DATE) {
    return [{ startDate, endDate }];
  }
  const ranges = [];
  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    const day = formatDate(addDays(new Date(), -offset));
    ranges.push({ startDate: day, endDate: day });
  }
  return ranges;
}

function candidateRanges(dataset) {
  if (dataset.rangeSpanDays) {
    if (dataset.singleWideRange) return [{ startDate: formatDate(addDays(new Date(), -dataset.rangeSpanDays)), endDate }];
    const ranges = [];
    for (let span = dataset.rangeSpanDays; span >= 1; span -= 1) {
      ranges.push({ startDate: formatDate(addDays(new Date(), -span)), endDate });
    }
    return ranges;
  }
  return dataset.tryLookback ? dateRanges() : [{ startDate, endDate }];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preserveExistingDataset(file, dataset, error) {
  try {
    if (!fs.existsSync(file)) return null;
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    const hasRecords = Array.isArray(existing.records) && existing.records.length > 0;
    const hasSeries = Array.isArray(existing.series) && existing.series.length > 0;
    if (!existing.ok || (!hasRecords && !hasSeries)) return null;
    const preserved = {
      ...existing,
      ok: true,
      stale: true,
      staleReason: describeError(error),
      lastFetchAttemptAt: new Date().toISOString(),
      lastFetchAttempts: error?.attempts || [],
    };
    writeJson(file, preserved);
    return preserved;
  } catch {
    return null;
  }
}

function summarizeAttempts(attempts) {
  return attempts.slice(0, 12).map((attempt) => ({
    path: attempt.path,
    startDate: attempt.startDate,
    endDate: attempt.endDate,
    rows: attempt.rows,
    error: attempt.error,
  }));
}

function sampleKeys(rows) {
  return [...new Set(rows.slice(0, 5).flatMap((row) => Object.keys(row || {})))].slice(0, 80);
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
