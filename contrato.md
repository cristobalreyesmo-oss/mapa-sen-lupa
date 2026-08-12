# Contexto del Proyecto: Mapa SEN con Lupa Operacional

## Proposito

Este proyecto construye una visualizacion web interactiva del Sistema Electrico Nacional de Chile, inspirada en visualizaciones exploratorias tipo Visquill. La idea es tener un mapa operacional con lupa espacial, capaz de mostrar infraestructura del SEN y superponer metricas relevantes como costo marginal, congestion, vertimientos e hidrologia.

La primera version publicada se enfoca en:

- Ubicacion geografica de activos del SEN desde KMZ.
- Mapa mundial con MapLibre GL JS (basemap claro CARTO light_all).
- Analisis espacial client-side con Turf.js.
- Publicacion estatica gratuita en GitHub Pages.
- Actualizacion automatica de datos CEN mediante GitHub Actions.
- Integracion inicial de CMg online desde la API SIP del Coordinador Electrico Nacional.

## URL del proyecto

Repositorio GitHub:

```text
https://github.com/cristobalreyesmo-oss/mapa-sen-lupa
```

Sitio publicado:

```text
https://cristobalreyesmo-oss.github.io/mapa-sen-lupa/
```

Si el navegador muestra una version antigua, abrir con cache-bust:

```text
https://cristobalreyesmo-oss.github.io/mapa-sen-lupa/?v=latest
```

## Carpeta local principal

El proyecto local esta en:

```text
C:\Users\efern\Documents\Codex\2026-07-17\quier
```

Y el clon de trabajo usado durante desarrollo:

```text
C:\Visual SEN
```

## Diseno visual: Grid Standard (Swiss Design) + Apple Liquid Glass

El panel parte de la carpeta de diseno `stitch_swiss_national_energy_panel/grid_standard` (DESIGN.md):

- Tema claro: superficie `#f9f9ff`, on-surface `#151c27`, primario Electric Blue `#003ec7`.
- Tipografia Inter + JetBrains Mono (datos numericos).
- Esquinas rectas, bordes de 1px, sin sombras, cuadricula de 12 columnas.
- Referencias de layout: `stitch_swiss_national_energy_panel/panel_general_sistema_el_ctrico` y `costos_marginales_en_tiempo_real`.

Sobre esa base se inyecto una capa de diseno **Apple Liquid Glass** que anula el diseno por defecto solo en la capa de controles flotantes:

- **El vidrio es solo para controles flotantes**: barras de navegacion (top y side), pestanas, botones, popups, controles del mapa y el modal de filtro. El contenido (tarjetas, tablas, canvas, mapa) permanece opaco. Nunca el contenido es vidrio.
- **Material que lentea lo que hay debajo**: aproximacion web con `backdrop-filter: blur(22px) saturate(180%)` (con prefijo `-webkit-`), brillos internos por capas (inset highlights superior/inferior) y sombra suave. No es frost plano.
- **Capsulas con radios concentricos**: controles con `border-radius: 999px`; panel del modal con radio grande (28px); la barra superior es una capsula flotante (`sticky`) que desenfoca el contenido al hacer scroll.
- **Los controles adaptan su tinte** para seguir legibles sobre cualquier region (tintes semitransparentes + fallback opaco para navegadores sin `backdrop-filter`).
- **Estados de foco visibles**: `:focus-visible` con outline `#003ec7`.
- **Accesibilidad**: se respeta `prefers-reduced-transparency` (fondo casi opaco, sin blur) y `prefers-reduced-motion` (transiciones minimas, barras pasan a posicion estatica).

La clase base es `.glass`; los controles pequenos usan `.glass-ctrl` (capsula) y el boton primario del modal `.glass-primary`. Las reglas viven en un bloque `<style>` propio dentro de `work/static-map-layout-v2.mjs`.

## Funcionalidades actuales

- Vista mundial con basemap claro; vista inicial `center [0,20]`, `zoom 1.2`, `minZoom 1`.
- Solo nodos y lineas modeladas: por defecto visibles Subestaciones + Lineas de Transmision (500/220/154 kV); Centrales y BESS desactivados (con toggles).
- Click en un nodo: abre un **popup de vidrio** con el CMg del nodo si CEN lo informa y ademas fija el perfil CMg horario en el panel lateral cuando existe historia API real. Si no hay dato API, muestra `CEN no ha informado esta información`.
- Click en una linea de transmision: abre un **popup de vidrio** con nombre, tension (kV) y longitud aproximada en km (calculada con Turf sobre los vertices).
- **Hover sobre una linea de transmision**: se despliega al vuelo (sin click) un popup de vidrio con nombre, tension (kV), km aprox. y, si hay flujo modelado, flujo / limite (MW) y cargabilidad (%); tambien actualiza el readout de la lupa. Disponible en las 4 vistas (Overview, Costos Marginales, Transmision y Generacion por Nodo).
- **Filtro de lineas por nivel de tension (kV)**: en cada vista hay toggles 500 / 220 / 154 kV que muestran u ocultan las lineas de ese nivel (independiente del toggle general de Transmision). En Transmision, las capas de linea pasaron a ser por voltaje para soportar el filtro.
- **Grafico CMg de linea con crosshair**: el perfil CMg horario (Overview y Costos Marginales) es un **grafico de linea** (con area rellena y puntos por hora) en lugar de barras; al pasar el cursor sobre el canvas aparece una linea punteada vertical y se resalta el punto y el valor de la hora bajo el cursor. Cuando `cmg-online-latest.json` incluye historia, el eje usa las **ultimas 24 h publicadas reales** con fecha/hora UTC (pueden cruzar dos dias); no se asume 00-23 de un mismo dia. En la vista Generacion por Nodo el grafico ECharts de doble eje ya es de linea.
- **Perfil CMg sigue al cursor del mapa**: al pasar el cursor sobre el mapa, el perfil del panel lateral se actualiza con el nodo mas cercano bajo el cursor (no solo al hacer click); al salir del mapa vuelve al nodo seleccionado (o al placeholder si no hay seleccion). Aplica a Overview, Costos Marginales y Generacion por Nodo.
- **Layout operacional optimizado**: las vistas con mapa usan una grilla comun `ops-map-grid` (mapa dominante + panel lateral compacto), menor margen/gutter, contenedor maximo mas ancho y alturas de mapa consistentes (`clamp(520px, calc(100vh - 300px), 780px)`) para reducir espacios perdidos entre secciones.
- **Resolucion visual del mapa**: MapLibre se inicializa con `pixelRatio` acotado a retina, hace `resize()` al cargar, al cambiar de seccion y al redimensionar la ventana; las lineas tienen `line-cap`/`line-join` redondeados y los nodos tienen radios/strokes levemente mayores para mejorar lectura.
- **Seleccion de lineas mejorada**: las lineas visuales conservan su grosor, pero cada voltaje tiene una capa invisible de hit-testing (`sen-lines-hit-500/220/154`) con ancho ampliado (mas ancho en touch/mobile). Hover, click y popup de linea usan esas hitboxes, lo que facilita seleccionar lineas en Overview, Generacion, Costos Marginales y Transmision sin alterar el mapa visual.
- **Responsive movil (misma pagina, sin segunda version)**: bajo `max-width: 767px` el panel se adapta a 360-430 px con header compacto, bottom nav movil, mapas de al menos 440 px de alto, `ops-map-grid` en una columna (panel de lectura debajo del mapa), controles/toggles en chips envolventes, selector de hora con target tactil, lupa operacional compacta, popups clampados dentro del mapa, radios de nodos aumentados para dedo y `overflow-x: hidden` para evitar scroll horizontal. El comportamiento desktop queda fuera de estas media queries.
- **Vista Transmision (flujos y congestion)**: mapa de lineas coloreadas por cargabilidad frente a su limite fisico (MW), con filtro por linea y detalle de flujo/limite/estado.
- Lupa operacional (radio 34 km) con Turf.js sobre todos los mapas.
- Nodos coloreados por CMg con escala suiza: azul (bajo) / negro (medio) / rojo (alto).
- Boton "Centrar en SEN" para volar a Chile.
- KPI Overview: Demanda en tiempo real (MW), CMg promedio (USD/MWh) y Frecuencia (50 Hz), con sparklines.
- Tabla "Precio por Nodo de Barra": top 12 subestaciones por CMg con tendencia horaria.

## Navegacion por secciones

- Orden principal de navegacion: **Overview → Generacion → Costos Marginales → Transmision**. La pantalla inicial es **Overview**.
- **Overview**: panel general con KPIs, topologia de la red y detalle por nodo.
- **Generacion**: vista unificada con mapa de generacion por nodo, filtro reactivo por tecnologia/central, perfil de nodo con CMg y analisis de generacion por tecnologia de las ultimas 24 h publicadas por API (grafico ECharts + KPIs + share/notas), mostrando rango fecha/hora explicito.
- **Costos Marginales**: mapa CMg, modos de visualizacion y tabla de precios por nodo.
- **Transmision**: mapa de flujos por linea, filtro por linea y congestion frente a limites fisicos.
- Alerts (y enlaces del SideNav): vistas placeholder "en desarrollo".

### Regla global de ventanas CEN

- Todos los datasets operacionales reales deben descargarse con una **misma ventana CEN global** (`CEN_WINDOW_DAYS`, o `CEN_START_DATE`/`CEN_END_DATE` si se fijan manualmente). La misma fecha `startDate` y `endDate` aplica siempre a CMg real, demanda real, generacion real y potencia transitada/congestion.
- La UI debe mostrar esa ventana global como `Ventana CEN: YYYY-MM-DD -> YYYY-MM-DD` y no mezclar datos de fechas distintas como si pertenecieran a la misma foto operacional.
- Dentro de la ventana global, cada seccion puede mostrar las ultimas 24 horas secuenciales informadas por la API cuando exista serie horaria real. No se inventan horas ni se rellenan faltantes.
- Para CMg, el fetch usa `/costo-marginal-real/v4/findByDate` como fuente preferente y conserva el historial descargado para ampliar interaccion sin llamar APIs desde navegador. `cmg-online` queda como respaldo real, no simulado.
- La demanda real estimada se obtiene desde `/demanda-real-estimada/v4/findByDate` y la potencia transitada real desde `/potencia-transitada/v4/findByDate`, ambos con la misma ventana global.
- La generacion real horaria por central/unidad se obtiene desde `/generacion-real/v3/findByDate` con la misma ventana global. El catalogo `/centrales/v4/findByDate` se usa para mejorar matching de nombres/idCentral contra el KMZ cuando los nombres no coinciden exactamente.
- La generacion real diaria por tecnologia desde API Operacion `/reportes/v3/generation` queda solo como respaldo real opcional (`generacion-real-diaria`) si se habilita explicitamente.
- Cada seccion debe mostrar claramente la fuente y ventana: **API del Coordinador (CEN)**, dataset usado y rango **desde fecha/hora UTC hasta fecha/hora UTC** cuando aplique.
- Si una seccion no tiene datos CEN reales para esa ventana, debe decirlo explicitamente y no presentar una ventana CEN ficticia.
- No se deben mostrar datos simulados. Si CEN/API no entrega la informacion, la UI debe mostrar exactamente: `CEN no ha informado esta información`.
- Excepcion operativa sin simulacion: si una actualizacion API falla (429/404/timeout), `scripts/fetch-cen-data.mjs` debe preservar el ultimo JSON real bueno y marcarlo `stale: true`, mostrando en UI "ultimo dato real disponible". Nunca debe vaciar datos reales por una falla temporal, pero tampoco debe mezclarlo como si fuera parte de la ventana actual.
- Las credenciales nunca se escriben en codigo ni en archivos del repo; deben venir desde GitHub Secrets o variables de entorno (`CEN_API_KEY`, `CEN_OPERACION_USER_KEY`).
- La vista Generacion mantiene desacoplado el bloque global de **Generacion por tecnologia**: es dato global CEN del sistema y no depende del filtro/cross-filter por central.
- Principio KISS/performance: no redibujar ECharts globales ni recalcular listas completas cuando cambia un filtro local si la informacion global no depende de ese filtro.

### Transmision: flujos y congestion por linea

- Nueva vista **"Transmision"** (top nav y side nav) con su propio mapa MapLibre (`map-flows`).
- Cada linea tiene un **limite fisico (MW)** real tomado del reporte CEN `reporte_secciones-tramos.xlsx` (columnas `Potencia Nominal A->B  con sol 35C MW` y `Potencia Nominal A->B MW  con sol 25C`), emparejado por nombre contra el KMZ mediante `scripts/export-line-limits.py` -> `public/linea-limites.json`. Preferencia 35C, respaldo 25C; valores fisicamente imposibles se descartan como outliers (tope por tension). Lineas sin dato real usan la estimacion por tension como respaldo.
- El **flujo (MW)** viene solo de potencia transitada real CEN. Si no hay matching o dato real en la ventana global, se muestra `CEN no ha informado esta información`.
- La **cargabilidad** es `flujo / limite`. Umbrales de congestion:
  - `> 90%` **CRITICO** (rojo `#ba1a1a`)
  - `> 70%` **ALTO** (naranja `#e07000`)
  - `> 50%` **MEDIO** (ambar `#d9a400`)
  - resto **NORMAL** (verde `#00875f`)
- El mapa colorea cada linea por su estado y su **grosor escala con el flujo (MW)**; la leyenda esta en la cabecera de la vista.
- **Filtro por linea**: buscador en el panel derecho (nombre o kV) que lista las lineas con su % de cargabilidad; al hacer click sobre una linea se vuela a ella, se resalta su trazado (capa `sen-lines-selected`) y se fija su detalle.
- **Detalle de linea seleccionada**: nombre, tension, km, flujo (MW), limite (MW), barra de cargabilidad y estado (label + color).
- **Modos de cargabilidad**: botones "Todas" / "Criticas" / "Altas" que filtran las lineas mostradas en el mapa.
- **Ranking "Mayor Cargabilidad"**: top 10 lineas por `%` de cargabilidad; al hacer click se foca la linea.
- El selector de HORA solo aplica a series reales disponibles. Si CEN no informa flujos, la vista muestra `CEN no ha informado esta información`.
- Popup de linea muestra limite real si existe; flujo/cargabilidad solo si hay dato real informado.
- Nota: los **limites** son reales del reporte CEN. Los **flujos** vienen de `/potencia-transitada/v4/findByDate`; si CEN no informa datos para la ventana global, se informa `CEN no ha informado esta información`.

### Popup al hacer clic en nodos / subestaciones

- Al hacer click sobre una subestacion (o central/BESS si estan visibles), se abre un popup MapLibre de vidrio anclado al punto.
- Contenido: tipo de entidad ("Nodo · Subestacion", "Central", "BESS"), nombre, valor CMg con dot de color segun la escala, lat/lon y hora.
- El click ademas fija la seleccion en el panel "Nodo Seleccionado" y su perfil CMg (comportamiento previo).

### Popup al hacer clic en lineas de transmision

- Al hacer click sobre una linea de 500/220/154 kV, se abre un popup anclado en el punto de click.
- Contenido: "Linea de transmision", tension (kV) y longitud aproximada en km (suma de distancias Turf entre vertices).
- Cursor `crosshair` sobre las lineas; `pointer` sobre los nodos.

### Hover sobre lineas: popup de linea al vuelo

- Al pasar el cursor sobre una linea de transmision (sin click), se muestra un popup de vidrio anclado al cursor con la misma informacion que el popup de click: nombre, tension (kV), km aprox. y, cuando el flujo esta modelado, flujo / limite (MW) con la cargabilidad (% del limite fisico).
- El readout de la lupa operacional tambien cambia a la linea hovered (nombre + kV + cargabilidad si aplica) mientras el cursor este sobre ella.
- Se implementa con `queryRenderedFeatures` sobre las capas `sen-lines-500/220/154` en el handler de mousemove de cada mapa (`updateLensMove`); si el cursor esta sobre una linea, muestra el popup de linea y limpia el lente de puntos (y los arcos en la vista Generacion por Nodo).
- Al salir del mapa (`clearLens`) el readout y el popup vuelven a su estado por defecto.

### Filtro de lineas por nivel de tension (500 / 220 / 154 kV)

- En cada mapa (Overview, Costos Marginales, Transmision y Generacion por Nodo) hay toggles "500 kV", "220 kV" y "154 kV" junto a los toggles de capas.
- Activan/desactivan las capas de linea por voltaje (`sen-lines-500/220/154`) de forma independiente del toggle general "Transmision" (`layers.lines`).
- En la vista Transmision, las lineas se renderizan en tres capas por voltaje (en lugar de una sola) con el mismo paint de cargabilidad para soportar el filtro.
- Estado global `voltages`; `setLayerVisibility` combina `layers.lines && voltages[kV]` por capa. Aplicar el filtro no altera los datos de flujo ni la seleccion.

### Perfil CMg de linea con crosshair y seguimiento del cursor

- El perfil CMg horario (Overview y Costos Marginales, `drawCmgChart`) paso de barras a **grafico de linea** (area rellena con tinte del primario, polilinea y puntos por hora coloreados por la escala CMg; la hora bajo cursor se resalta con un punto mas grande).
- La serie CMg ya no debe interpretarse como `00:00-23:00` de un mismo dia. `scripts/fetch-cen-data.mjs` conserva `records` (ultimo valor por barra) y, cuando la API entrega suficientes timestamps, tambien `hours` + `history` con las **ultimas 24 horas publicadas** por barra en `docs/data/cmg-online-latest.json`.
- La consulta por defecto no apunta a "ayer completo": usa una ventana movil `startDate = hoy - 1 dia` y `endDate = hoy`; luego normaliza cada timestamp a clave horaria cronologica `YYYY-MM-DD HH`, ordena esos timestamps reales y corta solo los ultimos 24 publicados. Ejemplo: si son las 09:00 del 12/08, la ventana consultada es 11/08→12/08 y el grafico muestra solo las ultimas 24 horas informadas en esa respuesta, en orden cronologico ascendente.
- `cmgSeries(feature)` busca esa historia por barra/nodo y dibuja la ventana real con etiquetas `dd/mm + hora UTC`; si una barra no tiene historia o la API falla, muestra `CEN no ha informado esta información`.
- **Crosshair**: al mover el cursor sobre el canvas, una linea punteada vertical marca la hora bajo el cursor, el punto de esa hora se resalta y el valor mostrado en la cabecera del panel (`chart-value`) cambia al de esa hora. Al salir del canvas vuelve a la hora actual.
- **Seguimiento del cursor del mapa**: `updateChartHover` redibuja el perfil con el nodo mas cercano bajo el cursor en cada mousemove (deduplicado por clave de nodo); al salir del mapa (`clearLens`) vuelve al nodo seleccionado o al placeholder.
- En la vista Generacion por Nodo, `updateGen2ChartHover` actualiza el grafico ECharts con el nodo bajo el cursor (y `clearGen2Lens` revierte al nodo seleccionado).
- Estado de redibujo: `cmgChartState` guarda la geometria y el nodo activo por canvas (para el hover del canvas y el resize); `hoverChartKey`/`gen2ChartHoverKey` deduplican redibujos por nodo.

### Filtro multifiltrado de nodos / subestaciones (popup)

- Boton **"Filtrar nodos"** disponible en Overview y en Costos Marginales.
- Abre un popup de vidrio con buscador y lista de subestaciones con checkboxes.
- Opciones del popup: "Seleccionar todos", "Limpiar", "Cancelar" y "Aplicar".
- Al aplicar, solo las subestaciones seleccionadas se muestran en el mapa (las lineas permanecen como contexto).
- El contador de seleccion aparece en el boton "Filtrar nodos" de ambas secciones.
- Si no hay seleccion, se muestran todos los nodos (sin filtro).
- Nota: seleccion vacia se interpreta como "sin filtro".

### Costos Marginales: modos de visualizacion CMg y fecha de datos

- Selector **"CMg:"** con dos modos:
  - **Todos los nodos**: muestra todas las subestaciones (ignora el filtro).
  - **Nodos filtrados**: muestra solo las subestaciones seleccionadas en el popup de filtro.
- La fecha de los datos CEN se muestra en:
  - Cabecera de Overview (`mc-date-overview`).
  - Cabecera de Costos Marginales (`mc-date`).
  - Estado de cada mapa (`map-status`, `map-status-mc`).
  - Estado de la tabla (`table-status`).
- La fecha y origen se calculan desde `docs/data/cmg-online-latest.json` (timestamp de registros o rango de status.json). Cuando el CEN no esta disponible, se indica `CEN no ha informado esta información`.

### Generacion unificada: nodo + tecnologia

- La navegacion tiene una sola vista **"Generacion"** (`view-gen2`). Integra el mapa de generacion por nodo y, debajo, el bloque de generacion por tecnologia que antes estaba en la vista separada "Generation".
- El bloque de tecnologia conserva grafico ECharts (vendored localmente en `docs/vendor/echarts.min.js`), KPIs y paneles de detalle.
- Los **datos de generacion por tecnologia** vienen de API Operacion CEN `GET /reportes/v3/generation` (`https://operacion.api.coordinador.cl:443`) con parametro `date` y `user_key`, via `scripts/fetch-cen-data.mjs` -> `docs/data/generacion-real-last-24h.json`.
- Ese endpoint entrega clasificacion **diaria** por tecnologia en GWh (`dailyCurrent`, `monthlyCurrentTodate`, `annualCurrentTodate`); no entrega serie horaria ni centrales. Por lo tanto, el grafico debe rotularse como dato diario real cuando use este endpoint.
- Para generar contexto historico real sin sobrecargar la UI, el fetch consulta hasta 7 dias diarios (`CEN_GENERACION_DAYS`, min 1, max 7) y la UI permite filtrar 1-7 dias. El cliente solo filtra arrays ya descargados; no llama APIs desde navegador.
- La generacion real por central/unidad viene de `GET /generacion-real/v3/findByDate`, con campos `fecha`, `hora`, `idCentral`, `nombreCentralUnidad`, `tipoTecnologia`, `unidad` y `valor`. El matching contra centrales del KMZ es heuristico por nombre normalizado y se apoya en `/centrales/v4/findByDate`.
- Si en el futuro se integra un endpoint horario de generacion, debe seguir la regla global: descargar ventana real amplia controlada, ordenar por timestamp informado y mostrar por defecto las ultimas 24 h reales sin rellenar horas faltantes.
- El eje del grafico no asume `00-23`; usa los timestamps reales de `hours`, con etiquetas `dd/mm + hora UTC`, por lo que una ventana que cruza medianoche queda explicitamente marcada.
- Las tecnologias se **normalizan/canonicalizan** por nombre (ej. Carbon -> Carbón) y los valores menores o iguales a 0 se omiten.
- Cuando no hay datos CEN (sin API key / sin red), la vista muestra `CEN no ha informado esta información`; no usa modelos de respaldo.
- **Grafico**: barras apiladas por tecnologia + linea del total (MW por hora); el nombre de cada tecnologia en el eje X se rota si no cabe.
- **KPIs** (24h): Energia total (GWh), Pico (MW), Tecnologia dominante con % de participacion y total de Fuentes.
- **Panel "Share"**: aporte (%) de cada tecnologia con barra proporcional al total.
- **Panel "Notas"**: explica origen de los datos reales CEN y muestra la fuente.
- **Filtro de centrales**: dentro de Generacion hay filtros reactivos por tecnologia y por central, con buscador, seleccion total/limpieza por el conjunto visible y reset global. El filtro actualiza mapa de centrales/BESS, KPIs de generacion por nodo y ranking de centrales. La generacion por tecnologia es global del sistema CEN y no depende de este cross-filter.

### Tema claro / oscuro (toggle)

- El panel soporta **modo oscuro** (paleta "Electric Midnight" de la referencia `stitch_swiss_national_energy_panel_black`) y **modo claro**, conmutable con el boton de la cabecera (`#theme-toggle`).
- Mecanica: los tokens de color Material del `tailwind.config` se resuelven a variables CSS (`var(--surface)`, `var(--on-surface)`, `var(--primary)`, etc.). `:root` define la paleta clara y `html.dark` la oscura; el boton alterna la clase `dark` en `<html>`.
- **Default = modo oscuro** en la primera visita; la preferencia se guarda en `localStorage` (clave `sen-theme`). Un script inline en el `<head>` aplica el tema antes del pintado para evitar parpadeo.
- Elementos que siguen el tema: fondo, tarjetas, vidrio (barra, nav, popups, lupa, modal), tablas, graficos ECharts, canvas CMg, colores de estado (congestion/CMg) y el **mapa** (basemap CARTO `dark_all` vs `light_all` y repintado de lineas/nodos via `applyThemeToMaps()`).
- Los colores de **tecnologia** (TECH_COLORS) y el tooltip del grafico son constantes (no cambian con el tema).

### Notas de fuente de datos

- Al pie de **cada seccion** (Generacion, Overview, Costos Marginales, Transmision y placeholders) hay una nota "Fuente de datos" (`data-note`) que explica de donde salen los datos; dentro de Generacion tambien se mantiene la nota especifica del bloque por tecnologia.
- Es **dinamica** segun el estado de los datos: si el CEN esta entregando datos indica el archivo y fecha (ej. `cmg-online-latest.json`); si no, muestra `CEN no ha informado esta información`.
- Nota por seccion:
  - **Overview**: red KMZ + CMg de la **API del Coordinador (CEN)**; si hay `hours/history`, los perfiles muestran las ultimas 24 h publicadas con rango fecha/hora UTC. Demanda/frecuencia muestran `CEN no ha informado esta información` hasta integrar endpoint real.
  - **Costos Marginales**: CMg de la **API del Coordinador (CEN)** (`cmg-online-latest.json`) sobre el modelo KMZ; los perfiles usan la ventana horaria real publicada cuando esta disponible.
  - **Transmision**: limites reales del reporte CEN (`reporte_secciones-tramos.xlsx` → `linea-limites.json`); flujos muestran `CEN no ha informado esta información` hasta integrar endpoint real.
- **Generacion por tecnologia**: **API del Coordinador (CEN)** `generacion-real-last-24h.json`; sin modelo de respaldo.
- Cuando la **API del Coordinador no entrega datos** (sin API key o sin red), el panel muestra `CEN no ha informado esta información`.
- Siempre menciona el basemap (CARTO © OpenStreetMap). Las notas se rellenan en `renderSectionNotes()`, llamado desde `updateDates()`.

## Datos y API

- CEN via API SIP (`https://sipub.api.coordinador.cl:443`), autenticacion con `user_key` (pip `CEN_API_KEY`).
- Datasets: `cmg-real`, `cmg-online`, `demanda-real`, `potencia-transitada`, `generacion-real`, `centrales` (ver `scripts/fetch-cen-data.mjs`). Por defecto `npm run cen:update` baja esos datasets con una ventana global (`CEN_WINDOW_DAYS`) definida en `.github/workflows/update-cen-data.yml`.
- El matching CEN-KMZ es heuristico por nombre normalizado; se planea una tabla de equivalencias `docs/data/barra-kmz-mapping.json`.
- Proximos pasos: cross-filtering entre graficos (estado centralizado KISS + componente `brush` de ECharts), mejorar la lupa/panel de detalle.

## Arquitectura de build

- `work/static-map-layout-v2.mjs` — plantilla activa unica del panel (importa datos y genera el HTML, incluidos CSS Liquid Glass, tema claro/oscuro, popups, vista Generacion unificada, filtros kV, hover de lineas y perfiles CMg de linea). `buildStaticMapGeneracionHtml(senData, { lineLimits })` embebe `public/linea-limites.json` en el bloque `LINE_LIMITS`.
- `work/static-map-layout.mjs` — plantilla historica v1; no se usa para generar el sitio principal.
- ECharts 5.5.1 esta vendored en `docs/vendor/echarts.min.js` (se carga antes que el script principal) y se usa en la vista Generacion.
- `scripts/export-line-limits.py` — lee `reporte_secciones-tramos.xlsx` (hoja "1.- Info. Tec. Secciones Tramos", columnas `Nombre Linea`, `Potencia Nominal A->B  con sol 35C MW`, `Potencia Nominal A->B MW  con sol 25C`), empareja por nombre normalizado contra `public/sen-data.json` y escribe `public/linea-limites.json`. Descarta outliers fisicamente imposibles (tope por tension).
- `work/build-static-map.mjs` — genera `docs/index.html` y `outputs/sen-lupa-estatico/index.html` (`npm run static:build`) desde `work/static-map-layout-v2.mjs`.
- `work/build-static-map-v2.mjs` — genera `docs/indexv2.html` y `outputs/sen-lupa-v2/index.html` (`npm run static:build:v2`).
- `docs/index.html` y `docs/indexv2.html` son el mismo panel y se generan desde la misma plantilla activa v2 (popup de punto con CMg, filtro kV, hover de lineas, perfil CMg de linea con crosshair y seguimiento del cursor).
- MapLibre GL JS y Turf.js se cargan desde `docs/vendor/`; Tailwind y Google Fonts vienen por CDN (requieren red).
- Los datos CEN se actualizan con GitHub Actions a `docs/data/`.

## Estructura relevante

```text
quier/
├── docs/
│   ├── index.html
│   ├── indexv2.html
│   ├── .nojekyll
│   ├── data/
│   │   ├── status.json
│   │   ├── cmg-online-latest.json
│   │   ├── cmg-real-latest.json
│   │   ├── demanda-real-estimada.json
│   │   ├── potencia-transitada-latest.json
│   │   ├── centrales-latest.json
│   │   ├── embalse-real-last.json
│   │   └── generacion-real-last-24h.json
│   └── vendor/
│       ├── maplibre-gl.css
│       ├── maplibre-gl.js
│       ├── echarts.min.js
│       └── turf.min.js
│
├── public/
│   ├── sen-data.json
│   ├── linea-limites.json
│   └── chile.geojson
│
├── work/
│   ├── build-static-map.mjs
│   ├── build-static-map-v2.mjs
│   ├── static-map-layout.mjs
│   └── ...
├── scripts/
│   ├── fetch-cen-data.mjs
│   └── export-line-limits.py
└── stitch_swiss_national_energy_panel/
    ├── grid_standard/DESIGN.md
    └── ...
```

## Prueba v2: Generacion por Nodo

`npm run static:build:v2` genera `docs/indexv2.html` (y `outputs/sen-lupa-v2/index.html`) desde `work/static-map-layout-v2.mjs`, una copia del ADN visual de `static-map-layout.mjs` (tema claro/oscuro, Liquid Glass, nav, notas de fuente). La pantalla inicial es **Overview** y la vista **Generacion** queda como seccion unificada:

- **Mapa de generacion por nodo**: centrales coloreadas por MW estimado (colormap `#2b90e2` → `#7dd3fc`; gris neutro = sin generacion) y tamano proporcional a la potencia; selector HORA (0-23); lupa operacional que suma los MW dentro del radio.
- **Lupa interactiva tipo VisQuill**: al pasar el cursor sobre un nodo dentro del radio aparecen automaticamente (sin click) un globo con generacion (MW) y CMg (USD/MWh), y arcos semicirculares de colores alrededor del nodo (fondo neutro, arco azul = generacion, arco naranja = CMg) con etiquetas de valores a los lados; se actualizan al mover el cursor y siguen al nodo durante pan/zoom.
- **Generacion real por central**: usa `/generacion-real/v3/findByDate` y matching por nombre/idCentral apoyado en `/centrales/v4/findByDate`. Si no hay dato o matching real, muestra `CEN no ha informado esta información`.
- **Detalle de nodo** (click en el mapa): generacion actual (MW) y CMg (USD/MWh) + grafico ECharts 24 h de doble eje estilo VisQuill: Generacion (azul `#2b90e2`, eje izquierdo MW) y CMg (naranja `#f97316`, eje derecho USD/MWh), grid fino y labels mono.
- **KPIs**: generacion actual, pico 24 h, CMg promedio y centrales activas; mas ranking top 10 de centrales.
- **Generacion por tecnologia integrada**: KPIs de energia/pico/tecnologia dominante/fuentes, grafico ECharts de barras apiladas + linea total, participacion por tecnologia y notas de fuente. Usa `hours` reales de las ultimas 24 h publicadas (fecha/hora UTC en eje y tooltips). Ya no existe una vista navegable separada `Generation`.
- **Interacciones de hover en v2**: al pasar el cursor sobre una linea de transmision se muestra su popup (nombre, kV, km, flujo/cargabilidad si aplica) y el readout de la lupa se actualiza; al pasar el cursor sobre un nodo, el grafico ECharts del panel se actualiza con el nodo bajo el cursor (y vuelve al nodo seleccionado al salir del mapa). Toggles de voltaje (500/220/154 kV) en la cabecera del mapa.

Los CMg siguen viniendo de la API del Coordinador (CEN) cuando hay datos (`cmg-online-latest.json`). Si no hay datos, se muestra `CEN no ha informado esta información`.

## Comandos utiles

Regenerar sitio:

```bash
npm run static:build
npm run static:build:v2
```

Actualizar datos CEN localmente, si existe red y API key configurada:

```bash
npm run cen:update
```

Por defecto baja los 5 datasets (`cmg-online,cmg-real,demanda,hidrologia,generacion-real`); para limitar, pasar `CEN_DATASETS="cmg-online,demanda"` al script.

Regenerar limites fisicos de lineas desde el reporte xlsx (requiere Python + openpyxl):

```bash
python scripts/export-line-limits.py
```

Validar sintaxis del script CEN:

```bash
node --check scripts/fetch-cen-data.mjs
```
