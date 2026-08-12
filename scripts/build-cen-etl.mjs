import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "docs", "data");
const liveDir = path.join(dataDir, "live");
const historyDir = path.join(dataDir, "history");
fs.mkdirSync(liveDir, { recursive: true });
fs.mkdirSync(historyDir, { recursive: true });

const status = readJson(path.join(dataDir, "status.json")) || {};
const cmgReal = readJson(path.join(dataDir, "cmg-real-latest.json"));
const cmgOnline = readJson(path.join(dataDir, "cmg-online-latest.json"));
const demanda = readJson(path.join(dataDir, "demanda-real-estimada.json"));
const generacionCentral = readJson(path.join(dataDir, "generacion-real-central-latest.json"));
const generacionDiaria = readJson(path.join(dataDir, "generacion-real-last-24h.json"));
const flujos = readJson(path.join(dataDir, "potencia-transitada-latest.json"));

const manifest = {
  schema: "sen-etl-manifest-v1",
  generatedAt: new Date().toISOString(),
  window: status.globalWindow || { startDate: status.startDate || "", endDate: status.endDate || "" },
  datasets: {},
};

buildStatus();
buildCmg();
buildDemanda();
buildGeneracion();
buildFlujos();
writeJson(path.join(historyDir, "manifest.json"), manifest);

function buildStatus() {
  writeJson(path.join(liveDir, "status.json"), {
    schema: "sen-live-status-v1",
    generatedAt: status.generatedAt || new Date().toISOString(),
    window: status.globalWindow || { startDate: status.startDate || "", endDate: status.endDate || "" },
    datasets: (status.datasets || []).map((dataset) => ({
      id: dataset.id,
      ok: Boolean(dataset.ok),
      stale: Boolean(dataset.stale),
      records: dataset.records || 0,
      updatedAt: dataset.updatedAt || "",
      source: dataset.source || "",
      error: dataset.error || "",
    })),
  });
}

function buildCmg() {
  const source = hasRecords(cmgReal) ? cmgReal : hasRecords(cmgOnline) ? cmgOnline : cmgReal || cmgOnline;
  const records = compactRecords(source?.records || [], ["name", "key", "aliases", "value", "timestamp"]);
  writeJson(path.join(liveDir, "cmg-current.json"), {
    schema: "sen-live-cmg-v1",
    ok: records.length > 0,
    stale: Boolean(source?.stale),
    updatedAt: source?.updatedAt || "",
    source: source?.source || "",
    range: source?.range || null,
    records,
  });

  const historyRows = Array.isArray(source?.history) ? source.history : [];
  const months = new Map();
  for (const row of historyRows) {
    if (!Array.isArray(row.values)) continue;
    for (const point of row.values) {
      const month = monthKey(point.timestamp);
      if (!month) continue;
      if (!months.has(month)) months.set(month, []);
    }
  }
  for (const month of months.keys()) {
    const hours = sortedUnique(historyRows.flatMap((row) => (row.values || []).map((point) => point.timestamp).filter((timestamp) => monthKey(timestamp) === month)));
    const nodes = historyRows.map((row) => ({ name: row.name || "", key: row.key || "", aliases: row.aliases || [] }));
    const values = historyRows.map((row) => {
      const byTime = new Map((row.values || []).map((point) => [point.timestamp, finiteOrNull(point.value)]));
      return hours.map((timestamp) => byTime.has(timestamp) ? byTime.get(timestamp) : null);
    });
    writeHistory("cmg", month, { schema: "sen-history-cmg-v1", hours, nodes, values, source: source?.source || "", range: source?.range || null });
    manifest.datasets.cmg = addMonth(manifest.datasets.cmg, month, `history/cmg/${month}.json`);
  }
}

function buildDemanda() {
  const values = Array.isArray(demanda?.values) ? demanda.values : [];
  const latest = [...values].reverse().find((point) => Number.isFinite(Number(point.valueMWh)));
  writeJson(path.join(liveDir, "demanda-current.json"), {
    schema: "sen-live-demanda-v1",
    ok: Boolean(latest),
    stale: Boolean(demanda?.stale),
    updatedAt: demanda?.updatedAt || "",
    source: demanda?.source || "",
    range: demanda?.range || null,
    latest: latest || null,
  });
  writeMonthlySeries("demanda", values, "valueMWh", "sen-history-demanda-v1", demanda);
}

function buildGeneracion() {
  const centralOk = hasRecords(generacionCentral) && generacionCentral.granularity === "hourly-central";
  const source = centralOk ? generacionCentral : generacionDiaria;
  const payload = {
    schema: "sen-live-generacion-v1",
    ok: hasRecords(source),
    stale: Boolean(source?.stale),
    updatedAt: source?.updatedAt || "",
    source: source?.source || "",
    range: source?.range || null,
    granularity: source?.granularity || null,
    unit: source?.unit || "",
    hours: source?.hours || [],
    records: compactRecords(source?.records || [], ["name", "key", "aliases", "idCentral", "technology", "owner", "value", "timestamp", "values", "dailyGWh", "monthlyGWh", "annualGWh", "date"]),
    series: source?.series || [],
    total: source?.total || [],
  };
  writeJson(path.join(liveDir, "generacion-current.json"), payload);

  if (centralOk) {
    const months = new Map();
    for (const record of source.records || []) {
      for (const point of record.values || []) {
        const month = monthKey(point.timestamp);
        if (month) months.set(month, true);
      }
    }
    for (const month of months.keys()) {
      const hours = sortedUnique((source.hours || []).filter((timestamp) => monthKey(timestamp) === month));
      const plants = (source.records || []).map((row) => ({ name: row.name || "", key: row.key || "", aliases: row.aliases || [], idCentral: row.idCentral || "", technology: row.technology || "" }));
      const values = (source.records || []).map((row) => {
        const byTime = new Map((row.values || []).map((point) => [point.timestamp, finiteOrNull(point.value)]));
        return hours.map((timestamp) => byTime.has(timestamp) ? byTime.get(timestamp) : null);
      });
      writeHistory("generacion", month, { schema: "sen-history-generacion-v1", hours, plants, values, source: source.source || "", range: source.range || null });
      manifest.datasets.generacion = addMonth(manifest.datasets.generacion, month, `history/generacion/${month}.json`);
    }
  }
}

function buildFlujos() {
  const records = compactRecords(flujos?.records || [], ["name", "key", "aliases", "valueMw", "timestamp", "direction"]);
  writeJson(path.join(liveDir, "flujos-current.json"), {
    schema: "sen-live-flujos-v1",
    ok: records.length > 0,
    stale: Boolean(flujos?.stale),
    updatedAt: flujos?.updatedAt || "",
    source: flujos?.source || "",
    range: flujos?.range || null,
    records,
  });

  const historyRows = Array.isArray(flujos?.history) ? flujos.history : [];
  const months = new Map();
  for (const row of historyRows) {
    for (const point of row.values || []) {
      const month = monthKey(point.timestamp);
      if (month) months.set(month, true);
    }
  }
  for (const month of months.keys()) {
    const hours = sortedUnique(historyRows.flatMap((row) => (row.values || []).map((point) => point.timestamp).filter((timestamp) => monthKey(timestamp) === month)));
    const lines = historyRows.map((row) => ({ name: row.lineName || row.name || "", key: row.key || "" }));
    const values = historyRows.map((row) => {
      const byTime = new Map((row.values || []).map((point) => [point.timestamp, finiteOrNull(point.valueMw)]));
      return hours.map((timestamp) => byTime.has(timestamp) ? byTime.get(timestamp) : null);
    });
    writeHistory("flujos", month, { schema: "sen-history-flujos-v1", hours, lines, values, source: flujos?.source || "", range: flujos?.range || null });
    manifest.datasets.flujos = addMonth(manifest.datasets.flujos, month, `history/flujos/${month}.json`);
  }
}

function writeMonthlySeries(id, values, field, schema, source) {
  const byMonth = new Map();
  for (const point of values || []) {
    const month = monthKey(point.timestamp);
    if (!month) continue;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(point);
  }
  for (const [month, points] of byMonth.entries()) {
    const sorted = points.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    writeHistory(id, month, { schema, hours: sorted.map((point) => point.timestamp), values: sorted.map((point) => finiteOrNull(point[field])), source: source?.source || "", range: source?.range || null });
    manifest.datasets[id] = addMonth(manifest.datasets[id], month, `history/${id}/${month}.json`);
  }
}

function compactRecords(records, fields) {
  return (records || []).map((record) => {
    const output = {};
    for (const field of fields) {
      if (record?.[field] !== undefined) output[field] = record[field];
    }
    return output;
  });
}

function writeHistory(dataset, month, value) {
  const dir = path.join(historyDir, dataset);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, `${month}.json`), value);
}

function addMonth(entry, month, file) {
  const current = entry || { months: [] };
  if (!current.months.some((row) => row.month === month)) current.months.push({ month, file });
  current.months.sort((a, b) => a.month.localeCompare(b.month));
  return current;
}

function hasRecords(value) {
  return Boolean(value?.ok && Array.isArray(value.records) && value.records.length > 0);
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function monthKey(timestamp) {
  const match = String(timestamp || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
