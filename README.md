# GeoComunas v2.0 — Captura de datos de campo

**Qué es.** Aplicación web móvil para la captura de datos de campo del **SIG de las Comunas del estado Monagas**. Reemplazo simple de QField: sin proyecto que empaquetar en QGIS, sin QFieldSync, sin cable. Se abre en el navegador del teléfono (o se instala como PWA), se elige la categoría, se llena el formulario, se captura la geometría con GPS, se toma la foto obligatoria, se guarda y se comparte por WhatsApp.

**Nombre anterior:** CALCULADORA_DE_AREAS. El cálculo de áreas sigue existiendo como una capacidad más (pantalla «Calculadora de áreas»).

## Novedades de la v2 (2026-10-08)

- **Página de portada**: escudo del estado Monagas arriba centrado (~15% de la página), nombre GEOCOMUNAS centrado horizontal y vertical, texto introductorio, cita de Simón Bolívar *«Moral y Luces son nuestras primeras necesidades»* en letra gótica blackletter (fuente `assets/UnifrakturMaguntia.woff2` embebida, funciona sin internet) y botón **Iniciar** → la pantalla de inicio anterior pasa a ser la página del menú.
- **Encabezado del menú**: la descripción «CAPTURA DE CAMPO · SIG DE LAS COMUNAS DE MONAGAS» ahora centrada y en mayúsculas.
- **Respaldo embebido de categorías**: `const CATEGORIAS_EMBED` inyectado en el build —si `fetch('categorias.json')` falla (abrir por tap directo con `file://`), la app usa el respaldo y **ya no muestra el mensaje rojo alarmante** (solo un aviso sobrio si todo falla, caso que no debería ocurrir).
- **Distribución en un solo archivo**: `build_single.py` compila `~/workspace/your_files/GeoComunas.html` autocontenido (categorías, Leaflet, proj4, DXF, fuente y sello embebidos). Es el archivo que se toca en el teléfono: funciona por tap, como los `.html` anteriores. El proyecto mult-archivo se mantiene para desarrollar.

## Estructura

```
geocomunas/
├── index.html        # La app (pantallas + lógica)
├── categorias.json   # El "diseñador de categorías": 9 categorías, campos, dominios, regex
├── manifest.json     # PWA instalable
├── sw.js             # Service worker (app shell offline)
├── icon.svg          # Icono
├── lib/              # Leaflet 1.9.4 + proj4js 2.9.2 VENDORIZADOS (sin CDN → funciona offline)
│   ├── leaflet.js / leaflet.css / proj4.js
├── js/
│   └── dxf.js        # Escritor DXF R12 propio (extraído de CALCULADORA_DE_AREAS; rótulo alimentado por el formulario)
└── README.md
```

## División campo / oficina (regla de oro)

| Lo registra la APP (campo) | Lo gestiona la OFICINA (otra vía) |
|---|---|
| Geometría verificada en sitio (polígono/punto GPS) | Población votante **18+** (CNE / registro electoral) |
| Foto obligatoria = constancia de la visita | Agregados estadísticos, pirámides, NBI |
| Datos observables: nombres, códigos, rubro, estado del lote/obra, fechas de siembra/cosecha, montos declarados, avances observados, tipo de problema 1×10 | Aptitud agrícola, precipitación, suelos (GRASS/R) |
| `cod_comuna` en cada registro | Comparación de votantes **entre comunas** en el Geoportal |

**Clave de unión:** todo registro de campo lleva `cod_comuna` (formato `13-MM-PP-NNNN`). La población votante es dato de oficina y se une por esa clave; la app nunca la captura ni la inventa.

## Categorías (de `categorias.json`)

| # | Categoría | Geometría | Tabla destino |
|---|---|---|---|
| 1 | Comuna | Polígono | `com.comuna` |
| 2 | Consejo comunal | Polígono | `com.consejo_comunal` |
| 3 | Lote de siembra | Polígono | `agr.lote_siembra` |
| 4 | Proyecto / obra | Punto | `py.proyecto` |
| 5 | Unidad económica | Punto | `eco.unidad_economica` |
| 6 | Banco comunal | Punto | `com.banco_comunal` |
| 7 | Reporte 1×10 | Punto | `py.reporte_1x10` |
| 8 | Avance de obra | Sin geometría | `py.avance_obra` |
| 9 | Centro de votación | Punto | `ref.centro_votacion` *(propuesta v1: el modelo aún no define esta tabla)* |

Los nombres de campo son **idénticos a las columnas del modelo de datos** (`Modelo_Datos_SIG_Comunas_Monagas.pdf`); las listas desplegables son los dominios del modelo palabra por palabra; los regex de códigos son los mismos `CHECK` de la base de datos. Lo que la app no puede garantizar (topología `ST_Within` lote⊂comuna, unicidad de códigos) lo valida PostGIS al ingresar.

**Formatos derivados del prototipo Geoportal** (`GeoportalComuna.html`): los proyectos llevan tipo (7 códigos oficiales), ciclo, montos, avances, estatus, ejecutor y beneficiarios —los *votos* son de oficina—; los planes de siembra llevan rubro, ha planificadas/sembradas/cosechadas, rendimiento, estado y ciclo; las unidades socioproductivas llevan tipo, inversión, empleos y estado. Todo eso está en los formularios.

## SRC

**EPSG:2203 · UTM 20N · REGVEN** en producción y en la geometría de exportación. El GPS entrega WGS84; la app transforma con proj4 (`+datum=WGS84`, que convive con REGVEN con diferencia submétrica) y guarda/exporta en 2203.

## Exportación (pantalla «Mis levantamientos»)

- **GeoJSON**: un único `FeatureCollection` con miembro `"crs":{"name":"EPSG:2203"}`; cada feature trae propiedades `categoria` y `tabla_destino` + los campos del formulario + `meta_*` (responsable, fecha, precisión GPS, fotos). Geometría en **EPSG:2203**. QGIS lo abre directo.
- **CSV**: columnas = campos del modelo + `wkt_2203` + `este_2203/norte_2203` + fotos.
- **DXF R12**: plano del polígono con el rótulo alimentado por el formulario (localidad, responsable, fecha, área).
- **Fotos**: JPG individuales `{codigo}_F{n}.jpg`, referenciadas desde el GeoJSON/CSV (no embebidas).
- **Compartir**: Web Share → WhatsApp con todos los archivos; si el navegador no lo soporta, descarga directa.

### Llevarlo a QGIS / PostGIS (oficina)

```bash
# 1. Ver en QGIS: Capa → Añadir capa vectorial → geocomunas_*.geojson (QGIS lee el miembro crs EPSG:2203)
# 2. A PostGIS (una categoría):
ogr2ogr -f PostgreSQL "PG:dbname=sig_comunas" geocomunas_lote_siembra.geojson \
  -nln agr.lote_siembra -s_srs EPSG:2203 -t_srs EPSG:2203 -append \
  -sql "SELECT * FROM geocomunas WHERE categoria='lote_siembra'"
# 3. Fotos: copiar los JPG junto al GeoJSON; la columna meta_fotos trae los nombres.
```

## Trabajar sin internet

1. **Instalar**: con conexión, abrir la app en Chrome Android → menú → «Instalar app» (PWA). El service worker guarda el shell (HTML, JSON, librerías).
2. **Preparar salida** (con internet, antes de ir a campo): marcar el sector en el mapa (esquinas A/B o vista actual), elegir zooms, ponerle nombre («Sector El Porvenir») y descargar. Las teselas se guardan en IndexedDB como **paquete nombrado**.
3. **En campo**: activar el paquete («Usar en campo»); el mapa muestra el satélite descargado. Formularios, validación, GPS y guardado funcionan sin red —el GPS no necesita datos móviles (el primer fix puede tardar más sin A-GPS).
4. **De vuelta**: exportar/compartir por WhatsApp. El estado `pendiente/enviado` de la galería evita duplicados.

> Nota: el navegador móvil no permite a una web leer una carpeta arbitraria del teléfono; por eso no se usa «carpeta de teselas» sino paquetes dentro de la app. Pieza futura: importar un ZIP con estructura `z/x/y`.

## Validación en el teléfono (antes de guardar)

Códigos con su regex · listas cerradas · rangos 0–100 y ≥0 · `fecha_cosecha ≥ fecha_siembra` · **foto mínima 1 (bloquea el guardado)** · advertencia si precisión GPS > 30 m · superficies calculadas del polígono, nunca digitadas.

## Supuestos a validar en la primera salida real

Tiempo del primer fix GPS sin datos móviles · tamaño real de teselas z12–z17 por comuna · cuota de IndexedDB del teléfono · `navigator.share` con múltiples archivos en ese dispositivo · códigos numéricos de municipio INE (la lista 1301–1313 va en orden alfabético; verificar contra fuente oficial antes de producción).

## Instalación para pruebas

Servir por HTTP (el service worker no corre con `file://`): `python3 -m http.server` en esta carpeta, o publicar en GitHub Pages.

## Ronda de correcciones 2026-10-08 (prueba en teléfono del usuario)

1. **Botón «Preparar salida» del menú no respondía**: causa raíz — el botón `btnGoTiles` existía en el HTML pero nunca se le asignó handler (solo `btnGoRegister`, `btnGoGallery`, `btnGoSettings` y `btnStart` tenían). La pantalla funcionaba vía el pie de navegación (`data-go="screenTiles"`, el icono satélite). Corregido: `btnGoTiles` ahora invoca la misma ruta (`showScreen('screenTiles')`), que inicializa el mapa de teselas.
2. **Botón «Calculadora de áreas» no respondía**: causa raíz — `btnGoCalc` tampoco tenía handler; la pantalla y sus botones internos sí estaban cableados pero eran inalcanzables. Corregido el acceso y **portadas fielmente las funciones originales de la app génesis** (`github.com/vicmal/CALCULADORA_DE_AREAS`): planilla manual UTM (huso 1–60, hemisferio, 3–200 vértices, Este/Norte por fila con validación), GPS por vértice con `getCurrentPosition` de alta precisión e indicador ≤5/15/30 m, Shoelace, CSV con columnas originales (Punto, Latitud, Longitud, Huso, Hemisferio, Este_X, Norte_Y, Precision_m + resumen), plano DXF y Web Share→WhatsApp con manejo de `AbortError`.
3. **Cita de Bolívar ilegible**: reemplazada la blackletter UnifrakturMaguntia por **IM Fell English** (regular + itálica, OFL, embebidas en base64): histórica pero legible.
4. **Iconos «cómics»**: los 9 emojis de categorías fueron reemplazados por iconos SVG inline de trazo fino profesional (casas, personas, espiga, grúa, fábrica, banco, portapapeles, gráfico, urna). También se sustituyeron los emojis del menú principal, pie de navegación y logo por SVG del mismo estilo.
