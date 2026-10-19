// @ts-check
// El PIN se guarda una vez en el dispositivo (spec §12). Si localStorage no está disponible
// (modo privado), vive solo en memoria mientras la app siga abierta.

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
