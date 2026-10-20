// @ts-check
// Panel (spec §12): Fear & Greed, una tarjeta por moneda (consejo de la estrategia principal, que se nombra),
// último análisis, frescura y «Analizar ahora».
import { ErrorApi, mensajeError } from '../api.js'
import { aviso, h, insignia, s } from '../dom.js'
import { euros, fechaHora, hace, hora, porcentaje } from '../formato.js'
import { hashDe } from '../rutas.js'
import { frenteAHodl, textoConsejo } from '../cartera.js'
import { lecturaFng, puntoArco, tarjetaMoneda } from '../senal.js'
import { avisoDeError, cabecera, seccion } from './comun.js'

const ESPERA_ANALIZAR_MS = 5 * 60_000

/** Medidor semicircular de Fear & Greed. @param {NonNullable<ReturnType<typeof lecturaFng>>} f */
function medidor(f) {
  const [cx, cy, r] = [100, 100, 80]
  const izq = puntoArco(0, cx, cy, r)
  const der = puntoArco(100, cx, cy, r)
  const valor = puntoArco(f.valor, cx, cy, r)
  const aguja = puntoArco(f.valor, cx, cy, r - 14)
  return s('svg', { viewBox: '0 0 200 112', class: 'medidor', 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d: `M ${izq.x} ${izq.y} A ${r} ${r} 0 0 1 ${der.x} ${der.y}`, class: 'medidor-pista' }),
    s('path', { d: `M ${izq.x} ${izq.y} A ${r} ${r} 0 0 1 ${valor.x} ${valor.y}`, class: `medidor-valor fng-${f.clase}` }),
    s('line', { x1: cx, y1: cy, x2: aguja.x, y2: aguja.y, class: 'medidor-aguja' }),
    s('circle', { cx, cy, r: 5, class: 'medidor-eje' }))
}

/** @param {any} fng */
function bloqueFng(fng) {
  const f = lecturaFng(fng)
  if (!f) return seccion('Fear & Greed', h('p', { class: 'vacio' }, 'Sin dato de Fear & Greed (alternative.me no respondió).'))
  return seccion('Fear & Greed',
    h('div', { class: 'fng' },
      medidor(f),
      h('p', { class: 'fng-valor' }, h('strong', { class: `fng-${f.clase}` }, String(f.valor)), ` / 100 · ${f.texto}`)),
    h('p', { class: 'ayuda' }, `${f.nota} Dato del ${f.fecha}.`))
}

/** @param {any} senal @param {number} ahora */
function tarjeta(senal, ahora) {
  const c = tarjetaMoneda(senal, ahora)
  return h('li', null, h('a', { class: `tarjeta borde-${c.claseVeredicto}`, href: hashDe('moneda', { simbolo: c.simbolo }) },
    h('div', { class: 'tarjeta-fila' },
      h('span', { class: 'tarjeta-simbolo' }, c.simbolo),
      insignia(c.veredicto, c.claseVeredicto)),
    h('div', { class: 'tarjeta-fila' },
      h('span', { class: 'tarjeta-precio' }, c.precio),
      h('span', { class: `cambio ${c.claseCambio}` }, h('span', { class: 'solo-lectores' }, 'Variación en 24 horas: '), c.cambio, ' 24 h')),
    h('p', { class: 'tarjeta-confianza' }, `Índice de confianza (sin calibrar): ${c.confianza} · Puntuación ${c.puntuacion}`),
    h('p', { class: 'tarjeta-frase' }, c.frase),
    h('p', { class: 'tarjeta-pie' }, `Señal ${c.actualizada}`, c.desactualizada ? h('span', { class: 'chip chip-alerta' }, 'desactualizada') : null)))
}

/** @param {any} bot */
function bloqueBot(bot) {
  if (!bot) return seccion('Bot', h('p', { class: 'vacio' }, 'Aún no hay simulación: se crea en la primera ejecución del cron de mercado.'))
  const comparacion = frenteAHodl(bot.rentabilidad, bot.rentabilidadHodl)
  return seccion('Bot',
    h('a', { class: 'tarjeta', href: hashDe('bot') },
      h('div', { class: 'tarjeta-fila' },
        h('span', null, `Simulación ${bot.simulacionId} · ${bot.estrategiaVersion} (principal)`),
        h('span', { class: 'tarjeta-precio' }, euros(bot.valorCartera))),
      h('p', null, `Rentabilidad ${porcentaje(bot.rentabilidad, { signo: true })} · ${bot.posicionesAbiertas} posiciones abiertas · saldo ${euros(bot.saldo)}`),
      h('p', { class: comparacion.clase }, comparacion.texto)))
}

/** @param {any} r resumen */
function bloqueEjecucion(r) {
  const e = r.ultimaEjecucion
  /** @type {HTMLElement[]} */
  const partes = [
    h('p', null, e
      ? `Último análisis: ${hace(e.inicio, r.ahora)} (${fechaHora(e.inicio)}, ${e.tipo === 'manual' ? 'manual' : 'cron'})${e.ok === false ? ' — falló' : e.ok === null ? ' — en curso' : ''}.`
      : 'Aún no se ha ejecutado ningún análisis.'),
  ]
  if (e && e.fallos.length > 0) {
    partes.push(h('details', null, h('summary', null, `${e.fallos.length} fuentes no respondieron`), h('ul', null, e.fallos.map((/** @type {string} */ f) => h('li', null, f)))))
  }
  if (r.datosDesactualizados) {
    partes.unshift(aviso('Datos desactualizados: alguna señal no tiene velas frescas o el último análisis tiene más de 2 horas.', 'alerta'))
  }
  return h('div', { class: 'ejecucion' }, partes)
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaPanel(ctx) {
  /** @type {any} */
  let r
  try {
    r = await ctx.api.resumen()
  } catch (e) {
    return { titulo: 'Panel', nodo: h('div', { class: 'vista' }, cabecera('Panel'), avisoDeError(e)) }
  }
  const estado = h('p', { class: 'analizar-estado', 'aria-live': 'polite' })
  const boton = h('button', { type: 'button', class: 'boton boton-principal' }, 'Analizar ahora')
  boton.addEventListener('click', async () => {
    boton.disabled = true
    estado.textContent = 'Descargando datos y analizando las monedas: suele tardar entre 25 y 35 segundos.'
    const inicio = Date.now()
    const contar = () => {
      boton.textContent = `Analizando… ${Math.round((Date.now() - inicio) / 1000)} s`
    }
    contar()
    const reloj = setInterval(contar, 1000)
    try {
      await ctx.api.analizar()
      estado.textContent = ''
      ctx.avisar('Señales recalculadas. Analizar no opera: el bot solo decide en el cron de cada hora.')
      ctx.refrescar()
    } catch (e) {
      if (ctx.exigirPin(e)) return
      estado.textContent = e instanceof ErrorApi && e.codigo === 'tiempo'
        ? 'El análisis no respondió en 60 segundos. Puede seguir en curso en el servidor: el Panel lo mostrará al refrescar.'
        : mensajeError(e)
      if (e instanceof ErrorApi && e.codigo === 'demasiado_pronto' && e.hasta) {
        const espera = Math.min(ESPERA_ANALIZAR_MS, Math.max(0, e.hasta - ctx.ahora()))
        boton.textContent = `Espera hasta las ${hora(e.hasta)}`
        setTimeout(() => {
          boton.disabled = false
          boton.textContent = 'Analizar ahora'
        }, espera)
        return
      }
      boton.disabled = false
      boton.textContent = 'Analizar ahora'
    } finally {
      clearInterval(reloj)
    }
  })
  const senales = r.senales.length > 0
    ? h('ul', { class: 'tarjetas' }, r.senales.map((/** @type {any} */ x) => tarjeta(x, r.ahora)))
    : h('p', { class: 'vacio' }, 'Aún no hay señales: el primer análisis llega con el cron de mercado (minuto 3 de cada hora).')
  const consejo = textoConsejo(r.estrategiaPrincipal)
  const nodo = h('div', { class: 'vista vista-panel' },
    cabecera('Panel', bloqueEjecucion(r)),
    seccion('Monedas', consejo ? h('p', { class: 'consejo-de' }, consejo) : null, senales, h('div', { class: 'analizar' }, boton, estado),
      h('p', { class: 'ayuda' }, 'Analizar ahora recalcula las señales (como mucho una vez cada 5 minutos). Nunca abre ni cierra posiciones.')),
    bloqueFng(r.fng),
    bloqueBot(r.bot))
  return { titulo: 'Panel', nodo }
}
