import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = process.cwd();
const sourceDir = path.join(root, "docs", "data", "potencia transitada por lineas historico real");
const historyDir = path.join(root, "docs", "data", "history");
const flowsDir = path.join(historyDir, "flujos");

fs.mkdirSync(flowsDir, { recursive: true });

const csvFiles = fs.existsSync(sourceDir)
  ? fs.readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith(".csv")).sort()
  : [];

if (!csvFiles.length) {
  console.log(JSON.stringify({ ok: false, error: `No CSV files found in ${sourceDir}` }, null, 2));
  process.exitCode = 1;
} else {
  const months = new Map();
  const stats = { ok: true, files: [], rows: 0, parsedRows: 0, months: new Set() };

  for (const fileName of csvFiles) {
    const file = path.join(sourceDir, fileName);
    const result = await ingestCsv(file, months);
    stats.files.push(result);
    stats.rows += result.rows;
    stats.parsedRows += result.parsedRows;
    result.months.forEach((month) => stats.months.add(month));
  }

  const writtenMonths = writeMonthlyFlows(months);
  updateManifest(writtenMonths);
  updateProgress(stats, writtenMonths);

  console.log(JSON.stringify({ ok: true, files: stats.files, rows: stats.rows, parsedRows: stats.parsedRows, months: writtenMonths }, null, 2));
}

async function ingestCsv(file, months) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let rows = 0;
  let parsedRows = 0;
  const seenMonths = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = splitCsvLine(line).map((value) => value.trim());
      continue;
    }
    rows += 1;
    const values = splitCsvLine(line);
    const row = rowObject(header, values);
    const timestamp = parseTimestamp(readText(row, ["Fecha_Hora", "Fecha Hora", "Fecha"]));
    const tramo = readText(row, ["Tramo", "Linea", "Línea"]);
    const valueMw = parseNumber(row["Potencia (Mw)"] ?? row["Potencia (MW)"] ?? row.Potencia);
    if (!timestamp || !tramo || !Number.isFinite(valueMw)) continue;
    const month = timestamp.slice(0, 7);
    const state = ensureMonth(months, month);
    const name = normalizeLineName(tramo);
    const key = normalizeKey(name);
    if (!key) continue;
    state.hours.add(timestamp);
    const lineRow = ensureLine(state, key, name, tramo);
    lineRow.values.set(timestamp, round3(valueMw));
    parsedRows += 1;
    seenMonths.add(month);
  }

  return { file: path.relative(root, file).replace(/\\/g, "/"), rows, parsedRows, months: [...seenMonths].sort() };
}

function writeMonthlyFlows(months) {
  const written = [];
  for (const [month, state] of [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hours = [...state.hours].sort();
    const lines = [...state.lines.values()]
      .filter((line) => hours.some((hour) => Number.isFinite(Number(line.values.get(hour)))))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const payload = {
      schema: "sen-history-flujos-v2",
      source: "CEN/Qlik Potencia Transitada por Lineas CSV",
      generatedAt: new Date().toISOString(),
      month,
      unit: "MW",
      hours,
      lines: lines.map((line) => ({ name: line.name, key: line.key, aliases: line.aliases })),
      values: lines.map((line) => hours.map((hour) => line.values.has(hour) ? line.values.get(hour) : null)),
    };
    writeJson(path.join(flowsDir, `${month}.json`), payload);
    written.push(month);
  }
  return written;
}

function updateManifest(months) {
  const manifestFile = path.join(historyDir, "manifest.json");
  const manifest = readJson(manifestFile) || { schema: "sen-etl-manifest-v1", generatedAt: "", window: {}, datasets: {} };
  manifest.generatedAt = new Date().toISOString();
  for (const month of months) manifest.datasets.flujos = addMonth(manifest.datasets.flujos, month, `history/flujos/${month}.json`);
  writeJson(manifestFile, manifest);
}

function updateProgress(stats, months) {
  const progressFile = path.join(historyDir, "progress.json");
  const progress = readJson(progressFile) || { schema: "sen-history-progress-v1", runs: [] };
  progress.runs = [{
    generatedAt: new Date().toISOString(),
    id: "potencia-transitada-historica-real-csv",
    ok: months.length > 0,
    files: stats.files,
    rows: stats.rows,
    parsedRows: stats.parsedRows,
    months,
  }, ...(progress.runs || [])].slice(0, 30);
  writeJson(progressFile, progress);
}

function ensureMonth(months, month) {
  if (!months.has(month)) months.set(month, { hours: new Set(), lines: new Map() });
  return months.get(month);
}

function ensureLine(state, key, name, rawName) {
  if (!state.lines.has(key)) state.lines.set(key, { key, name, aliases: aliasKeys([name, rawName]), values: new Map() });
  const line = state.lines.get(key);
  line.aliases = [...new Set([...(line.aliases || []), ...aliasKeys([name, rawName])])];
  return line;
}

function normalizeLineName(value) {
  return cleanText(value).split("/")[0].trim().replace(/\s+/g, " ");
}

function parseTimestamp(value) {
  const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}` : "";
}

function rowObject(header, values) {
  const row = {};
  header.forEach((name, index) => { row[name] = values[index] ?? ""; });
  return row;
}

function readText(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") return cleanText(row[name]);
  }
  return "";
}

function cleanText(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function parseNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return NaN;
  const normalized = text.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ";" && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function aliasKeys(values) {
  return [...new Set(values.flatMap((value) => [cleanText(value), normalizeKey(value)]).filter(Boolean))];
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(kv|linea|tramo|circuito|c)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function addMonth(entry, month, file) {
  const current = entry || { months: [] };
  if (!current.months.some((row) => row.month === month)) current.months.push({ month, file });
  current.months.sort((a, b) => a.month.localeCompare(b.month));
  return current;
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
