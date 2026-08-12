# Contrato del Proyecto: Mapa SEN con Lupa Operacional

## Proposito

Visualizacion web estatica del Sistema Electrico Nacional de Chile. El panel muestra la red del modelo KMZ y superpone datos reales del Coordinador Electrico Nacional (CEN): CMg, demanda, generacion por central/unidad cuando exista, generacion diaria por tecnologia como respaldo real, flujos de transmision y limites fisicos de lineas.

Regla principal: no se muestran datos simulados. Si CEN/API no entrega una informacion, la UI debe mostrar exactamente `CEN no ha informado esta información`.

## URL y Deploy

- Repositorio: `https://github.com/cristobalreyesmo-oss/mapa-sen-lupa`
- Sitio: `https://cristobalreyesmo-oss.github.io/mapa-sen-lupa/`
- Cache bust recomendado: `https://cristobalreyesmo-oss.github.io/mapa-sen-lupa/?v=<commit>`
- HTML publicado unico: `docs/index.html`
- `docs/indexv2.html` fue eliminado por redundante.

## Workspaces

- Workspace local principal: `C:\Visual SEN`
- Clon temporal usado para commit/push/deploy: `C:\Users\efern\AppData\Local\Temp\opencode\mapa-sen-lupa-deploy`
- El repo de deploy no versiona `work/`; versiona el HTML generado en `docs/`, scripts, workflows, datos y contrato.

## Diseno y UI

- Base visual: Grid Standard / Swiss Design con capa Apple Liquid Glass solo en controles flotantes.
- Tema claro/oscuro con `localStorage`, default oscuro.
- Mapas con MapLibre GL JS, Turf.js para distancia/lupa y ECharts lazy para graficos de generacion.
- Navegacion principal: Overview, Generacion, Costos Marginales, Transmision.
- Responsive movil en la misma pagina; no existe segunda version.

## Reglas de Datos CEN

- Una sola ventana CEN global para fetch live: mismos `startDate`/`endDate` para CMg, demanda, generacion y flujos.
- Si una actualizacion falla (`429`, `404`, timeout, `502`) y existe ultimo JSON real bueno, se preserva como `stale: true` y la UI rotula `ultimo dato real disponible`.
- Las credenciales nunca se escriben en codigo ni datos. Deben venir de GitHub Secrets o variables de entorno:
  - `CEN_API_KEY`
  - `CEN_OPERACION_USER_KEY`
- El navegador no llama APIs CEN directamente; consume JSON estaticos bajo `docs/data/`.
- No se rellenan horas faltantes ni se interpolan valores.

## Fuentes Reales Integradas

- CMg real: `GET /costo-marginal-real/v4/findByDate`, `type=DEFINITIVO`, campo `cmg_mills_kwh_`.
- CMg online respaldo: `GET /costo-marginal-online/v4/findByDate`.
- Demanda real estimada: `GET /demanda-real-estimada/v4/findByDate`.
- Generacion real central/unidad: `GET /generacion-real/v3/findByDate`.
- Catalogo centrales: `GET /centrales/v4/findByDate`.
- Potencia transitada/flujos: `GET /potencia-transitada/v4/findByDate`.
- Generacion diaria Operacion respaldo: `GET /reportes/v3/generation`.

Estado observado recientemente:
- `cmg-online` entrega datos, pero puede rate-limitear con `429`.
- `cmg-real` devolvio 0 filas para la ventana reciente probada.
- `demanda-real` devolvio 0 filas para la ventana reciente probada.
- `generacion-real`, `potencia-transitada` y `centrales` han devuelto `502 Bad Gateway` incluso dia por dia.

## ETL KISS

Live liviano:
- `docs/data/live/status.json`
- `docs/data/live/cmg-current.json`
- `docs/data/live/demanda-current.json`
- `docs/data/live/generacion-current.json`
- `docs/data/live/flujos-current.json`

Historico compacto:
- `docs/data/history/manifest.json`
- `docs/data/history/progress.json`
- `docs/data/history/cmg/YYYY-MM.json`
- `docs/data/history/generacion/YYYY-MM.json` cuando CEN entregue generacion real historica.
- `docs/data/history/flujos/YYYY-MM.json` cuando CEN entregue flujos reales historicos.

Scripts relevantes:
- `scripts/fetch-cen-data.mjs`: descarga live CEN con ventana global y preserva stale.
- `scripts/build-cen-etl.mjs`: compacta JSON live a `live/` e `history/`.
- `scripts/backfill-cen-history.mjs`: backfill por dia/pagina, fusion mensual compacta y progreso persistente.

Backfill:
- Workflow manual: `Backfill historico CEN`.
- Inputs: `datasets`, `start_date`, `end_date`, `commit_data`, `limit`, `max_pages`, `start_page`.
- Datasets soportados: `cmg-real`, `cmg-online`, `generacion-real`, `potencia-transitada`.
- Conserva filas parciales si una pagina posterior falla con `429/502`.
- Registra intentos en `docs/data/history/progress.json` aunque no haya filas.
- Estrategia recomendada: lotes de 1 dia, `limit=500`, `max_pages=2` o `3`, avanzando con `start_page`.

## Fecha de Analisis

- La UI tiene selector `FECHA` sincronizado en Overview, Generacion y Costos Marginales.
- Los graficos CMg ya no quedan limitados a las ultimas 24 h live: para la fecha seleccionada intentan cargar `docs/data/history/cmg/YYYY-MM.json`.
- El grafico de central en Generacion intenta cruzar generacion y CMg por el mismo timestamp:
  - Generacion desde `docs/data/history/generacion/YYYY-MM.json` cuando exista.
  - CMg desde `docs/data/history/cmg/YYYY-MM.json` cuando exista.
- Si no hay historico para la fecha seleccionada, no se simula. Se muestra `CEN no ha informado esta información`, o live solo si corresponde a la fecha live.

## Vistas

### Overview

- KPIs de demanda, CMg promedio y frecuencia.
- Mapa de topologia con subestaciones, lineas, centrales y BESS.
- Selector de fecha y hora.
- Perfil CMg por nodo con crosshair sobre canvas.
- Lupa operacional con Turf.js.

### Costos Marginales

- Mapa CMg por nodo.
- Modos: todos los nodos o nodos filtrados.
- Filtro de subestaciones con modal.
- Tabla top 12 nodos por CMg.
- Perfil CMg por fecha de analisis usando historico compacto cuando existe.

### Generacion

- Una sola vista unificada.
- Mapa de centrales/BESS despachadas por CEN si hay generacion real positiva.
- Subestaciones muestran CMg.
- Selector de fecha y hora.
- Detalle de central con grafico ECharts doble eje: generacion y CMg por timestamp real.
- Filtros por tecnologia y central.
- Ranking top centrales.
- Bloque global de generacion por tecnologia con KPIs, grafico, share y notas. Este bloque es global del sistema y no depende del filtro por central.
- Si generacion real por central no existe, no se dibujan centrales inventadas.

### Transmision

- Mapa de lineas coloreadas por cargabilidad cuando hay potencia transitada real.
- Limites fisicos reales desde `public/linea-limites.json`, generado a partir del reporte CEN de secciones/tramos.
- Filtro por linea y por estado de cargabilidad.
- Popups de linea con tension, longitud, flujo/limite si CEN informa datos.
- Si CEN no informa flujos, se muestra `CEN no ha informado esta información`.

## Build

- Plantilla activa local: `work/static-map-layout-v2.mjs`.
- Builder principal: `work/build-static-map.mjs`.
- Builder v2 conservado como alias operativo: `work/build-static-map-v2.mjs`, ahora tambien escribe `docs/index.html` y no `indexv2.html`.
- `docs/index.html` es el unico HTML publicado.
- `docs/.nojekyll` debe existir.
- MapLibre, Turf y ECharts se sirven desde `docs/vendor/`.

Comandos:

```bash
npm run static:build
npm run static:build:v2
node --check scripts/fetch-cen-data.mjs
node --check scripts/build-cen-etl.mjs
node --check scripts/backfill-cen-history.mjs
```

Nota: `npm test` puede fallar localmente si falta `vinext` en el PATH/instalacion local.

## Workflows

- `.github/workflows/update-cen-data.yml`: actualiza live + ETL compacto y commitea datos. Tiene `concurrency: actualizar-datos-cen`.
- `.github/workflows/backfill-cen-history.yml`: backfill historico manual con `concurrency: backfill-cen-history`, sin cancelar runs en progreso.

## Archivos Relevantes

- `docs/index.html`: sitio publicado.
- `docs/data/live/*.json`: datos live livianos.
- `docs/data/history/*.json`: manifest/progreso historico.
- `docs/data/history/cmg/*.json`: CMg historico compacto por mes.
- `public/sen-data.json`: modelo KMZ procesado.
- `public/linea-limites.json`: limites fisicos reales de lineas.
- `scripts/fetch-cen-data.mjs`: fetch CEN live.
- `scripts/build-cen-etl.mjs`: ETL compacto.
- `scripts/backfill-cen-history.mjs`: backfill historico.
- `work/static-map-layout-v2.mjs`: plantilla fuente local.
- `contrato.md`: este contrato.

## Estado Actual Importante

- `docs/indexv2.html` fue eliminado.
- Commit publicado con selector de fecha de analisis: `35faf92`.
- Commit publicado para chunks de backfill: `d36f357`.
- Historico CMg de agosto 2026 existe en el repo de deploy y se consulta desde la UI.
- Generacion historica esta preparada en UI/ETL, pero depende de que CEN entregue `/generacion-real/v3/findByDate`; en pruebas recientes ese endpoint devolvio `502`.
