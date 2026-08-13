# Contrato del Proyecto: Mapa SEN con Lupa Operacional

## Proposito

Construir una pagina web estatica y liviana para explorar el Sistema Electrico Nacional de Chile con datos reales del Coordinador Electrico Nacional (CEN). La pagina debe separar claramente topologia, generacion, costos marginales y transmision, manteniendo el diseno actual y evitando mezclar indicadores sin contexto.

Regla principal: no se muestran datos simulados. Si CEN/API/descargables oficiales no entregan una informacion, la UI debe mostrar exactamente `En Desarrollo`.

## URL y Deploy

- Repositorio: `https://github.com/cristobalreyesmo-oss/mapa-sen-lupa`
- Sitio: `https://cristobalreyesmo-oss.github.io/mapa-sen-lupa/`
- HTML publicado unico: `docs/index.html`
- `docs/indexv2.html` fue eliminado por redundante.
- `docs/index2.html`: variante A/B "ultimo dia" (misma plantilla con flag `lastDay`), generada por `build-static-map-v2.mjs`; cada seccion se auto-limita a su ultimo dia con datos para comparar rendimiento/simplicidad contra `index.html`. Ambos conviven en `main` hasta decidir el ganador.
- GitHub Pages: branch `main`, carpeta `/docs` (build automatico en cada push; no hay workflow de deploy propio).

### Comando de deploy (desde `C:\Visual SEN`)

```bash
npm run static:build:v2      # regenera docs/index.html + docs/data/sen-data.json
```

El repo remoto se actualiza clonando en temporal, copiando `docs/` (build v2) y `contrato.md`, y haciendo commit + push a `main`:

```bash
gh repo clone cristobalreyesmo-oss/mapa-sen-lupa $env:TEMP\sen-deploy
# copiar docs/ y contrato.md desde el workspace al clone
cd $env:TEMP\sen-deploy
git add -A && git commit -m "Desplegar build v2"
git push origin main
```

Nota: `C:\Visual SEN` no es repo git; el control de versiones vive solo en GitHub. Los workflows `update-cen-data.yml` y `backfill-cen-history.yml` hacen commit directo desde el runner de Actions.

## Principios de Diseno

- Mantener la estructura visual actual: Grid Standard / Swiss Design + Apple Liquid Glass solo en controles flotantes.
- Mantener MapLibre GL JS, Turf.js y ECharts lazy.
- Mantener mapas grandes, panel lateral compacto y comportamiento responsive movil en una sola pagina.
- El mapa debe venir centrado en el SEN por defecto. El boton `Centrar en SEN` puede mantenerse como accion de recuperacion, pero no debe ser necesario para iniciar el analisis.
- Reemplazar filtros sueltos de `HORA` por controles de `FECHA DE ANALISIS` con rango `DESDE`/`HASTA` en formato calendario nativo (`type="date"`) y, cuando corresponda, ventana temporal. La hora solo debe existir si es necesaria dentro de una fecha/ventana seleccionada.
- El rango `DESDE`/`HASTA` aplica a todos los datasets historicos bajo demanda: se cargan todos los meses del rango y se fusionan en una ventana continua; los mapas y KPIs que muestran un snapshot usan la fecha `HASTA` como fecha de analisis.
- KISS: primero estructura clara y datos compactos; evitar llamadas CEN desde navegador; evitar graficos pesados al inicio; cargar historicos solo bajo demanda.

## Reglas de Datos Reales

- El navegador consume JSON estaticos bajo `docs/data/`; no llama APIs CEN ni Qlik directamente.
- Las credenciales nunca se escriben en codigo ni repo. Deben venir desde GitHub Secrets o variables de entorno.
- No interpolar, no rellenar horas faltantes, no inventar centrales, nodos, flujos, CMg, capacidades instaladas ni capacidades de transporte.
- Si una actualizacion falla (`429`, `404`, timeout, `502`) y existe ultimo dato real bueno, se conserva como `stale: true` y se rotula `ultimo dato real disponible`.
- Cada dataset debe conservar trazabilidad: fuente, fecha/rango, formato original y timestamp de actualizacion.
- La capacidad instalada de centrales/BESS solo se muestra si existe fuente real CEN/catalogo oficial. Si falta, usar `En Desarrollo`.
- La capacidad de transporte de lineas a `35°C` se toma desde `public/linea-limites.json`, campo `c35` o `limit` cuando `primaryRating` sea `c35`.
- El nivel de tension de lineas y subestaciones/nodos debe venir del modelo, nombre/carpeta o dataset real. Si no se puede determinar de forma trazable, usar `En Desarrollo`.

## Reglas Visuales Transversales

- Debe existir una paleta unica por tecnologia para centrales/BESS en toda la pagina.
- Debe existir una paleta unica por nivel de tension para lineas y nodos/subestaciones en toda la pagina.
- La leyenda de tecnologias debe ser transversal y reutilizable en Overview, Generacion, Costos Marginales y Transmision cuando la seccion muestre o referencie tecnologias.
- La leyenda de tension debe ser transversal y reutilizable en todas las secciones que muestren lineas o nodos/subestaciones.
- No cambiar colores por seccion para la misma tecnologia o tension.
- Si una seccion colorea por una metrica operacional adicional, como cargabilidad, debe conservar una referencia clara al nivel de tension y no romper la lectura transversal.

## Fuentes CEN Prioritarias

### CMg

- Fuente objetivo para version definitiva: descargables oficiales desde `https://www.coordinador.cl/costos-marginales/`, version definitiva.
- API SIP sigue como respaldo operativo cuando entregue datos:
  - `GET /costo-marginal-real/v4/findByDate`, `type=DEFINITIVO`.
  - `GET /costo-marginal-online/v4/findByDate` como respaldo real, no definitivo.

### Generacion

- Fuente objetivo: API CEN `generacion-real` via backfill (`scripts/backfill-cen-history.mjs`), con retencion de ultimos 12 meses.
- Descargables oficiales CEN/Qlik de `Generacion Real` como respaldo:
  - ERNC horaria por central.
  - Generacion real mensual por tecnologia.
  - Generacion real horaria por tecnologia.
  - Generacion real por tecnologia.
  - Generacion real horaria por central.
  - Descarga de datos de generacion real.
- Formato ETL recomendado: CSV primero, TSV como fallback, Excel solo como ultimo recurso.

### Transmision

- Fuente objetivo: descargables oficiales CEN/Qlik de `Potencia Transitada por el Sistema de Transmision`.
- Mantener limites fisicos reales desde `public/linea-limites.json`, derivados del reporte CEN de secciones/tramos.
- Formato ETL recomendado: CSV primero, TSV como fallback, Excel solo como ultimo recurso.

## ETL KISS Objetivo

- Descargar datos oficiales fuera del navegador mediante GitHub Actions.
- Normalizar a estructuras compactas mensuales.
- Publicar solo JSON compacto necesario para la UI.
- No guardar archivos brutos grandes salvo diagnostico puntual.
- Mantener `progress.json` con corridas, fuente, filas, errores y rango.

Estructura objetivo:

```text
docs/data/live/status.json
docs/data/live/cmg-current.json
docs/data/live/demanda-current.json
docs/data/live/generacion-current.json
docs/data/live/flujos-current.json
docs/data/history/manifest.json
docs/data/history/progress.json
docs/data/history/cmg/YYYY-MM.json
docs/data/history/generacion/YYYY-MM.json
docs/data/history/generacion-tecnologia/YYYY.json
docs/data/history/flujos/YYYY-MM.json
```

Importadores locales para descargables reales CEN/Qlik:
- `scripts/import-generacion-historica-real.mjs`: lee CSV ancho diario de generacion real desde `docs/data/generacion historica real/`, publica historico horario mensual por central y agregado mensual anual por tecnologia. Para BESS, la columna `Subtipo` se usa solo para interpretar/validar inyeccion y retiro, pero la BESS debe quedar como una misma central/tecnologia neta; se conserva el signo real informado en el CSV.
- `scripts/import-potencia-transitada-historica-real.mjs`: lee CSV historico de potencia transitada desde `docs/data/potencia transitada por lineas historico real/`, publica historico horario mensual de flujos por tramo/linea.

Datos historicos reales publicados actualmente:
- Generacion real por central: `docs/data/history/generacion/` desde backfill API CEN, retencion ultimos 12 meses.
- Generacion real por tecnologia/subtipo: `docs/data/history/generacion-tecnologia/2026.json`.
- Potencia transitada por linea: `docs/data/history/flujos/` solo la ultima semana (se prunan los meses anteriores para mantener la pagina liviana).
- CMg compacto: `docs/data/history/cmg/` con jun-jul-ago 2026 (ultimos 3 meses de retencion, dato DEFINITIVO via backfill API CEN). Agosto parcial (hasta 2026-08-12).

Regla de retencion de historico: para mantener el despliegue liviano, CMg conserva los ultimos 3 meses con dato DEFINITIVO disponible, generacion los ultimos 12 meses desde la API CEN y flujos solo la ultima semana. El backfill y los importadores deben prunar archivos fuera de estas ventanas. Ajustar al hacer backfill nuevo.

## Estructura Objetivo de la Pagina

### Overview

Rol: topologia general del SEN, no analisis operacional detallado.

Debe mostrar:
- Cantidad de centrales presentes en el modelo SEN.
- Cantidad de nodos/subestaciones presentes en el modelo SEN.
- Cantidad de lineas por nivel de tension.
- Mapa topologico centrado en el SEN.
- Lineas coloreadas por nivel de tension.
- Centrales coloreadas por tecnologia.
- Nodos/subestaciones visibles.
- Cross-filtering por nivel de tension de lineas.
- Cross-filtering por tipo de tecnologia de centrales.
- Leyenda transversal de tecnologias y tension.
- Contador al filtrar tecnologia: centrales/BESS visibles y total del sistema.
- Popup de central/BESS: tecnologia, capacidad instalada MW si existe fuente real, y coordenadas.
- Popup de linea: nivel de tension, longitud aproximada y capacidad de transporte a `35°C` desde `linea-limites.json`.
- Popup de subestacion/nodo: nivel de tension y coordenadas.

No debe priorizar:
- CMg promedio como KPI principal.
- Demanda/frecuencia si no hay dato real integrado y trazable.
- Graficos horarios operacionales que pertenecen a Generacion, CMg o Transmision.

### Generacion

Rol: analisis historico real de generacion y captura de precios por generador/nodo.

Orden de la seccion (parte superior):
- Bloque "Filtro de Centrales" PRIMERO (arriba de todo), con seleccion de tecnologias, busqueda de central y seleccionar/limpiar/reset. Aplica al mapa de generacion por nodo, al ranking y a los popups.
- Luego el bloque "Generacion por Tecnologia", con datos mensuales reales de los 12 meses del ano (`generacion-tecnologia/YYYY.json`), grafico apilado mensual, participacion por tecnologia y KPIs del periodo mensual (Energia del periodo, Mes Pico, Tecnologia Dominante, Fuentes con Datos).
- El bloque de tecnologia NO usa selector de dias ni etiquetas horarias: es historico mensual real.
- No existen KPIs de "Generacion 24 h", "Pico 24 h" ni "CMg Promedio" globales al inicio de la seccion; fueron eliminados.
- Luego el mapa de generacion por nodo (filtros de tecnologia, central, tension y nodo).
- Al final "Top Centrales en Generacion" (ranking de centrales por MWh en la fecha de analisis).

Rendimiento del filtro:
- Al pinchar una tecnologia o un checkbox de central, la UI no debe congelarse. `compactSeriesForFeature` (matching nombre central/serie) esta memoizado por objeto `data` (WeakMap): el match se calcula una vez por central y se reutiliza en el render del mapa, ranking y filtros, eliminando el escaneo O(n²) de `matchScore`/`normalizeKey` por clic.

Mapa y filtros:
- Mapa con centrales, nodos/subestaciones y lineas del sistema.
- Lineas coloreadas por nivel de tension y filtrables por tension.
- Centrales coloreadas por tecnologia y filtrables por tecnologia.
- Los colores de tecnologia y tension deben ser exactamente los mismos que en Overview.
- Filtro de ventana temporal, con maximo historico recomendado de 1 ano por consulta visual. Este maximo puede discutirse, pero la implementacion debe evitar cargar mas de lo necesario.
- Filtro de central/generador.
- Filtro de nodo/subestacion para obtener curva CMg de la fecha o ventana filtrada.
- Popup de central/BESS: generacion real del rango, capacidad instalada MW si existe fuente real, tecnologia y CMg promedio del rango temporal seleccionado.
- Popup de linea: nivel de tension y capacidad de transporte a `35°C`.
- Popup de nodo/subestacion: nivel de tension y CMg del rango/fecha cuando exista.

Graficos de analisis:
- El bloque superior de Generacion debe preferir `docs/data/history/generacion-tecnologia/YYYY.json` por ser liviano y anualizado.
- Para la misma fecha/ventana seleccionada, mostrar generacion real y CMg en el mismo grafico cuando ambos existan.
- El cruce debe ser por timestamp real, no por posicion de array.
- Cross-filtering: seleccionar central, tecnologia, nodo o tension debe actualizar los graficos relacionados sin recargar toda la pagina.
- Si falta generacion o CMg real para el cruce, mostrar `En Desarrollo` para la serie faltante.
- BESS no debe mostrarse como dos tecnologias separadas. Debe ser una sola serie/central neta `BESS`, donde la inyeccion aparece positiva y el retiro aparece negativo segun el signo real informado por CEN/Qlik.
- Para rendimiento, la UI no debe cargar generacion mensual pesada ni flujos historicos al iniciar. Debe cargar solo el historico necesario para la seccion activa: CMg en Costos Marginales, generacion en Generacion, flujos en Transmision, y `generacion-tecnologia/YYYY.json` como agregado liviano.

### Costos Marginales

Rol: analisis de CMg por nodo/barra.

Debe mostrar:
- Mapa de nodos/subestaciones con CMg.
- No mostrar centrales en esta seccion.
- Lineas pueden mantenerse como contexto topologico si ayudan a ubicacion, coloreadas por nivel de tension.
- Nodos/subestaciones deben usar color por nivel de tension como base visual, y el valor CMg debe mostrarse en popup/tabla/curva sin romper la paleta transversal.
- Filtro de fecha de analisis.
- Filtro de nodo/subestacion.
- Cross-filtering nodo-fecha: seleccionar nodo actualiza curva CMg para la fecha/ventana filtrada.
- Fuente preferente: CMg definitivo descargado desde `https://www.coordinador.cl/costos-marginales/`.
- Popup de nodo/subestacion: nivel de tension, CMg de la fecha/rango y trazabilidad del dato.
- Mantener leyenda transversal de tecnologias y tension; si no hay centrales visibles, la leyenda tecnologica debe quedar como referencia global, no como capa activa.

### Transmision

Rol: flujos, cargabilidad y congestion de transmision.

Debe mostrar:
- Lineas y nodos/subestaciones.
- No mostrar centrales.
- Lineas coloreadas por nivel de tension como regla base transversal.
- Cargabilidad se muestra como metrica operacional adicional cuando exista potencia transitada real, sin perder referencia de tension.
- Filtro por nivel de tension.
- Filtro por fecha/ventana temporal.
- Filtro por linea.
- Ranking de mayor cargabilidad.
- Detalle de linea: flujo, capacidad de transporte a `35°C`, porcentaje de cargabilidad y estado.
- Popup de linea: nivel de tension, longitud aproximada, capacidad de transporte a `35°C`, flujo real cuando exista y cargabilidad.
- Para fecha de analisis dentro de la ultima semana, la vista debe preferir `docs/data/history/flujos/YYYY-MM.json` antes que datos live; fuera de esa ventana no hay historico (retencion ultima semana) y se muestra `En Desarrollo` o el dato live disponible.
- La seccion Transmision debe indicar SIEMPRE cuales son las fechas disponibles: el rotulo `flow-date` del header muestra "Fechas disponibles: {min} → {max}" derivado de las horas de flujos historicos cargados (`manifest.json` lista los meses existentes; se cargan al entrar a la vista), junto al contexto de la fecha de analisis (`N h` historicas), la ventana CEN live o `En Desarrollo` si no hay dato. Los inputs `DESDE`/`HASTA` de flujos se restringen a ese rango disponible.

Mantener:
- Concepto actual de cargabilidad: `flujo / limite`.
- Umbrales de congestion:
  - `> 90%` critico.
  - `> 70%` alto.
  - `> 50%` medio.
  - resto normal.

## Cross-Filtering

- Debe existir un estado centralizado simple por seccion.
- Overview: filtros de tension y tecnologia afectan solo el mapa/topologia/KPIs de conteo.
- Generacion: filtros de fecha/ventana, tecnologia, central, tension y nodo actualizan mapa y graficos de generacion-CMg.
- Costos Marginales: filtros de fecha y nodo actualizan mapa, tabla y curva CMg.
- Transmision: filtros de fecha/ventana, tension y linea actualizan mapa, ranking y detalle.
- No usar cross-filtering global entre secciones salvo que sea explicitamente requerido.

## Build y Archivos

- Plantilla activa local: `work/static-map-layout-v2.mjs`.
- HTML publicado: `docs/index.html`.
- Builder principal: `work/build-static-map.mjs`.
- Builder alias: `work/build-static-map-v2.mjs`, tambien escribe solo `docs/index.html`.
- `docs/.nojekyll` debe existir.
- MapLibre, Turf y ECharts se sirven desde `docs/vendor/`.
- `sen-data.json` (modelo KMZ) NO va inline en el HTML: el builder lo publica en `docs/data/sen-data.json` y el navegador lo descarga con `fetch` async para no bloquear el primer render. Mantener el HTML publicado por debajo de ~300 KB.

Comandos utiles:

```bash
npm run static:build
npm run static:build:v2
node --check scripts/fetch-cen-data.mjs
node --check scripts/build-cen-etl.mjs
node --check scripts/backfill-cen-history.mjs
node --check scripts/import-generacion-historica-real.mjs
node --check scripts/import-potencia-transitada-historica-real.mjs
```

Nota: `npm test` puede fallar localmente si falta `vinext`.

## Workflows

- `.github/workflows/update-cen-data.yml`: actualiza live + ETL compacto.
- `.github/workflows/backfill-cen-history.yml`: backfill historico manual por chunks.
- Futuros workflows Qlik/descargables deben operar igual: descargar fuera del navegador, normalizar, compactar, commitear datos livianos.

## Estado Actual

- `docs/index.html` es unico HTML publicado.
- La UI ya fue reorganizada inicialmente por secciones: Overview topologico, Generacion, Costos Marginales y Transmision.
- Los filtros de fecha son rango `DESDE`/`HASTA` con calendario nativo en las 4 secciones; cargan todos los meses del rango y fusionan horas/valores en `mergedHistoryFor(dataset)`.
- BESS se muestra como tecnologia unica neta (no como subtipo Inyeccion/Retiro); el retiro se visualiza como generacion negativa (barras bajo cero) en el grafico de generacion. Los datos ya estan netos: `generacion-tecnologia/YYYY.json` tiene una sola serie BESS con signo real (ej. -30.923 GWh en 2026-01).
- `sen-data.json` se publica en `docs/data/sen-data.json` y se carga async; `docs/index.html` paso de ~1.4 MB a ~0.24 MB.
- `fetchJson` usa `fetch(path)` sin `cache: no-store`: el navegador respeta el `max-age=600` + ETag que GitHub Pages sirve, cacheando `sen-data.json` y `history/*.json` entre visitas.
- Desplegado en GitHub Pages: build v2 en `main`/`docs` (HTML ~255 KB + `sen-data.json` externo).
- Historico CMg compacto para mayo, junio y julio 2026 (ultimos 3 meses con dato DEFINITIVO; agosto aun sin publicar por CEN).
- Generacion historica real 2026-01 a 2026-08 importada desde CSVs hacia `docs/data/history/generacion/` y `docs/data/history/generacion-tecnologia/`; desde ahora la fuente preferente es backfill API CEN con retencion de 12 meses. BESS esta modelada como serie neta unica, no separada en Inyeccion/Retiro.
- Potencia transitada historica real enero-junio 2026 importada desde CSVs hacia `docs/data/history/flujos/`; la retencion actual conserva solo la ultima semana (se prunaron los meses anteriores).
- `mergedHistoryFor(dataset)` fue optimizado de O(n²) a O(n) usando Maps de indices, reduciendo el costo de fusionar multiples meses (generacion ~1187 centrales x ~744 h x N meses).
- La seccion Generacion fue reordenada segun el contrato: el bloque "Generacion por Tecnologia" (mensual real, 12 meses) quedo arriba, se eliminaron los KPIs globales de "Generacion 24 h", "Pico 24 h" y "CMg Promedio", y el bloque se desacoplo del selector de dias (sin etiquetas horarias). `generationTechnologyDataset()` ya no filtra por mes de analisis: muestra el ano completo.
- La seccion Transmision indica SIEMPRE las fechas disponibles en `flow-date` ("Fechas disponibles: min → max"), cargando los meses de flujos listados en `manifest.json` al entrar a la vista y restringiendo los inputs `DESDE`/`HASTA` al rango disponible (ultima semana).
- Fechas disponibles reales por seccion (agosto 2026): Generacion por Tecnologia 2026-01 a 2026-08 (mensual); Generacion por Nodo 2026-01-01 a 2026-08-12 (horaria, junio cortado al 18 y agosto al 12); Transmision/Flujos solo 2026-06-19 a 2026-06-25 (una semana); CMg historico 2026-06-01 a 2026-08-12 (jun-jul casi completos, agosto parcial) + ventana live del cron (~7 dias). No existe un dia comun entre secciones.
- Estado CMg: disponible desde el workflow programado `update-cen-data.yml` (cron cada 15 min, usa `CEN_API_KEY`/`CEN_OPERACION_USER_KEY` de GitHub Secrets). Ya genera `docs/data/live/cmg-current.json` (ok, barras reales, ventana ~7 dias, `stale: true` cuando la API no actualiza). Historico completo: backfill manual `backfill-cen-history.yml` con `CEN_BACKFILL_DATASETS=cmg-real,cmg-online`, `limit=2000`, `max_pages=50` (un dia de CMg = ~72k filas: 2993 nodos x 24 h; `limit=500,max_pages=20` solo cubria ~2 dias/mes). Retencion de 3 meses. Ojo: si el commit del runner falla por `non-fast-forward` (el cron adelanto `main`), el workflow ya hace `git pull --rebase -X theirs` antes del push para sobrevivir; y `build-cen-etl.mjs` ahora lee/mergea el manifest existente para no borrar los meses historicos que el backfill agrega. Corridas locales sin la variable `CEN_API_KEY` devuelven `403 Forbidden Authentication parameters missing`.
- Variante `docs/index2.html` (A/B "ultimo dia"): misma plantilla con flag `lastDay`; al entrar a cada seccion fija `DESDE`/`HASTA` al ultimo dia con datos de ese dataset (gen→2026-08-12, flujos→2026-06-25, cmg→ultimo disponible) y carga solo el ultimo mes. Permite comparar el lag del filtro y la carga contra `index.html` (que mantiene el rango completo).
- `compactSeriesForFeature` memoizado con WeakMap keyed por `data`: elimina el O(n²) del matching de nombres en cada clic de filtro de Generacion (se escaneaban las ~200 centrales por cada central renderizada, con regex de normalizacion). Aplica a index e index2.
- Cuando un dato no existe, la UI muestra exactamente `En Desarrollo` (constante `CEN_NOT_INFORMED`), reemplazando el texto anterior "CEN no ha informado esta informacion".
- La carpeta de potencia transitada contiene CSV real aunque originalmente se esperaba XLSX; mantener CSV como fuente preferente KISS cuando este disponible.
- Se identificaron fuentes oficiales alternativas:
  - CMg definitivo desde `https://www.coordinador.cl/costos-marginales/`.
  - Generacion real desde pagina CEN/Qlik de generacion real.
  - Potencia transitada desde pagina CEN/Qlik de potencia transitada.

## Proximo Orden de Trabajo

1. Validar en navegador los filtros `DESDE`/`HASTA` multi-mes y el merge continuo (flujos ultima semana y generacion ultimos 12 meses desde API).
2. Validar en navegador el cruce central-generacion-CMg para fechas con historico real mensual.
3. Mejorar matching de nombres entre lineas del modelo SEN y tramos Qlik si hay lineas sin emparejar.
4. Incorporar CMg definitivo descargable desde `https://www.coordinador.cl/costos-marginales/` para reemplazar/fortalecer el respaldo API.
5. Automatizar importadores de descargables reales cuando exista una ruta estable y liviana, manteniendo JSON compactos.
6. Buscar fuente real de capacidad instalada de centrales/BESS; hasta entonces mostrar `En Desarrollo`.
7. Completar backfill de generacion real desde API CEN para cubrir la ventana de 12 meses (2025-09 a 2026-08).
8. ~~Backfill CMg via GitHub Actions~~ HECHO: `backfill-cen-history.yml` con `cmg-real,cmg-online`, `limit=2000`, `max_pages=50` cubrio jun-ago 2026 (retrocompatible con el cron de `update-cen-data.yml` cada 15 min, que ya publica el live). Workflow con rebase automatico; `build-cen-etl.mjs` mergea el manifest.
9. ~~Reordenar Generacion y memoizar~~ HECHO: filtro arriba + `compactSeriesForFeature` memoizado con WeakMap.
10. ~~Generar `docs/index2.html`~~ HECHO: variante A/B `lastDay` desplegada; decidir ganador con mediciones en navegador.
