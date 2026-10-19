// @ts-check
// Refresco de datos cada 5 min, solo mientras la página está visible (Page Visibility API); la carga al
// abrir la hace la app. Oculta no hace ninguna petición; al volver, refresca enseguida si ya tocaba.
// Nada en segundo plano (spec §9).

export const INTERVALO_MS = 5 * 60_000

/**
 * @typedef {{ ahora: () => number, setTimeout: (f: () => void, ms: number) => unknown,
 *   clearTimeout: (id: unknown) => void }} Reloj
 */

/**
 * @param {{ accion: () => unknown, intervaloMs?: number, reloj: Reloj }} op
 *   accion: lo que refresca (puede ser asíncrona; si sigue en curso, no se solapa otra)
 */
export function crearRefresco({ accion, intervaloMs = INTERVALO_MS, reloj }) {
  /** @type {unknown} */
  let temporizador = null
  let ultima = -Infinity
  let enCurso = false
  let visible = true
  let activo = false

  function cancelar() {
    if (temporizador !== null) reloj.clearTimeout(temporizador)
    temporizador = null
  }

  /** @param {number} ms */
  function programar(ms) {
    cancelar()
    temporizador = reloj.setTimeout(() => {
      temporizador = null
      ejecutar()
    }, ms)
  }

  function ejecutar() {
    ultima = reloj.ahora()
    if (activo && visible) programar(intervaloMs)
    if (enCurso) return
    enCurso = true
    Promise.resolve()
      .then(accion)
      .catch(() => {})
      .finally(() => { enCurso = false })
  }

  return {
    /** Arranca el ciclo justo después de la carga inicial: el primer refresco, dentro de un intervalo. */
    iniciar() {
      activo = true
      ultima = reloj.ahora()
      if (visible) programar(intervaloMs)
    },
    /** @param {boolean} esVisible document.visibilityState === 'visible' */
    visibilidad(esVisible) {
      visible = esVisible
      if (!activo) return
      if (!esVisible) return cancelar()
      const falta = ultima + intervaloMs - reloj.ahora()
      if (falta <= 0) ejecutar()
      else programar(falta)
    },
    /** Tras una carga fuera del ciclo (navegar, «Analizar ahora»): el siguiente, dentro de un intervalo completo. */
    reiniciarCuenta() {
      ultima = reloj.ahora()
      if (activo && visible) programar(intervaloMs)
    },
    detener() {
      activo = false
      cancelar()
    },
  }
}
