// @ts-check
// Worker de ORACLE: API (fetch) y dos crons (scheduled). Simulación: no envía órdenes a ningún exchange.
// Solo export default: el runtime rechaza cualquier otra exportación del módulo principal.
import { atender } from './api.js'
import { programado } from './crones.js'

// fetch global envuelto: pasarlo suelto dentro de un objeto puede dar «Illegal invocation» en Workers.
/** @type {typeof fetch} */
const fetchGlobal = (entrada, init) => fetch(entrada, init)

export default {
  /** @param {Request} peticion @param {any} env */
  fetch(peticion, env) {
    return atender(peticion, { env, fetch: fetchGlobal, ahora: Date.now() })
  },

  /**
   * `ahora` = hora programada (hh:01 o hh:03), no la de arranque: así un retraso del cron no cambia la vela.
   * @param {{ cron: string, scheduledTime: number }} evento @param {any} env @param {{ waitUntil: (p: Promise<unknown>) => void }} ctx
   */
  scheduled(evento, env, ctx) {
    ctx.waitUntil(programado(evento.cron, { env, fetch: fetchGlobal, ahora: evento.scheduledTime }))
  },
}
