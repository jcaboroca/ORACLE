// @ts-check
// Arranque de la PWA: sesión con PIN, rutas por hash, refresco cada 5 min solo con la página visible,
// avisos y service worker. Las vistas construyen su DOM; aquí solo se orquesta.
import { baseApi } from '../config.js'
import { crearApi, mensajeError, pideLogin } from './api.js'
import { aviso, h } from './dom.js'
import { crearRefresco } from './refresco.js'
import { hashDe, leerRuta, seccionDe } from './rutas.js'
import { crearSesion } from './sesion.js'
import { vistaBacktest } from './vistas/backtest.js'
import { vistaBot } from './vistas/bot.js'
import { vistaLogin } from './vistas/login.js'
import { vistaMoneda } from './vistas/moneda.js'
import { vistaPanel } from './vistas/panel.js'

/** @typedef {import('./vistas/comun.js').Contexto} Contexto */

const VISTAS = { login: vistaLogin, panel: vistaPanel, moneda: vistaMoneda, bot: vistaBot, backtest: vistaBacktest }
/** Vistas con datos vivos: se refrescan cada 5 min (el backtest es estático y el acceso no tiene datos). */
const REFRESCABLES = new Set(['panel', 'moneda', 'bot'])

const principal = /** @type {HTMLElement} */ (document.getElementById('principal'))
const estado = /** @type {HTMLElement} */ (document.getElementById('estado'))
const salir = /** @type {HTMLButtonElement} */ (document.getElementById('salir'))
const navegacion = /** @type {HTMLElement} */ (document.querySelector('.navegacion'))

/** @type {typeof fetch} */
const fetchNavegador = (entrada, init) => fetch(entrada, init)

/** @returns {Storage|null} */
function almacenLocal() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const sesion = crearSesion(almacenLocal())
const base = baseApi(location)
const apiBase = crearApi({ base, fetch: fetchNavegador, pin: () => sesion.pin() })
/** Desfase entre el reloj del servidor y el del dispositivo («hace 5 min» con la hora del Worker). */
let desfase = 0
const api = {
  ...apiBase,
  async resumen() {
    const r = await apiBase.resumen()
    desfase = r.ahora - Date.now()
    return r
  },
}

let turno = 0
/** @type {(() => void)[]} */
let limpiezas = []
/** @type {string|null} */
let mensajeLogin = null
/** @type {ReturnType<typeof setTimeout>|undefined} */
let temporizadorAviso

/** @param {string} texto @param {'info'|'error'} [tipo] */
function avisar(texto, tipo = 'info') {
  estado.replaceChildren(aviso(texto, tipo))
  clearTimeout(temporizadorAviso)
  temporizadorAviso = setTimeout(() => estado.replaceChildren(), 8000)
}

/** @param {string} hash */
function navegar(hash) {
  if (location.hash === hash) pintar()
  else location.hash = hash
}

/** @param {unknown} e */
function exigirPin(e) {
  if (!pideLogin(e)) return false
  sesion.olvidar()
  mensajeLogin = mensajeError(e)
  navegar(hashDe('login'))
  return true
}

/** @param {string} pin */
async function entrar(pin) {
  await crearApi({ base, fetch: fetchNavegador, pin: () => pin }).resumen()
  sesion.guardar(pin)
  mensajeLogin = null
  navegar(hashDe('panel'))
}

/** @param {import('./rutas.js').Ruta} ruta */
function marcarNavegacion(ruta) {
  const seccion = seccionDe(ruta)
  for (const enlace of navegacion.querySelectorAll('a')) {
    if (enlace.getAttribute('data-seccion') === seccion) enlace.setAttribute('aria-current', 'page')
    else enlace.removeAttribute('aria-current')
  }
  const conPin = sesion.pin() !== null
  navegacion.hidden = !conPin
  salir.hidden = !conPin
}

/**
 * Pinta la ruta actual. Si llega otra navegación mientras carga, gana la última.
 * @param {{ refresco?: boolean }} [op] refresco: conserva el desplazamiento y no mueve el foco
 */
async function pintar({ refresco = false } = {}) {
  const ruta = leerRuta(location.hash)
  if (!sesion.pin() && ruta.vista !== 'login') {
    location.replace(hashDe('login'))
    return
  }
  const mio = ++turno
  marcarNavegacion(ruta)
  principal.setAttribute('aria-busy', 'true')
  /** @type {Contexto} */
  const ctx = {
    api, ruta, fetch: fetchNavegador, ahora: () => Date.now() + desfase, navegar, avisar, entrar, mensajeLogin,
    refrescar: () => pintar({ refresco: true }), exigirPin,
  }
  /** @type {import('./vistas/comun.js').Pantalla} */
  let pantalla
  try {
    pantalla = await VISTAS[ruta.vista](ctx)
  } catch (e) {
    if (mio === turno && exigirPin(e)) return
    pantalla = { titulo: 'Error', nodo: h('div', { class: 'vista' }, aviso(mensajeError(e), 'error')) }
  }
  if (mio !== turno) return
  for (const limpiar of limpiezas.splice(0)) limpiar()
  const y = window.scrollY
  principal.replaceChildren(pantalla.nodo)
  principal.removeAttribute('aria-busy')
  document.title = `${pantalla.titulo} · ORACLE`
  const limpiar = pantalla.montar?.()
  if (typeof limpiar === 'function') limpiezas.push(limpiar)
  if (refresco) {
    window.scrollTo(0, y)
  } else {
    window.scrollTo(0, 0)
    if (!principal.contains(document.activeElement)) /** @type {HTMLElement|null} */ (principal.querySelector('h2'))?.focus()
  }
}

const refresco = crearRefresco({
  reloj: { ahora: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(/** @type {number} */ (id)) },
  accion: () => {
    const ruta = leerRuta(location.hash)
    // Un diálogo abierto (reinicio) o un control con el foco no se pisan con un refresco.
    const ocupado = document.querySelector('dialog[open]') || document.activeElement?.matches('input, select, textarea')
    if (!REFRESCABLES.has(ruta.vista) || !sesion.pin() || ocupado) return
    return pintar({ refresco: true })
  },
})

window.addEventListener('hashchange', () => {
  pintar()
  refresco.reiniciarCuenta()
})
document.addEventListener('visibilitychange', () => refresco.visibilidad(document.visibilityState === 'visible'))
salir.addEventListener('click', () => {
  sesion.olvidar()
  mensajeLogin = null
  navegar(hashDe('login'))
})

if (!base) avisar('Falta la URL del Worker en config.js (API_PRODUCCION): la app no puede pedir datos.', 'error')
pintar()
refresco.iniciar()
refresco.visibilidad(document.visibilityState === 'visible')

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Sin service worker la app funciona igual, solo que no se instala sin conexión.
  })
}
