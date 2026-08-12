import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs", "data");
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = (process.env.CEN_API_BASE_URL || "https://sipub.api.coordinador.cl:443").replace(/\/$/, "");
const apiKey = process.env.CEN_API_KEY || "";
const operacionBaseUrl = (process.env.CEN_OPERACION_API_BASE_URL || "https://operacion.api.coordinador.cl:443").replace(/\/$/, "");
const operacionUserKey = process.env.CEN_OPERACION_USER_KEY || "";
const cenWindowDays = Math.max(1, Math.min(31, Number(process.env.CEN_WINDOW_DAYS || 7)));
const defaultEndDate = formatDate(new Date());
const defaultStartDate = formatDate(addDays(new Date(), -(cenWindowDays - 1)));
const startDate = process.env.CEN_START_DATE || defaultStartDate;
const endDate = process.env.CEN_END_DATE || defaultEndDate;
const lookbackDays = Number(process.env.CEN_LOOKBACK_DAYS || 2);
const cmgDays = Math.max(1, Math.min(7, Number(process.env.CEN_CMG_DAYS || 7)));
const generationDays = Math.max(1, Math.min(7, Number(process.env.CEN_GENERACION_DAYS || 7)));
const enabledDatasetIds = new Set(
  (process.env.CEN_DATASETS || "cmg-real,cmg-online,demanda-real,potencia-transitada,generacion-real,centrales")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (enabledDatasetIds.has("demanda")) enabledDatasetIds.add("demanda-real");

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
    query: { limit: "5000" },
    tryLookback: false,
  },
  {
    id: "cmg-real",
    file: "cmg-real-latest.json",
    path: "/costo-marginal-real/v4/findByDate",
    fallbackPaths: ["/cmg-real/v4/findByDate", "/costos-marginales-reales/v4/findByDate"],
    mode: "latestByBar",
    paginate: true,
    query: { type: "DEFINITIVO", limit: "5000" },
    tryLookback: false,
  },
  {
    id: "demanda-real",
    file: "demanda-real-estimada.json",
    path: "/demanda-real-estimada/v4/findByDate",
    fallbackPaths: ["/demanda-real/v4/findByDate", "/demanda/v4/findByDate"],
    mode: "demandaReal",
    paginate: true,
    query: { limit: "5000" },
    tryLookback: false,
  },
  {
    id: "potencia-transitada",
    file: "potencia-transitada-latest.json",
    path: "/potencia-transitada/v4/findByDate",
    fallbackPaths: [],
    mode: "potenciaTransitada",
    paginate: true,
    query: { limit: "5000" },
    maxPages: 50,
    tryLookback: false,
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
    file: "generacion-real-central-latest.json",
    path: "/generacion-real/v3/findByDate",
    fallbackPaths: [],
    mode: "generacionRealCentral",
    paginate: true,
    query: { pageSize: "5000" },
    maxPages: 50,
    tryLookback: false,
  },
  {
    id: "centrales",
    file: "centrales-latest.json",
    path: "/centrales/v4/findByDate",
    fallbackPaths: [],
    mode: "centralesCatalog",
    paginate: true,
    noDateParams: true,
    query: { limit: "5000" },
    maxPages: 20,
    tryLookback: false,
  },
  {
    id: "generacion-real-diaria",
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
  cenWindowDays,
  globalWindow: { startDate, endDate },
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
    const datasetOk = normalized.ok !== false;
    status.datasets.push({
      id: dataset.id,
      file: `data/${dataset.file}`,
      ok: datasetOk,
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
  const dates = windowDates().slice(-(dataset.multiDateDays || generationDays));
  for (const date of dates) {
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
  return { __sourcePath: dataset.path, __range: { startDate, endDate }, __attempts: attempts, __payload: { content } };
}

async function requestMultiDateWindow(dataset) {
  const attempts = [];
  const content = [];
  const paths = [dataset.path, ...(dataset.fallbackPaths || [])];
  let lastError;
  for (let offset = 0; offset < dataset.multiDateDays; offset += 1) {
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
    const pageSize = Number(dataset.query?.pageSize || dataset.query?.limit || json?.pageSize || json?.size || 0);
    if (!hasPagingMetadata && (!pageSize || rows.length < pageSize)) break;
    if (Number.isFinite(totalPages) && page >= totalPages - 1) break;
    if (rows.length && !Number.isFinite(totalPages) && pageSize && rows.length < pageSize) break;
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
  if (dataset.paginate && !url.searchParams.has("page")) {
    url.searchParams.set("page", String(page));
  }
  for (const [key, value] of Object.entries(dataset.query || {})) {
    url.searchParams.set(key, String(value));
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
  return fetch(url, { headers });
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
  if (dataset.mode === "generacionRealCentral") {
    return normalizeGeneracionRealCentral(rows, dataset.id, sourcePath, range, payload?.__attempts || []);
  }
  if (dataset.mode === "centralesCatalog") {
    return normalizeCentralesCatalog(rows, dataset.id, sourcePath, range, payload?.__attempts || []);
  }
  if (dataset.mode === "demandaReal") {
    return normalizeDemandaReal(rows, dataset.id, sourcePath, range, payload?.__attempts || []);
  }
  if (dataset.mode === "potenciaTransitada") {
    return normalizePotenciaTransitada(rows, dataset.id, sourcePath, range, payload?.__attempts || []);
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
    "cmg_mills_kwh_",
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

function normalizeGeneracionRealCentral(rows, id, sourcePath, range, attempts) {
  const rawRecords = rows
    .map((row) => {
      const timestamp = generationTimestamp(row);
      return {
        timestamp,
        hour: timestampHourNumber(timestamp),
        date: readText(row, ["fecha", "date"]),
        idCentral: readText(row, ["idCentral", "id_central", "central_id"]),
        name: readText(row, ["nombreCentralUnidad", "nombre_central_unidad", "central", "nombre", "name"]),
        technology: canonicalTech(readText(row, ["tipoTecnologia", "tipo_tecnologia", "tecnologia", "technology"])),
        owner: readText(row, ["propietario", "owner"]),
        unit: readText(row, ["unidad", "unit"]),
        value: readNumber(row, ["valor", "value", "generacion", "mwh", "mw"]),
        raw: row,
      };
    })
    .filter((row) => row.name && row.timestamp && Number.isFinite(row.value));

  const hourKeys = [...new Set(rawRecords.map((row) => row.timestamp))].sort().slice(-24);
  const hourSet = new Set(hourKeys);
  const byPlant = new Map();
  for (const row of rawRecords) {
    if (!hourSet.has(row.timestamp)) continue;
    const key = normalizeKey(row.name);
    if (!key) continue;
    if (!byPlant.has(key)) {
      byPlant.set(key, {
        name: row.name,
        key,
        aliases: [normalizeKey(row.name), normalizeKey(row.idCentral)].filter(Boolean),
        idCentral: row.idCentral,
        technology: row.technology,
        owner: row.owner,
        values: new Map(),
        raw: row.raw,
      });
    }
    const plant = byPlant.get(key);
    plant.values.set(row.timestamp, (plant.values.get(row.timestamp) || 0) + row.value);
  }
  const records = [...byPlant.values()].map((plant) => {
    const values = hourKeys.map((timestamp) => ({ timestamp, value: plant.values.has(timestamp) ? plant.values.get(timestamp) : null }));
    const latest = [...values].reverse().find((point) => Number.isFinite(Number(point.value)));
    return {
      name: plant.name,
      key: plant.key,
      aliases: plant.aliases,
      idCentral: plant.idCentral,
      technology: plant.technology,
      owner: plant.owner,
      value: latest ? latest.value : null,
      timestamp: latest ? latest.timestamp : "",
      values,
      raw: plant.raw,
    };
  }).filter((row) => Number.isFinite(Number(row.value)));
  const techs = [...new Set(records.map((row) => row.technology).filter(Boolean))].sort();
  const series = techs.map((technology) => ({
    technology,
    values: hourKeys.map((timestamp) => records.reduce((sum, row) => sum + (row.technology === technology ? Number(row.values.find((point) => point.timestamp === timestamp)?.value) || 0 : 0), 0)),
  }));
  const total = hourKeys.map((timestamp) => records.reduce((sum, row) => sum + (Number(row.values.find((point) => point.timestamp === timestamp)?.value) || 0), 0));
  return {
    id,
    ok: records.length > 0,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range,
    attempts,
    rawCount: rows.length,
    sampleKeys: sampleKeys(rows),
    granularity: "hourly-central",
    unit: "MWh",
    hours: hourKeys,
    records,
    series,
    total,
  };
}

function normalizeCentralesCatalog(rows, id, sourcePath, range, attempts) {
  const records = rows
    .map((row) => ({
      name: readText(row, ["central", "nombre", "name"]),
      key: normalizeKey(readText(row, ["central", "nombre", "name"])),
      idCentral: readText(row, ["id_central", "idCentral", "central_id"]),
      installation: readText(row, ["instalacion", "installation"]),
      owner: readText(row, ["propietario", "owner"]),
      technology: canonicalTech(readText(row, ["tipo_tecnologia", "tipoTecnologia", "tecnologia"])),
      connectionPoint: readText(row, ["punto_conexion", "puntoConexion"]),
      region: readText(row, ["region"]),
      raw: row,
    }))
    .filter((row) => row.name || row.idCentral);
  return {
    id,
    ok: records.length > 0,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range: null,
    attempts,
    rawCount: rows.length,
    sampleKeys: sampleKeys(rows),
    records: records.slice(0, 10000),
  };
}

function generationTimestamp(row) {
  const direct = readText(row, ["fecha_hora", "fechaHora", "timestamp"]);
  if (direct) return parseHourKey(direct) || direct;
  const fecha = readText(row, ["fecha", "date"]);
  const hourValue = readText(row, ["hora", "hour"]);
  if (!fecha) return "";
  const rawHour = Number(String(hourValue || "0").match(/\d+/)?.[0] || 0);
  const normalized = rawHour === 24 ? 23 : Math.max(0, Math.min(23, rawHour));
  return `${fecha} ${String(normalized).padStart(2, "0")}`;
}

function timestampHourNumber(timestamp) {
  const match = String(timestamp || "").match(/(?:T|\s)(\d{2})/);
  return match ? Number(match[1]) : NaN;
}

function normalizeDemandaReal(rows, id, sourcePath, range, attempts) {
  const records = rows
    .map((row) => ({
      timestamp: readText(row, ["fecha_hora", "fechaHora", "fecha", "date", "datetime", "timestamp"]),
      valueMWh: readNumber(row, ["medida_kwh", "medidaKwh", "energia_kwh", "value"]),
      bar: readText(row, ["barra", "nombre_barra", "bar"]),
      supplier: readText(row, ["suministrador", "supplier"]),
      withdrawal: readText(row, ["retiro", "withdrawal"]),
      type: readText(row, ["tipo", "type"]),
      raw: row,
    }))
    .filter((row) => row.timestamp && Number.isFinite(row.valueMWh));
  const byHour = new Map();
  for (const row of records) {
    const hourKey = parseHourKey(row.timestamp);
    if (!hourKey) continue;
    byHour.set(hourKey, (byHour.get(hourKey) || 0) + row.valueMWh / 1000);
  }
  const hours = [...byHour.keys()].sort();
  const values = hours.map((timestamp) => ({ timestamp, valueMWh: Math.round(byHour.get(timestamp)) }));
  return {
    id,
    ok: values.length > 0,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range,
    attempts,
    rawCount: rows.length,
    sampleKeys: sampleKeys(rows),
    records: records.slice(0, 5000),
    hours,
    values,
    unit: "MWh",
  };
}

function normalizePotenciaTransitada(rows, id, sourcePath, range, attempts) {
  const records = rows
    .map((row) => ({
      lineName: readText(row, ["nombre_linea", "nombreLinea", "linea", "line_name"]),
      lineId: readText(row, ["id_linea", "idLinea", "line_id"]),
      timestamp: transitTimestamp(row),
      bar: readText(row, ["barra", "punto_medida", "puntoMedida"]),
      zone: readText(row, ["zona", "zone"]),
      direction: readText(row, ["sentido_linea", "sentidoLinea", "direction"]),
      powerMw: readNumber(row, ["potencia_mwh", "potenciaMwh", "potencia_mw", "potenciaMw", "potencia_kwh", "potenciaKwh"]),
      raw: row,
    }))
    .filter((row) => row.lineName && row.timestamp && Number.isFinite(row.powerMw));
  const latestByLine = new Map();
  const historyByLine = new Map();
  for (const row of records) {
    const key = normalizeKey(row.lineName);
    if (!key) continue;
    if (!historyByLine.has(key)) historyByLine.set(key, { lineName: row.lineName, key, values: [] });
    historyByLine.get(key).values.push({ timestamp: row.timestamp, valueMw: row.powerMw, direction: row.direction });
    const current = latestByLine.get(key);
    if (!current || String(row.timestamp) > String(current.timestamp || "")) latestByLine.set(key, row);
  }
  const latest = [...latestByLine.values()].map((row) => ({
    name: row.lineName,
    key: normalizeKey(row.lineName),
    aliases: [normalizeKey(row.lineName), normalizeKey(row.lineId)].filter(Boolean),
    valueMw: row.powerMw,
    timestamp: row.timestamp,
    direction: row.direction,
    raw: row.raw,
  }));
  const hours = [...new Set(records.map((row) => parseHourKey(row.timestamp)).filter(Boolean))].sort();
  return {
    id,
    ok: latest.length > 0,
    updatedAt: new Date().toISOString(),
    source: sourcePath,
    range,
    attempts,
    rawCount: rows.length,
    sampleKeys: sampleKeys(rows),
    records: latest,
    hours,
    history: [...historyByLine.values()].map((row) => ({
      ...row,
      values: row.values.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(-24),
    })),
    unit: "MW",
  };
}

function transitTimestamp(row) {
  const direct = readText(row, ["fecha_hora", "fechaHora", "utc", "timestamp"]);
  if (direct) return direct;
  const fecha = readText(row, ["fecha", "date"]);
  const hora = readText(row, ["hora", "hour"]);
  if (!fecha) return "";
  const hourMatch = String(hora || "0").match(/\d+/);
  const hour = hourMatch ? String(Math.max(0, Math.min(23, Number(hourMatch[0]) || 0))).padStart(2, "0") : "00";
  return `${fecha} ${hour}:00:00`;
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
  return [{ startDate, endDate }];
}

function windowDates() {
  const dates = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  for (let current = start; current <= end; current = addDays(current, 1)) {
    dates.push(formatDate(current));
  }
  return dates;
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
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
