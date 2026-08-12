# Contrato del Proyecto: Mapa SEN con Lupa Operacional

## Proposito

Construir una pagina web estatica y liviana para explorar el Sistema Electrico Nacional de Chile con datos reales del Coordinador Electrico Nacional (CEN). La pagina debe separar claramente topologia, generacion, costos marginales y transmision, manteniendo el diseno actual y evitando mezclar indicadores sin contexto.

Regla principal: no se muestran datos simulados. Si CEN/API/descargables oficiales no entregan una informacion, la UI debe mostrar exactamente `CEN no ha informado esta información`.

## URL y Deploy

- Repositorio: `https://github.com/cristobalreyesmo-oss/mapa-sen-lupa`
- Sitio: `https://cristobalreyesmo-oss.github.io/mapa-sen-lupa/`
- HTML publicado unico: `docs/index.html`
- `docs/indexv2.html` fue eliminado por redundante.

## Principios de Diseno

- Mantener la estructura visual actual: Grid Standard / Swiss Design + Apple Liquid Glass solo en controles flotantes.
- Mantener MapLibre GL JS, Turf.js y ECharts lazy.
- Mantener mapas grandes, panel lateral compacto y comportamiento responsive movil en una sola pagina.
- El mapa debe venir centrado en el SEN por defecto. El boton `Centrar en SEN` puede mantenerse como accion de recuperacion, pero no debe ser necesario para iniciar el analisis.
- Reemplazar filtros sueltos de `HORA` por controles de `FECHA DE ANALISIS` y, cuando corresponda, ventana temporal. La hora solo debe existir si es necesaria dentro de una fecha/ventana seleccionada.
- KISS: primero estructura clara y datos compactos; evitar llamadas CEN desde navegador; evitar graficos pesados al inicio; cargar historicos solo bajo demanda.

## Reglas de Datos Reales

- El navegador consume JSON estaticos bajo `docs/data/`; no llama APIs CEN ni Qlik directamente.
- Las credenciales nunca se escriben en codigo ni repo. Deben venir desde GitHub Secrets o variables de entorno.
- No interpolar, no rellenar horas faltantes, no inventar centrales, nodos, flujos, CMg, capacidades instaladas ni capacidades de transporte.
- Si una actualizacion falla (`429`, `404`, timeout, `502`) y existe ultimo dato real bueno, se conserva como `stale: true` y se rotula `ultimo dato real disponible`.
- Cada dataset debe conservar trazabilidad: fuente, fecha/rango, formato original y timestamp de actualizacion.
- La capacidad instalada de centrales/BESS solo se muestra si existe fuente real CEN/catalogo oficial. Si falta, usar `CEN no ha informado esta información`.
- La capacidad de transporte de lineas a `35°C` se toma desde `public/linea-limites.json`, campo `c35` o `limit` cuando `primaryRating` sea `c35`.
- El nivel de tension de lineas y subestaciones/nodos debe venir del modelo, nombre/carpeta o dataset real. Si no se puede determinar de forma trazable, usar `CEN no ha informado esta información`.

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

- Fuente objetivo: descargables oficiales CEN/Qlik de `Generacion Real`:
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
- `scripts/import-generacion-historica-real.mjs`: lee CSV ancho diario de generacion real, publica historico horario mensual por central y agregado mensual anual por tecnologia. La columna `Subtipo` separa BESS `Inyeccion` y `Retiro`; se conserva el signo real informado en el CSV.
- `scripts/import-potencia-transitada-historica-real.mjs`: lee CSV historico de potencia transitada por tramo/linea, publica historico horario mensual de flujos.

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

Parte superior:
- Generacion historica real anual por tecnologia.
- Participacion anualizada por tecnologia, similar al componente actual de share, pero ubicada arriba.
- KPIs anuales por tecnologia cuando exista data real.

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
- Para la misma fecha/ventana seleccionada, mostrar generacion real y CMg en el mismo grafico cuando ambos existan.
- El cruce debe ser por timestamp real, no por posicion de array.
- Cross-filtering: seleccionar central, tecnologia, nodo o tension debe actualizar los graficos relacionados sin recargar toda la pagina.
- Si falta generacion o CMg real para el cruce, mostrar `CEN no ha informado esta información` para la serie faltante.

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

Comandos utiles:

```bash
npm run static:build
npm run static:build:v2
node --check scripts/fetch-cen-data.mjs
node --check scripts/build-cen-etl.mjs
node --check scripts/backfill-cen-history.mjs
```

Nota: `npm test` puede fallar localmente si falta `vinext`.

## Workflows

- `.github/workflows/update-cen-data.yml`: actualiza live + ETL compacto.
- `.github/workflows/backfill-cen-history.yml`: backfill historico manual por chunks.
- Futuros workflows Qlik/descargables deben operar igual: descargar fuera del navegador, normalizar, compactar, commitear datos livianos.

## Estado Actual

- `docs/index.html` es unico HTML publicado.
- Selector de fecha de analisis existe en la UI actual, pero la estructura debe reorganizarse segun este contrato antes de profundizar ETL.
- Historico CMg compacto parcial existe para agosto 2026.
- Generacion historica y flujos historicos estan preparados conceptualmente, pero falta ETL desde descargables oficiales CEN/Qlik porque API SIP ha devuelto `502`.
- Generacion historica real 2026 ya puede importarse desde `docs/data/generacion historica real/*.csv` hacia `docs/data/history/generacion/` y `docs/data/history/generacion-tecnologia/`.
- Potencia transitada historica real 2026 ya puede importarse desde `docs/data/potencia transitada por lineas historico real/*.csv` hacia `docs/data/history/flujos/`.
- Se identificaron fuentes oficiales alternativas:
  - CMg definitivo desde `https://www.coordinador.cl/costos-marginales/`.
  - Generacion real desde pagina CEN/Qlik de generacion real.
  - Potencia transitada desde pagina CEN/Qlik de potencia transitada.

## Proximo Orden de Trabajo

1. Reestructurar UI por secciones segun este contrato, sin cambiar aun el ETL profundo.
2. Eliminar mezclas conceptuales: Overview topologico, CMg solo nodos, Transmision sin centrales, Generacion como analisis historico real.
3. Definir modelos JSON compactos finales para CMg definitivo, generacion real y flujos.
4. Implementar ETL desde descargables oficiales CEN priorizando CSV.
5. Conectar UI a historicos reales bajo demanda.
