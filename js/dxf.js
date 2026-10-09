// ============================================================
// Escritor DXF R12 / AC1009 — extraído de CALCULADORA_DE_AREAS (2026-10-08)
// y adaptado para GeoComunas: drawTitleBlock() acepta meta.rotulo con
// {localidad, propietario, escala, levanto, calculo, dibujo, hoja}.
// Sin dependencias externas.
// ============================================================
// Exportación DXF (función Pro)
// Genera un plano en formato DXF ASCII, sin librerías externas.
//
// Versión DXF: R12 / AC1009 (no AC1021/R2007 como en una versión
// anterior). Motivo del cambio — AutoCAD 2022 no reconocía el archivo
// exportado: a partir de R13 (incluye AC1015/2000 y AC1021/2007) el
// formato DXF exige una estructura "orientada a objetos" con tablas
// BLOCK_RECORD y APPID, una sección BLOCKS con los bloques *Model_Space/
// *Paper_Space y una sección OBJECTS con el diccionario raíz; sin eso,
// AutoCAD puede rechazar el archivo aunque lectores más permisivos
// (como la librería ezdxf usada para las pruebas de este proyecto) lo
// acepten sin quejarse. El escritor de este archivo nunca generó esas
// secciones. R12 no las necesita en absoluto (es el formato "plano"
// previo a ese cambio de arquitectura), es el dialecto DXF más
// compatible que existe, y coincide con lo pedido originalmente en el
// prompt de este proyecto ("R12 o AC1015/2000 para amplia
// compatibilidad").
//
// Como R12 es anterior a Unicode, el texto visible (tildes, eñes) ya
// no puede ir en UTF-8: el archivo completo se codifica en bytes
// Windows-1252/Latin-1 al construirlo (ver latin1Bytes() más abajo),
// que es como AutoCAD siempre ha interpretado acentos en DXF clásico.
// El símbolo de grado sigue usando el código de control %%d, que
// funciona igual en cualquier versión de DXF.
//
// IMPORTANTE — dos convenciones numéricas distintas conviven aquí:
//   - dxfNum(): formatea los valores que van en los códigos de grupo
//     internos del DXF (coordenadas, alturas, radios...). Estos SIEMPRE
//     deben usar punto decimal, sin importar el idioma, porque así lo
//     exige la especificación DXF.
//   - fmtEs(): formatea los números que aparecen como TEXTO visible en
//     el plano (tablas, rótulo, declaratoria), en convención venezolana/
//     hispana: punto de millar, coma decimal.
// No deben mezclarse.
// ============================================================

function dxfNum(n, decimals = 4){
  if (!isFinite(n)) n = 0;
  return n.toFixed(decimals);
}

function fmtEs(num, decimals){
  const neg = num < 0;
  const fixed = Math.abs(num).toFixed(decimals);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const joined = decimals > 0 ? parts.join(',') : parts[0];
  return (neg ? '-' : '') + joined;
}

// ---------- Cálculo de distancia y rumbo por lado ----------
// Rumbo en notación clásica de cuadrante (N/S - grados°minutos' - E/O),
// sin segundos (la precisión del GPS de un teléfono no los sostiene).
function computeRumbo(dE, dN){
  const absE = Math.abs(dE), absN = Math.abs(dN);
  if (absE < 1e-6 && absN < 1e-6) return '—';
  if (absN < 1e-6) return dE > 0 ? "Este (E) 90°00'" : "Oeste (O) 90°00'";
  if (absE < 1e-6) return dN > 0 ? "Norte (N) 0°00'" : "Sur (S) 0°00'";
  const angleDeg = Math.atan(absE / absN) * 180 / Math.PI;
  let deg = Math.floor(angleDeg);
  let min = Math.round((angleDeg - deg) * 60);
  if (min === 60){ min = 0; deg += 1; }
  const degStr = String(deg).padStart(2, '0');
  const minStr = String(min).padStart(2, '0');
  const ns = dN > 0 ? 'N' : 'S';
  const ew = dE > 0 ? 'E' : 'O';
  return `${ns}-${degStr}°${minStr}'-${ew}`;
}

// pts: vértices UTM en orden de levantamiento, polígono cerrado
// (el último lado conecta de vuelta al primer vértice).
function computeSideData(pts){
  const n = pts.length;
  const sides = [];
  for (let i = 0; i < n; i++){
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dE = b.x - a.x;
    const dN = b.y - a.y;
    const dist = Math.sqrt(dE * dE + dN * dN);
    sides.push({ from: i + 1, to: ((i + 1) % n) + 1, dist, rumbo: computeRumbo(dE, dN) });
  }
  return sides;
}

// Reúne los vértices del polígono actual en coordenadas UTM reales,
// junto con el huso/hemisferio de referencia declarado en el plano.
function getPointsUTMForDxf(){
  const allManual = areaPoints.length > 0 && areaPoints.every(p => p.e !== undefined) && areaManualInfo;
  if (allManual){
    return {
      pts: areaPoints.map(p => ({ x: p.e, y: p.n })),
      zone: areaManualInfo.zone,
      isNorth: areaManualInfo.isNorth
    };
  }
  const pts = areaPoints.map(p => toUTMFixedZone(p.lat, p.lon));
  return { pts, zone: areaRefZone.zone, isNorth: areaRefZone.isNorth };
}

// ---------- Escritor DXF de bajo nivel ----------
class DxfWriter{
  constructor(){ this.lines = []; this.handle = 0x100; }
  push(code, value){ this.lines.push(String(code), String(value)); }
  nextHandle(){ return (this.handle++).toString(16).toUpperCase(); }
  toString(){ return this.lines.join('\r\n') + '\r\n'; }
}

// Entidades en formato R12 clásico: sin marcadores de subclase (100,
// AcDbXxx — eso es propio de R13 en adelante) y sin handle (5) de
// entidad, porque el header no declara $HANDLING 1. Es la forma más
// simple y más ampliamente compatible de escribir estas entidades.
function emitLine(w, layer, x1, y1, x2, y2){
  w.push(0, 'LINE'); w.push(8, layer);
  w.push(10, dxfNum(x1)); w.push(20, dxfNum(y1)); w.push(30, '0.0');
  w.push(11, dxfNum(x2)); w.push(21, dxfNum(y2)); w.push(31, '0.0');
}

function emitCircle(w, layer, x, y, r){
  w.push(0, 'CIRCLE'); w.push(8, layer);
  w.push(10, dxfNum(x)); w.push(20, dxfNum(y)); w.push(30, '0.0');
  w.push(40, dxfNum(Math.max(r, 0.01)));
}

function emitText(w, layer, x, y, height, text, opts = {}){
  const halign = opts.halign || 0; // 0 izquierda, 1 centrado
  w.push(0, 'TEXT'); w.push(8, layer);
  w.push(10, dxfNum(x)); w.push(20, dxfNum(y)); w.push(30, '0.0');
  w.push(40, dxfNum(Math.max(height, 0.01)));
  w.push(1, String(text).replace(/°/g, '%%d'));
  if (opts.rotation) w.push(50, dxfNum(opts.rotation, 2));
  if (halign !== 0){
    w.push(72, halign);
    w.push(11, dxfNum(x)); w.push(21, dxfNum(y)); w.push(31, '0.0');
  }
}

function emitLwpolylineClosed(w, layer, pts){
  // R12 no tiene LWPOLYLINE (llegó en R14/AC1014): se usa POLYLINE +
  // una entidad VERTEX por punto + SEQEND, el formato clásico de
  // polilínea 2D cerrada que cualquier versión de AutoCAD reconoce.
  w.push(0, 'POLYLINE'); w.push(8, layer);
  w.push(66, 1); w.push(70, 1); // 66=sigue lista de vértices, 70 bit1=cerrada
  w.push(10, '0.0'); w.push(20, '0.0'); w.push(30, '0.0');
  pts.forEach(p => {
    w.push(0, 'VERTEX'); w.push(8, layer);
    w.push(10, dxfNum(p.x)); w.push(20, dxfNum(p.y)); w.push(30, '0.0');
  });
  w.push(0, 'SEQEND');
}

// ---------- Cabecera, capas, estilo y tipo de línea ----------
function writeDxfHeader(w){
  w.push(0, 'SECTION'); w.push(2, 'HEADER');
  w.push(9, '$ACADVER'); w.push(1, 'AC1009'); // DXF R12: el dialecto más compatible; ver nota arriba
  w.push(0, 'ENDSEC');
}

const DXF_LAYERS = [
  ['LINDERO', 1], ['VERTICES', 2], ['ETIQUETAS_VERTICES', 7],
  ['CUADRO_COORDENADAS', 7], ['CUADRO_LINDEROS', 7], ['CUADRO_ROTULO', 7],
  ['NORTE', 7], ['CUADRICULA_UTM', 8], ['TEXTO_DECLARATORIA', 7]
];

function writeDxfTables(w){
  w.push(0, 'SECTION'); w.push(2, 'TABLES');

  w.push(0, 'TABLE'); w.push(2, 'LTYPE'); w.push(70, 1);
  w.push(0, 'LTYPE'); w.push(2, 'CONTINUOUS'); w.push(70, 0);
  w.push(3, 'Solid line'); w.push(72, 65); w.push(73, 0); w.push(40, '0.0');
  w.push(0, 'ENDTAB');

  w.push(0, 'TABLE'); w.push(2, 'STYLE'); w.push(70, 1);
  w.push(0, 'STYLE'); w.push(2, 'STANDARD'); w.push(70, 0);
  w.push(40, '0.0'); w.push(41, '1.0'); w.push(50, '0.0'); w.push(71, 0);
  w.push(42, '0.2'); w.push(3, 'txt'); w.push(4, '');
  w.push(0, 'ENDTAB');

  w.push(0, 'TABLE'); w.push(2, 'LAYER'); w.push(70, DXF_LAYERS.length);
  DXF_LAYERS.forEach(([name, color]) => {
    w.push(0, 'LAYER'); w.push(2, name); w.push(70, 0);
    w.push(62, color); w.push(6, 'CONTINUOUS');
  });
  w.push(0, 'ENDTAB');

  w.push(0, 'ENDSEC');
}

// ---------- Elementos geométricos auxiliares del plano ----------
function computeBbox(pts){
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function gridInterval(extent){
  const steps = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  for (const s of steps){ if (extent / s <= 12) return s; }
  return 10000;
}

function drawUtmGrid(w, bbox, extent, textH){
  const interval = gridInterval(extent);
  const x0 = Math.floor((bbox.minX - interval) / interval) * interval;
  const x1 = Math.ceil((bbox.maxX + interval) / interval) * interval;
  const y0 = Math.floor((bbox.minY - interval) / interval) * interval;
  const y1 = Math.ceil((bbox.maxY + interval) / interval) * interval;
  for (let x = x0; x <= x1 + 1e-6; x += interval){
    emitLine(w, 'CUADRICULA_UTM', x, y0, x, y1);
    emitText(w, 'CUADRICULA_UTM', x, y0 - textH * 1.3, textH * 0.7, dxfNum(x, 0), { halign: 1 });
  }
  for (let y = y0; y <= y1 + 1e-6; y += interval){
    emitLine(w, 'CUADRICULA_UTM', x0, y, x1, y);
    emitText(w, 'CUADRICULA_UTM', x0 - textH * 4, y, textH * 0.7, dxfNum(y, 0));
  }
}

function drawNorthArrow(w, x, y, extent, textH){
  const len = Math.max(extent * 0.08, textH * 4);
  const headW = len * 0.28;
  emitLine(w, 'NORTE', x, y, x, y + len);
  emitLine(w, 'NORTE', x, y + len, x - headW * 0.5, y + len - headW * 0.8);
  emitLine(w, 'NORTE', x, y + len, x + headW * 0.5, y + len - headW * 0.8);
  emitText(w, 'NORTE', x, y + len + textH * 0.3, textH * 1.2, 'N', { halign: 1 });
}

// ---------- Tabla genérica dibujada con líneas + texto ----------
function drawGridTable(w, layer, x, yTop, headers, rows, colWidths, rowH, textH){
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const numRows = rows.length + 1;
  for (let r = 0; r <= numRows; r++){
    const y = yTop - r * rowH;
    emitLine(w, layer, x, y, x + totalW, y);
  }
  let cx = x;
  emitLine(w, layer, cx, yTop, cx, yTop - numRows * rowH);
  colWidths.forEach(cw => { cx += cw; emitLine(w, layer, cx, yTop, cx, yTop - numRows * rowH); });

  cx = x;
  headers.forEach((h, i) => {
    emitText(w, layer, cx + colWidths[i] / 2, yTop - rowH * 0.68, textH * 0.8, h, { halign: 1 });
    cx += colWidths[i];
  });
  rows.forEach((row, ri) => {
    let cx2 = x;
    const rowY = yTop - (ri + 1) * rowH - rowH * 0.68;
    row.forEach((val, ci) => {
      emitText(w, layer, cx2 + colWidths[ci] / 2, rowY, textH * 0.75, String(val), { halign: 1 });
      cx2 += colWidths[ci];
    });
  });
  return yTop - numRows * rowH;
}

function colWidthFor(header, values, textH){
  const maxLen = Math.max(header.length, ...values.map(v => String(v).length));
  return Math.max(textH * (maxLen * 0.72 + 1.4), textH * 3);
}

function drawTitleBlock(w, x, yTop, meta, textH){
  const rot = meta.rotulo || {};
  const rows = [
    ['Localidad', rot.localidad || ''], ['Propietario', rot.propietario || ''], ['Escala', rot.escala || ''],
    ['Fecha', meta.fechaStr], ['Levantó', rot.levanto || ''], ['Calculó', rot.calculo || ''],
    ['Dibujó', rot.dibujo || ''], ['Área', meta.areaStr], ['Hoja N°', rot.hoja || '']
  ];
  const labelW = textH * 11, valueW = textH * 11, rowH = textH * 2.0;
  const totalW = labelW + valueW;
  const totalH = (rows.length + 1) * rowH;

  emitLine(w, 'CUADRO_ROTULO', x, yTop, x + totalW, yTop);
  emitText(w, 'CUADRO_ROTULO', x + totalW / 2, yTop - rowH * 0.68, textH * 0.9, 'LEVANTAMIENTO PLANIMÉTRICO', { halign: 1 });
  for (let r = 1; r <= rows.length + 1; r++){
    const y = yTop - r * rowH;
    emitLine(w, 'CUADRO_ROTULO', x, y, x + totalW, y);
  }
  emitLine(w, 'CUADRO_ROTULO', x, yTop, x, yTop - totalH);
  emitLine(w, 'CUADRO_ROTULO', x + labelW, yTop - rowH, x + labelW, yTop - totalH);
  emitLine(w, 'CUADRO_ROTULO', x + totalW, yTop, x + totalW, yTop - totalH);

  rows.forEach((row, i) => {
    const rowY = yTop - rowH - i * rowH - rowH * 0.68;
    emitText(w, 'CUADRO_ROTULO', x + textH * 0.4, rowY, textH * 0.75, row[0] + ':');
    if (row[1]) emitText(w, 'CUADRO_ROTULO', x + labelW + textH * 0.4, rowY, textH * 0.75, row[1]);
  });
  return yTop - totalH;
}

// ---------- Ensamblado completo del plano DXF ----------
function buildDxf(pts, sides, meta){
  const w = new DxfWriter();
  writeDxfHeader(w);
  writeDxfTables(w);
  // Sección BLOCKS vacía: los lectores DXF (AutoCAD incluido) la esperan
  // presente en R12 aunque el plano no defina bloques propios.
  w.push(0, 'SECTION'); w.push(2, 'BLOCKS'); w.push(0, 'ENDSEC');
  w.push(0, 'SECTION'); w.push(2, 'ENTITIES');

  const bbox = computeBbox(pts);
  const extent = Math.max(bbox.width, bbox.height, 20);
  const textH = Math.max(extent * 0.018, 0.25);
  const margin = Math.max(extent * 0.15, textH * 6);

  // Lindero (polígono cerrado, coordenadas UTM reales)
  emitLwpolylineClosed(w, 'LINDERO', pts);

  // Vértices numerados
  const vr = Math.max(extent * 0.006, textH * 0.25);
  pts.forEach((p, i) => {
    emitCircle(w, 'VERTICES', p.x, p.y, vr);
    emitText(w, 'ETIQUETAS_VERTICES', p.x + vr * 1.6, p.y + vr * 1.6, textH * 0.85, `V${i + 1}`);
  });

  // Cuadrícula UTM de fondo
  drawUtmGrid(w, bbox, extent, textH);

  // Flecha de norte (esquina superior izquierda del lote)
  drawNorthArrow(w, bbox.minX, bbox.maxY + margin * 0.35, extent, textH);

  // Columna de contenido a la derecha del lote: declaratoria + tablas + rótulo
  const colX = bbox.maxX + margin;
  let cursorY = bbox.maxY;

  const zoneLabel = `Huso ${meta.zone} ${meta.isNorth ? 'Norte' : 'Sur'}`;
  emitText(w, 'TEXTO_DECLARATORIA', colX, cursorY, textH * 1.1, 'COORDENADAS UTM');
  emitText(w, 'TEXTO_DECLARATORIA', colX, cursorY - textH * 1.6, textH * 1.1, `${zoneLabel}, Datum SIRGAS-REGVEN`);
  cursorY -= textH * 1.6 + textH * 2.4;

  const coordHeaders = ['Vértice', 'Este', 'Norte'];
  const coordRows = pts.map((p, i) => [`V${i + 1}`, fmtEs(p.x, 2), fmtEs(p.y, 2)]);
  const coordColW = coordHeaders.map((h, i) => colWidthFor(h, coordRows.map(r => r[i]), textH));
  cursorY = drawGridTable(w, 'CUADRO_COORDENADAS', colX, cursorY, coordHeaders, coordRows, coordColW, textH * 1.9, textH);
  cursorY -= textH * 2.6;

  const sideHeaders = ['Lado', 'Distancia (m)', 'Rumbo'];
  const sideRows = sides.map(s => [`V${s.from}-V${s.to}`, fmtEs(s.dist, 2), s.rumbo]);
  const sideColW = sideHeaders.map((h, i) => colWidthFor(h, sideRows.map(r => r[i]), textH));
  cursorY = drawGridTable(w, 'CUADRO_LINDEROS', colX, cursorY, sideHeaders, sideRows, sideColW, textH * 1.9, textH);
  cursorY -= textH * 2.6;

  drawTitleBlock(w, colX, cursorY, meta, textH);

  w.push(0, 'ENDSEC');
  w.push(0, 'EOF');
  return w.toString();
}

// DXF R12 es anterior a Unicode: AutoCAD interpreta el texto de un DXF
// clásico byte a byte según la página de códigos ANSI del sistema
// (Windows-1252 en español), no como UTF-8. Como todos los acentos y
// la Ñ usados en este plano (á é í ó ú ñ Á É Í Ó Ú Ñ ¿ ¡) coinciden en
// Windows-1252 con su mismo código Unicode por debajo de 256, basta
// con tomar cada carácter de la cadena y escribirlo como un solo byte
// (equivalente a Latin-1) en vez de dejar que el Blob lo codifique en
// UTF-8 por defecto.
function latin1Bytes(str){
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++){
    const code = str.charCodeAt(i);
    bytes[i] = code <= 0xFF ? code : 0x3F; // '?' de reserva por si aparece algún carácter fuera de rango
  }
  return bytes;
}

