// @ts-check
// Genera los PNG de icons/ a partir de icons/icono.svg, sin dependencias: un rasterizador mínimo
// (rect, circle y polygon con relleno de color #rrggbb, 4×4 muestras por píxel) y un codificador PNG
// RGB opaco con node:zlib. Reproducible: mismo SVG → mismos píxeles en cualquier máquina.
//
//   node scripts/iconos.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const RAIZ = new URL('../', import.meta.url)

/** escala < 1 encoge el dibujo hacia el centro (zona segura de los iconos maskable: círculo de radio 40 %). */
export const SALIDAS = Object.freeze([
  { archivo: 'apple-touch-icon.png', lado: 180, escala: 1 },
  { archivo: 'icono-192.png', lado: 192, escala: 1 },
  { archivo: 'icono-512.png', lado: 512, escala: 1 },
  { archivo: 'icono-maskable-512.png', lado: 512, escala: 0.75 },
])

/**
 * @typedef {[number, number, number]} Rgb
 * @typedef {{ tipo: 'rect', x: number, y: number, ancho: number, alto: number, color: Rgb }
 *   | { tipo: 'circle', cx: number, cy: number, r: number, color: Rgb }
 *   | { tipo: 'polygon', puntos: [number, number][], color: Rgb }} Forma
 */

/** @param {string} hex '#rrggbb' @returns {Rgb} */
function color(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`color no admitido: ${hex}`)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

/**
 * Lee el subconjunto de SVG que usa icono.svg. Cualquier otro elemento gráfico es un error (mejor que ignorarlo).
 * @param {string} texto
 * @returns {{ lado: number, formas: Forma[] }}
 */
export function leerSvg(texto) {
  const caja = /viewBox="0 0 (\d+) (\d+)"/.exec(texto)
  if (!caja || caja[1] !== caja[2]) throw new Error('icono.svg debe tener viewBox="0 0 N N" cuadrado')
  const sinComentarios = texto.replace(/<!--[\s\S]*?-->/g, '')
  /** @type {Forma[]} */
  const formas = []
  for (const [, etiqueta, atributos] of sinComentarios.matchAll(/<([a-z]+)\b([^>]*)>/g)) {
    if (['svg', 'title'].includes(etiqueta)) continue
    const a = Object.fromEntries([...atributos.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
    const n = (/** @type {string} */ k) => {
      const v = Number(a[k])
      if (!Number.isFinite(v)) throw new Error(`${etiqueta}: falta ${k}`)
      return v
    }
    const c = color(a.fill ?? '')
    if (etiqueta === 'rect') formas.push({ tipo: 'rect', x: n('x'), y: n('y'), ancho: n('width'), alto: n('height'), color: c })
    else if (etiqueta === 'circle') formas.push({ tipo: 'circle', cx: n('cx'), cy: n('cy'), r: n('r'), color: c })
    else if (etiqueta === 'polygon') {
      const valores = (a.points ?? '').trim().split(/[\s,]+/).map(Number)
      if (valores.length < 6 || valores.length % 2 || valores.some((v) => !Number.isFinite(v))) throw new Error('polygon: points no válido')
      /** @type {[number, number][]} */
      const puntos = []
      for (let i = 0; i < valores.length; i += 2) puntos.push([valores[i], valores[i + 1]])
      formas.push({ tipo: 'polygon', puntos, color: c })
    } else throw new Error(`elemento no admitido en icono.svg: <${etiqueta}>`)
  }
  if (formas.length === 0) throw new Error('icono.svg sin formas')
  return { lado: Number(caja[1]), formas }
}

/** @param {Forma} f @param {number} x @param {number} y */
function dentro(f, x, y) {
  if (f.tipo === 'rect') return x >= f.x && x < f.x + f.ancho && y >= f.y && y < f.y + f.alto
  if (f.tipo === 'circle') return (x - f.cx) ** 2 + (y - f.cy) ** 2 <= f.r ** 2
  let impar = false
  const p = f.puntos
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]
    const [xj, yj] = p[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) impar = !impar
  }
  return impar
}

/**
 * Pinta el dibujo en un cuadrado de `lado` píxeles, RGB sin alfa. Fuera de todo, el color de la primera forma (el fondo).
 * @param {{ lado: number, formas: Forma[] }} dibujo
 * @param {number} lado
 * @param {{ escala?: number, muestras?: number }} [op]
 */
export function rasterizar(dibujo, lado, { escala = 1, muestras = 4 } = {}) {
  const rgb = new Uint8Array(lado * lado * 3)
  const unidad = dibujo.lado / lado
  const centro = dibujo.lado / 2
  const fondo = dibujo.formas[0].color
  const total = muestras * muestras
  for (let py = 0; py < lado; py++) {
    for (let px = 0; px < lado; px++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < muestras; sy++) {
        for (let sx = 0; sx < muestras; sx++) {
          const x = centro + ((px + (sx + 0.5) / muestras) * unidad - centro) / escala
          const y = centro + ((py + (sy + 0.5) / muestras) * unidad - centro) / escala
          let c = fondo
          for (const f of dibujo.formas) if (dentro(f, x, y)) c = f.color
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const i = (py * lado + px) * 3
      rgb[i] = Math.round(r / total)
      rgb[i + 1] = Math.round(g / total)
      rgb[i + 2] = Math.round(b / total)
    }
  }
  return rgb
}

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** @param {Buffer} datos */
function crc32(datos) {
  let c = 0xffffffff
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** @param {string} tipo @param {Buffer} datos */
function trozo(tipo, datos) {
  const longitud = Buffer.alloc(4)
  longitud.writeUInt32BE(datos.length)
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo))
  return Buffer.concat([longitud, cuerpo, crc])
}

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * PNG de 8 bits, tipo de color 2 (RGB, opaco), sin filtro por fila.
 * @param {Uint8Array} rgb @param {number} ancho @param {number} alto
 */
export function codificarPng(rgb, ancho, alto) {
  const cabecera = Buffer.alloc(13)
  cabecera.writeUInt32BE(ancho, 0)
  cabecera.writeUInt32BE(alto, 4)
  cabecera.set([8, 2, 0, 0, 0], 8)
  const filas = Buffer.alloc(alto * (1 + ancho * 3))
  for (let y = 0; y < alto; y++) {
    filas[y * (1 + ancho * 3)] = 0
    filas.set(rgb.subarray(y * ancho * 3, (y + 1) * ancho * 3), y * (1 + ancho * 3) + 1)
  }
  return Buffer.concat([FIRMA, trozo('IHDR', cabecera), trozo('IDAT', deflateSync(filas, { level: 9 })), trozo('IEND', Buffer.alloc(0))])
}

/**
 * Lee un PNG escrito por codificarPng (8 bits, RGB, filtro 0). Para los tests.
 * @param {Buffer} png
 */
export function leerPng(png) {
  if (!png.subarray(0, 8).equals(FIRMA)) throw new Error('no es un PNG')
  let i = 8
  /** @type {Buffer[]} */
  const idat = []
  let ancho = 0
  let alto = 0
  let profundidad = 0
  let tipoColor = 0
  while (i < png.length) {
    const longitud = png.readUInt32BE(i)
    const tipo = png.toString('ascii', i + 4, i + 8)
    const datos = png.subarray(i + 8, i + 8 + longitud)
    if (crc32(png.subarray(i + 4, i + 8 + longitud)) !== png.readUInt32BE(i + 8 + longitud)) throw new Error(`CRC incorrecto en ${tipo}`)
    if (tipo === 'IHDR') {
      ancho = datos.readUInt32BE(0)
      alto = datos.readUInt32BE(4)
      profundidad = datos[8]
      tipoColor = datos[9]
    } else if (tipo === 'IDAT') idat.push(datos)
    i += 12 + longitud
  }
  const filas = inflateSync(Buffer.concat(idat))
  const rgb = new Uint8Array(ancho * alto * 3)
  for (let y = 0; y < alto; y++) {
    if (filas[y * (1 + ancho * 3)] !== 0) throw new Error('filtro de fila no admitido')
    rgb.set(filas.subarray(y * (1 + ancho * 3) + 1, (y + 1) * (1 + ancho * 3)), y * ancho * 3)
  }
  return { ancho, alto, profundidad, tipoColor, rgb }
}

/** Escribe los PNG de SALIDAS en icons/. */
export function generar() {
  const dibujo = leerSvg(readFileSync(new URL('icons/icono.svg', RAIZ), 'utf8'))
  for (const { archivo, lado, escala } of SALIDAS) {
    writeFileSync(new URL(`icons/${archivo}`, RAIZ), codificarPng(rasterizar(dibujo, lado, { escala }), lado, lado))
    console.log(`icons/${archivo} ${lado}×${lado}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) generar()
