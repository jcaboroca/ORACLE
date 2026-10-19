// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { SALIDAS, codificarPng, leerPng, leerSvg, rasterizar } from '../../scripts/iconos.mjs'

const SVG = readFileSync(new URL('../../icons/icono.svg', import.meta.url), 'utf8')
/** @param {string} archivo */
const png = (archivo) => readFileSync(new URL(`../../icons/${archivo}`, import.meta.url))

describe('iconos', () => {
  test('icono.svg: cuadrado, con fondo opaco que lo cubre entero', () => {
    const d = leerSvg(SVG)
    assert.equal(d.lado, 512)
    assert.deepEqual(d.formas[0], { tipo: 'rect', x: 0, y: 0, ancho: 512, alto: 512, color: [0x0b, 0x0f, 0x17] })
    assert.ok(d.formas.length > 5)
  })

  test('el lector de SVG rechaza lo que no sabe pintar', () => {
    const svg = (/** @type {string} */ cuerpo) => `<svg viewBox="0 0 10 10">${cuerpo}</svg>`
    assert.throws(() => leerSvg(svg('<path d="M0 0L5 5Z" fill="#ffffff"/>')), /elemento no admitido en icono\.svg: <path>/)
    assert.throws(() => leerSvg(svg('<rect x="0" y="0" width="1" height="1" fill="red"/>')), /color no admitido: red/)
    assert.throws(() => leerSvg('<svg viewBox="0 0 10 20"><rect/></svg>'), /cuadrado/)
  })

  test('PNG RGB opaco: codificar y leer devuelven los mismos píxeles', () => {
    const rgb = Uint8Array.from({ length: 3 * 3 * 3 }, (_, i) => (i * 29) % 256)
    const leido = leerPng(codificarPng(rgb, 3, 3))
    assert.deepEqual([leido.ancho, leido.alto, leido.profundidad, leido.tipoColor], [3, 3, 8, 2])
    assert.deepEqual(leido.rgb, rgb)
  })

  test('el rasterizador suaviza los bordes y respeta el orden de pintado', () => {
    const d = leerSvg('<svg viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4" fill="#000000"/><rect x="0" y="0" width="2" height="4" fill="#ffffff"/><circle cx="3" cy="3" r="0.2" fill="#ff0000"/></svg>')
    const rgb = rasterizar(d, 4)
    assert.deepEqual([...rgb.subarray(0, 3)], [255, 255, 255])
    assert.deepEqual([...rgb.subarray(3 * 3, 3 * 3 + 3)], [0, 0, 0])
    const borde = rasterizar(leerSvg('<svg viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4" fill="#000000"/><rect x="0" y="0" width="1" height="4" fill="#ffffff"/></svg>'), 2)
    assert.deepEqual([...borde.subarray(0, 3)], [128, 128, 128], 'medio píxel blanco → gris')
    assert.deepEqual([...borde.subarray(3, 6)], [0, 0, 0])
  })

  for (const { archivo, lado, escala } of SALIDAS) {
    test(`icons/${archivo}: ${lado}×${lado}, RGB opaco y generado desde icono.svg`, () => {
      const p = leerPng(png(archivo))
      assert.deepEqual([p.ancho, p.alto, p.profundidad, p.tipoColor], [lado, lado, 8, 2])
      assert.ok(Buffer.from(p.rgb).equals(Buffer.from(rasterizar(leerSvg(SVG), lado, { escala }))),
        'el PNG no coincide con icono.svg: ejecuta node scripts/iconos.mjs')
    })
  }

  test('el icono maskable deja todo el dibujo dentro de la zona segura (círculo de radio 40 %)', () => {
    const { ancho, rgb } = leerPng(png('icono-maskable-512.png'))
    const radio = 0.4 * ancho
    let fuera = 0
    for (let y = 0; y < ancho; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = (y * ancho + x) * 3
        const esFondo = rgb[i] === 0x0b && rgb[i + 1] === 0x0f && rgb[i + 2] === 0x17
        if (!esFondo && Math.hypot(x + 0.5 - ancho / 2, y + 0.5 - ancho / 2) > radio) fuera++
      }
    }
    assert.equal(fuera, 0)
  })
})
