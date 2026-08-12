import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = process.cwd();
const sourceDir = path.join(root, "docs", "data", "generacion historica real");
const historyDir = path.join(root, "docs", "data", "history");
const generationDir = path.join(historyDir, "generacion");
const technologyDir = path.join(historyDir, "generacion-tecnologia");

fs.mkdirSync(generationDir, { recursive: true });
fs.mkdirSync(technologyDir, { recursive: true });

const csvFiles = fs.existsSync(sourceDir)
  ? fs.readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith(".csv")).sort()
  : [];

if (!csvFiles.length) {
  console.log(JSON.stringify({ ok: false, error: `No CSV files found in ${sourceDir}` }, null, 2));
  process.exitCode = 1;
} else {
  const months = new Map();
  const years = new Map();
  const stats = { ok: true, files: [], rows: 0, parsedRows: 0, months: new Set(), years: new Set(), bessInjectionRows: 0, bessWithdrawalRows: 0 };

  for (const fileName of csvFiles) {
    const file = path.join(sourceDir, fileName);
    const result = await ingestCsv(file, months, years);
    stats.files.push(result);
    stats.rows += result.rows;
    stats.parsedRows += result.parsedRows;
    result.months.forEach((month) => stats.months.add(month));
    result.years.forEach((year) => stats.years.add(year));
    stats.bessInjectionRows += result.bessInjectionRows;
    stats.bessWithdrawalRows += result.bessWithdrawalRows;
  }

  const writtenMonths = writeMonthlyGeneration(months);
  const writtenYears = writeAnnualTechnology(years);
  updateManifest(writtenMonths, writtenYears);
  updateProgress(stats, writtenMonths, writtenYears);

  console.log(JSON.stringify({
    ok: true,
    files: stats.files,
    rows: stats.rows,
    parsedRows: stats.parsedRows,
    months: writtenMonths,
    years: writtenYears,
    bessInjectionRows: stats.bessInjectionRows,
    bessWithdrawalRows: stats.bessWithdrawalRows,
  }, null, 2));
}

async function ingestCsv(file, months, years) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let rows = 0;
  let parsedRows = 0;
  let bessInjectionRows = 0;
  let bessWithdrawalRows = 0;
  const seenMonths = new Set();
  const seenYears = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = splitCsvLine(line).map((value) => value.trim());
      continue;
    }
    rows += 1;
    const values = splitCsvLine(line);
    if (values.length < 33) continue;

    const row = rowObject(header, values);
    const date = readText(row, ["Fecha"]);
    const central = readText(row, ["Central"]);
    const group = readText(row, ["Grupo reporte"]);
    const llave = readText(row, ["Llave"]);
    const tipo = readText(row, ["Tipo"]);
    const subtipo = readText(row, ["Subtipo"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !central) continue;

    const month = date.slice(0, 7);
    const year = date.slice(0, 4);
    const technology = normalizeTechnology(tipo, subtipo);
    const isWithdrawal = isBessWithdrawal(tipo, subtipo);
    const isInjection = isBessInjection(tipo, subtipo);
    if (isWithdrawal) bessWithdrawalRows += 1;
    if (isInjection) bessInjectionRows += 1;

    const sign = 1;
    const plantKey = normalizeKey(central);
    if (!plantKey) continue;

    const monthState = ensureMonth(months, month);
    const plant = ensurePlant(monthState, plantKey, {
      name: central,
      key: plantKey,
      aliases: aliasKeys([central, group, llave]),
      idCentral: "",
      technology: baseTechnology(tipo),
      subtype: normalizeSubtype(subtipo),
    });

    const yearState = ensureYear(years, year);
    const techKey = technology.key;
    const techRow = ensureTechnology(yearState, month, techKey, technology.label, technology.subtype, technology.sign);

    for (let h = 1; h <= 24; h += 1) {
      const raw = row[`Hora ${h}`];
      const value = parseNumber(raw);
      if (!Number.isFinite(value)) continue;
      const timestamp = `${date} ${String(h - 1).padStart(2, "0")}`;
      monthState.hours.add(timestamp);
      const signed = sign * value;
      plant.values.set(timestamp, round3((plant.values.get(timestamp) || 0) + signed));
      techRow.months.set(month, round3((techRow.months.get(month) || 0) + signed / 1000));
    }

    parsedRows += 1;
    seenMonths.add(month);
    seenYears.add(year);
  }

  return {
    file: path.relative(root, file).replace(/\\/g, "/"),
    rows,
    parsedRows,
    months: [...seenMonths].sort(),
    years: [...seenYears].sort(),
    bessInjectionRows,
    bessWithdrawalRows,
  };
}

function writeMonthlyGeneration(months) {
  const written = [];
  for (const [month, state] of [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hours = [...state.hours].sort();
    const plants = [...state.plants.values()]
      .filter((plant) => hours.some((hour) => Number(plant.values.get(hour)) !== 0))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const payload = {
      schema: "sen-history-generacion-v2",
      source: "CEN/Qlik Descarga Generacion Real CSV",
      generatedAt: new Date().toISOString(),
      month,
      unit: "MWh",
      bessRule: "BESS se publica como central unica neta: Inyeccion suma positiva y Retiro suma negativa segun signo real informado en el CSV.",
      hours,
      plants: plants.map((plant) => ({
        name: plant.name,
        key: plant.key,
        aliases: plant.aliases,
        idCentral: plant.idCentral,
        technology: plant.technology,
        subtype: plant.subtype,
      })),
      values: plants.map((plant) => hours.map((hour) => plant.values.has(hour) ? plant.values.get(hour) : null)),
    };
    writeJson(path.join(generationDir, `${month}.json`), payload);
    written.push(month);
  }
  return written;
}

function writeAnnualTechnology(years) {
  const written = [];
  for (const [year, state] of [...years.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const months = [...state.months].sort();
    const series = [...state.technologies.values()]
      .filter((row) => months.some((month) => Number(row.months.get(month)) !== 0))
      .sort((a, b) => a.label.localeCompare(b.label, "es"))
      .map((row) => ({
        technology: row.label,
        subtype: row.subtype,
        sign: row.sign,
        values: months.map((month) => row.months.has(month) ? round3(row.months.get(month)) : 0),
      }));
    const total = months.map((month) => round3(series.reduce((sum, row) => sum + (Number(row.values[months.indexOf(month)]) || 0), 0)));
    const payload = {
      schema: "sen-history-generacion-tecnologia-v1",
      source: "CEN/Qlik Descarga Generacion Real CSV",
      generatedAt: new Date().toISOString(),
      year,
      granularity: "monthly",
      unit: "GWh",
      signed: true,
      bessRule: "BESS queda como una sola serie neta; Inyeccion y Retiro se integran conservando el signo real informado en el CSV.",
      hours: months,
      series,
      total,
    };
    writeJson(path.join(technologyDir, `${year}.json`), payload);
    written.push(year);
  }
  return written;
}

function updateManifest(months, years) {
  const manifestFile = path.join(historyDir, "manifest.json");
  const manifest = readJson(manifestFile) || { schema: "sen-etl-manifest-v1", generatedAt: "", window: {}, datasets: {} };
  manifest.generatedAt = new Date().toISOString();
  for (const month of months) manifest.datasets.generacion = addMonth(manifest.datasets.generacion, month, `history/generacion/${month}.json`);
  const entry = manifest.datasets["generacion-tecnologia"] || { years: [] };
  for (const year of years) {
    if (!entry.years.some((row) => row.year === year)) entry.years.push({ year, file: `history/generacion-tecnologia/${year}.json` });
  }
  entry.years.sort((a, b) => a.year.localeCompare(b.year));
  manifest.datasets["generacion-tecnologia"] = entry;
  writeJson(manifestFile, manifest);
}

function updateProgress(stats, months, years) {
  const progressFile = path.join(historyDir, "progress.json");
  const progress = readJson(progressFile) || { schema: "sen-history-progress-v1", runs: [] };
  progress.runs = [{
    generatedAt: new Date().toISOString(),
    id: "generacion-historica-real-csv",
    ok: months.length > 0,
    files: stats.files,
    rows: stats.rows,
    parsedRows: stats.parsedRows,
    months,
    years,
    bessInjectionRows: stats.bessInjectionRows,
    bessWithdrawalRows: stats.bessWithdrawalRows,
  }, ...(progress.runs || [])].slice(0, 30);
  writeJson(progressFile, progress);
}

function ensureMonth(months, month) {
  if (!months.has(month)) months.set(month, { hours: new Set(), plants: new Map() });
  return months.get(month);
}

function ensurePlant(state, key, data) {
  if (!state.plants.has(key)) state.plants.set(key, { ...data, values: new Map() });
  const plant = state.plants.get(key);
  plant.aliases = [...new Set([...(plant.aliases || []), ...(data.aliases || [])])];
  if (!plant.technology && data.technology) plant.technology = data.technology;
  if (!plant.subtype && data.subtype) plant.subtype = data.subtype;
  return plant;
}

function ensureYear(years, year) {
  if (!years.has(year)) years.set(year, { months: new Set(), technologies: new Map() });
  return years.get(year);
}

function ensureTechnology(state, month, key, label, subtype, sign) {
  state.months.add(month);
  if (!state.technologies.has(key)) state.technologies.set(key, { key, label, subtype, sign, months: new Map() });
  return state.technologies.get(key);
}

function normalizeTechnology(tipo, subtipo) {
  const base = baseTechnology(tipo);
  const sub = normalizeSubtype(subtipo);
  if (normalizeKey(base).includes("bess")) return { key: "bess", label: "BESS", subtype: sub, sign: 1 };
  return { key: normalizeKey(base), label: base || "Sin clasificar", subtype: sub, sign: 1 };
}

function baseTechnology(value) {
  const text = cleanText(value);
  if (!text || text === "-") return "Sin clasificar";
  const key = normalizedText(text);
  if (key.includes("eolica")) return "Eólica";
  if (key.includes("hidroelectrica") || key.includes("hidraulica")) return "Hidráulica";
  if (key.includes("termoelectrica") || key.includes("termica")) return "Térmica";
  if (key.includes("geoterm")) return "Geotermia";
  if (key.includes("solar")) return "Solar";
  if (key.includes("bess")) return "BESS";
  if (key.includes("biomasa")) return "Biomasa";
  if (key.includes("biogas")) return "Biogás";
  return text;
}

function normalizeSubtype(value) {
  const key = normalizedText(value);
  if (key.includes("retiro")) return "Retiro";
  if (key.includes("inyecci")) return "Inyeccion";
  return cleanText(value);
}

function isBessWithdrawal(tipo, subtipo) {
  return normalizeKey(tipo).includes("bess") && isWithdrawalSubtype(subtipo);
}

function isBessInjection(tipo, subtipo) {
  return normalizeKey(tipo).includes("bess") && isInjectionSubtype(subtipo);
}

function isWithdrawalSubtype(value) {
  return normalizedText(value).includes("retiro");
}

function isInjectionSubtype(value) {
  return normalizedText(value).includes("inyecci");
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
    .replace(/\b(inyeccion|retiro)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
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
