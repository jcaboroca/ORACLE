// @ts-check
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { ESTRATEGIAS } from '../../core/estrategias.js'
import { VERSIONES, cargarBacktest } from '../../js/vistas/backtest.js'
import { RAIZ, leer, modulosDeLaApp } from './modulos.js'

describe('vistas', () => {
  test('el backtest se pide relativo a la página (vale bajo /ORACLE/) para cada estrategia registrada', async () => {
    assert.deepEqual(VERSIONES, Object.keys(ESTRATEGIAS))
    /** @type {string[]} */
    const pedidas = []
    /** @type {typeof fetch} */
    const fetch = async (url) => {
      pedidas.push(String(url))
      return String(url).endsWith('v9.json') ? new Response('No existe', { status: 404 }) : new Response(leer(String(url)))
    }
    const b = await cargarBacktest(fetch, 'v2')
    assert.equal(b.version, 'v2')
    await assert.rejects(cargarBacktest(fetch, 'v9'), /^Error: data\/backtest-v9\.json: HTTP 404$/)
    assert.deepEqual(pedidas, ['data/backtest-v2.json', 'data/backtest-v9.json'])
  })

  test('todos los módulos cargan en Node sin tocar el DOM al importarse; app.js y sus vistas compilan', async () => {
    const modulos = modulosDeLaApp()
    for (const m of ['js/vistas/login.js', 'js/vistas/panel.js', 'js/vistas/moneda.js', 'js/vistas/bot.js', 'js/vistas/backtest.js']) {
      assert.ok(modulos.includes(m), m)
    }
    for (const m of modulos.filter((x) => x !== 'js/app.js')) await import(new URL(m, RAIZ).href)
    execFileSync(process.execPath, ['--check', new URL('js/app.js', RAIZ).pathname])
  })

  test('// @ts-check en cada módulo de js/ y en config.js', () => {
    for (const m of modulosDeLaApp().filter((x) => x.startsWith('js/') || x === 'config.js')) {
      assert.ok(leer(m).startsWith('// @ts-check\n'), m)
    }
  })

  test('la atribución de TradingView (NOTICE y enlace) va bajo cada gráfico', () => {
    assert.match(leer('js/vistas/comun.js'), /ATRIBUCION\.url[\s\S]*ATRIBUCION\.producto[\s\S]*ATRIBUCION\.copyright/)
    for (const vista of ['moneda', 'bot', 'backtest']) {
      const fuente = leer(`js/vistas/${vista}.js`)
      assert.match(fuente, /notaAtribucion\(\)/, vista)
      assert.match(fuente, /grafico(Velas|Curva)\(/, vista)
    }
  })

  test('índice de confianza siempre «sin calibrar» y el texto nunca entra como HTML', () => {
    for (const vista of ['panel', 'moneda']) assert.match(leer(`js/vistas/${vista}.js`), /Índice de confianza \(sin calibrar\)/, vista)
    for (const m of modulosDeLaApp()) assert.doesNotMatch(leer(m), /innerHTML|insertAdjacentHTML|outerHTML/, m)
  })

  test('index.html: español, pie fijo con el aviso obligatorio y la app como módulo', () => {
    const html = leer('index.html')
    assert.ok(html.includes('<html lang="es">'))
    assert.match(html, /<footer class="pie">Simulación\. No es asesoramiento financiero ni garantía de beneficio\.<\/footer>/)
    assert.match(leer('styles.css'), /\.pie \{\s*position: fixed;/)
    assert.ok(html.includes('<script src="vendor/lightweight-charts.standalone.production.js" defer></script>'))
    assert.ok(html.includes('<script type="module" src="js/app.js"></script>'))
    assert.match(leer('styles.css'), /@media \(prefers-reduced-motion: reduce\)/)
  })
})
