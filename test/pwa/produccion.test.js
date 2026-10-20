// @ts-check
// Los datos inventados (escenario sintético, estrategias de prueba como v1b y el laboratorio de los tests) viven solo
// en test/, worker/test/ y scripts/ de desarrollo: ni la PWA publicada ni el Worker desplegado pueden cargarlos.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { RAIZ, importsDe, leer, modulosDeLaApp } from './modulos.js'

/** Módulos que alcanza worker/src/index.js (lo que empaqueta wrangler), como rutas relativas a la raíz. */
function modulosDelWorker() {
  const vistos = new Set()
  const pendientes = ['worker/src/index.js']
  while (pendientes.length > 0) {
    const ruta = /** @type {string} */ (pendientes.pop())
    if (vistos.has(ruta)) continue
    vistos.add(ruta)
    for (const destino of importsDe(leer(ruta))) pendientes.push(new URL(destino, new URL(ruta, 'https://x/')).pathname.slice(1))
  }
  return [...vistos].sort()
}

/** Ningún módulo de producción sale de estas carpetas. @param {string} m */
const deProduccion = (m) => m === 'config.js' || /^(js|core|worker\/src)\//.test(m)

describe('sin datos sintéticos en producción', () => {
  test('la PWA solo carga módulos de js/, core/ y config.js: nada de test/ ni de worker/test/', () => {
    const fuera = modulosDeLaApp().filter((m) => !deProduccion(m) || m.startsWith('worker/'))
    assert.deepEqual(fuera, [])
  })

  test('el Worker desplegado solo carga worker/src/ y core/: ni el escenario sintético ni las estrategias de prueba', () => {
    const modulos = modulosDelWorker()
    assert.ok(modulos.includes('worker/src/vivo.js') && modulos.includes('core/estrategias.js'))
    assert.deepEqual(modulos.filter((m) => !deProduccion(m) || m.startsWith('js/')), [])
    for (const m of modulos) assert.doesNotMatch(leer(m), /\bv1b\b|vivoDePrueba|crearEscenario/, m)
  })

  test('data/ solo tiene resultados generados por los scripts, ninguno marcado como sintético', () => {
    const archivos = readdirSync(new URL('data/', RAIZ))
    for (const a of archivos) {
      assert.match(a, /^(backtest-v\d+|laboratorio)\.json$/, a)
      assert.notEqual(JSON.parse(leer(`data/${a}`)).sintetico, true, a)
    }
  })

  test('el service worker no guarda datos ni nada de test/', () => {
    const estructura = /const ESTRUCTURA = \[([\s\S]*?)\]/.exec(leer('sw.js'))?.[1] ?? ''
    assert.ok(estructura.includes("'./js/laboratorio.js'"))
    assert.doesNotMatch(estructura, /data\/|test\//)
  })

  test('la API simulada (datos sintéticos) es solo de desarrollo: localhost y fuera del grafo de la app', () => {
    assert.match(leer('scripts/api-simulada.mjs'), /export const ANFITRION = '127\.0\.0\.1'/)
    assert.match(leer('config.js'), /local \? API_LOCAL : produccion/)
  })
})
