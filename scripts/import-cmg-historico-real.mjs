import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = process.cwd();
const sourceDir = path.join(root, "docs", "data", "cmg historicos reales");
const historyDir = path.join(root, "docs", "data", "history");
const cmgDir = path.join(historyDir, "cmg");

const tsvFiles = fs.existsSync(sourceDir)
  ? fs.readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith(".tsv")).sort()
  : [];

if (!tsvFiles.length) {
  console.log(JSON.stringify({ ok: false, error: `No TSV files found in ${sourceDir}` }, null, 2));
  process.exitCode = 1;
} else {
  const months = new Map();
  const stats = { ok: true, files: [], rows: 0, parsedRows: 0, selectedRows: 0, months: new Set() };

  for (const fileName of tsvFiles) {
    const file = path.join(sourceDir, fileName);
    const result = await ingestTsv(file, months);
    stats.files.push(result);
    stats.rows += result.rows;
    stats.parsedRows += result.parsedRows;
    stats.selectedRows += result.selectedRows;
    result.months.forEach((month) => stats.months.add(month));
  }

  const written = writeMonths(months);
  updateManifest(written);
  updateProgress(stats, written);

  console.log(JSON.stringify({
    ok: true,
    files: stats.files,
    rows: stats.rows,
    parsedRows: stats.parsedRows,
    selectedRows: stats.selectedRows,
    months: written,
  }, null, 2));
}

async function ingestTsv(file, months) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let rows = 0;
  let parsedRows = 0;
  let selectedRows = 0;
  const seenMonths = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = line.split("\t").map((value) => value.trim());
      continue;
    }
    rows += 1;
    const values = line.split("\t");
    if (values.length < 9) continue;
    const row = rowObject(header, values);

    const fecha = readText(row, ["FECHA"]);
    const hra = readText(row, ["HRA"]);
    const min = readText(row, ["MIN"]);
    const transf = readText(row, ["BARRA_TRANSF"]);
    const cmg = parseNumber(readText(row, ["CMg[USD/MWh]"]));

    parsedRows += 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !transf || !Number.isFinite(cmg)) continue;
    if (!isSelectedDay(fecha)) continue;
    if (min !== "45") continue;

    const month = fecha.slice(0, 7);
    const state = ensureMonth(months, month);
    const node = ensureNode(state, transf, row);

    const hour = Number(hra);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    const timestamp = `${fecha} ${String(hour).padStart(2, "0")}`;
    state.hours.add(timestamp);
    node.values.set(timestamp, round3(cmg));
    selectedRows += 1;
    seenMonths.add(month);
  }

  return {
    file: path.relative(root, file).replace(/\\/g, "/"),
    rows,
    parsedRows,
    selectedRows,
    months: [...seenMonths].sort(),
  };
}

function isSelectedDay(fecha) {
  return fecha === "2026-07-22";
}

function writeMonths(months) {
  const written = [];
  for (const [month, state] of [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hours = [...state.hours].sort();
    const nodes = [...state.nodes.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const payload = {
      schema: "sen-history-cmg-v1",
      source: "CEN/Qlik Descarga Costo Marginal Real TSV (REAL-DEF), 1 valor/hora (MIN=45)",
      generatedAt: new Date().toISOString(),
      month,
      unit: "USD/MWh",
      hours,
      nodes: nodes.map((node) => ({ name: node.name, key: node.key, aliases: node.aliases })),
      values: nodes.map((node) => hours.map((hour) => node.values.has(hour) ? node.values.get(hour) : null)),
    };
    writeJson(path.join(cmgDir, `${month}.json`), payload);
    written.push(month);
  }
  return written;
}

function updateManifest(months) {
  const manifestFile = path.join(historyDir, "manifest.json");
  const manifest = readJson(manifestFile) || { schema: "sen-etl-manifest-v1", generatedAt: "", window: {}, datasets: {} };
  manifest.generatedAt = new Date().toISOString();
  manifest.datasets.cmg = { months: months.map((month) => ({ month, file: `history/cmg/${month}.json` })) };
  writeJson(manifestFile, manifest);
}

function updateProgress(stats, months) {
  const progressFile = path.join(historyDir, "progress.json");
  const progress = readJson(progressFile) || { schema: "sen-history-progress-v1", runs: [] };
  progress.runs = [{
    generatedAt: new Date().toISOString(),
    id: "cmg-historico-real-tsv",
    ok: months.length > 0,
    files: stats.files,
    rows: stats.rows,
    parsedRows: stats.parsedRows,
    selectedRows: stats.selectedRows,
    months,
    note: "1 valor por hora (MIN=45), solo dia 2026-07-22, version REAL-DEF.",
  }, ...(progress.runs || [])].slice(0, 30);
  writeJson(progressFile, progress);
}

function ensureMonth(months, month) {
  if (!months.has(month)) months.set(month, { hours: new Set(), nodes: new Map() });
  return months.get(month);
}

function ensureNode(state, transf, row) {
  if (!state.nodes.has(transf)) {
    state.nodes.set(transf, {
      name: transf,
      key: normalizeKey(transf),
      aliases: aliasKeys([transf, readText(row, ["BARRA_INFO"])]),
      values: new Map(),
    });
  }
  return state.nodes.get(transf);
}

function rowObject(header, values) {
  const row = {};
  header.forEach((name, index) => { row[name] = values[index] ?? ""; });
  return row;
}

function readText(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") return String(row[name]).trim();
  }
  return "";
}

function aliasKeys(values) {
  return [...new Set(values.flatMap((value) => [cleanText(value), normalizeKey(value)]).filter(Boolean))];
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(barra|se|subestacion|subest|ba|bp|bp1|bp2|bp3|bp4|kv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function parseNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return NaN;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
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
