// @ts-check
// El PIN se guarda una vez en el dispositivo (spec §12). Si localStorage no está disponible
// (modo privado), vive solo en memoria mientras la app siga abierta.
import { esBloqueo, pideLogin } from './api.js'

export const CLAVE_PIN = 'oracle.pin'

/** @typedef {{ getItem(clave: string): string|null, setItem(clave: string, valor: string): void, removeItem(clave: string): void }} Almacen */

/** @param {Almacen|null|undefined} almacen */
export function crearSesion(almacen) {
  /** @type {string|null} */
  let enMemoria = null
  return {
    /** @returns {string|null} */
    pin() {
      try {
        return almacen?.getItem(CLAVE_PIN) ?? enMemoria
      } catch {
        return enMemoria
      }
    },
    /** @param {string} pin */
    guardar(pin) {
      enMemoria = pin
      try {
        almacen?.setItem(CLAVE_PIN, pin)
      } catch {
        // sin almacenamiento persistente: queda en memoria
      }
    },
    olvidar() {
      enMemoria = null
      try {
        almacen?.removeItem(CLAVE_PIN)
      } catch {
        // nada que borrar
      }
    },
  }
}

/** @typedef {ReturnType<typeof crearSesion>} Sesion */

/**
 * Qué hace la sesión ante un error de la API. 401: olvida el PIN y toca volver al acceso ('login').
 * Bloqueo: conserva el PIN (puede ser el correcto: el bloqueo global lo provoca cualquiera) y se muestra
 * el aviso con su hora ('bloqueo'). Cualquier otro error no toca la sesión (null).
 * @param {unknown} e @param {Sesion} sesion
 * @returns {'login'|'bloqueo'|null}
 */
export function tratarErrorDeSesion(e, sesion) {
  if (pideLogin(e)) {
    sesion.olvidar()
    return 'login'
  }
  return esBloqueo(e) ? 'bloqueo' : null
}
