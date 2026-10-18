// @ts-check
// Peticiones HTTP que siempre leen o cancelan el cuerpo de la respuesta, también en los errores: un cuerpo
// sin consumir mantiene ocupada la conexión y Workers acaba cortándolo («A stalled HTTP response was
// canceled to prevent deadlock»), lo que puede bloquear las demás subpeticiones de la ejecución.

/**
 * Cancela el cuerpo de una respuesta que no se va a leer. Nunca lanza.
 * @param {Response} res
 */
export async function descartarCuerpo(res) {
  try {
    await res.body?.cancel()
  } catch {
    // El cuerpo ya estaba leído, cancelado o roto: no queda nada que liberar.
  }
}

/**
 * GET (o lo que diga `init`) que exige un 2xx. Con otro estado cancela el cuerpo y lanza `HTTP <estado>`.
 * @param {typeof fetch} fetch
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function pedirOk(fetch, url, init) {
  const res = init === undefined ? await fetch(url) : await fetch(url, init)
  if (!res.ok) {
    await descartarCuerpo(res)
    throw new Error(`HTTP ${res.status}`)
  }
  return res
}

/**
 * Cuerpo JSON de una respuesta 2xx (leído entero).
 * @param {typeof fetch} fetch
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
export async function pedirJson(fetch, url, init) {
  return (await pedirOk(fetch, url, init)).json()
}

/**
 * Cuerpo de texto de una respuesta 2xx (leído entero).
 * @param {typeof fetch} fetch
 * @param {string} url
 * @param {RequestInit} [init]
 */
export async function pedirTexto(fetch, url, init) {
  return (await pedirOk(fetch, url, init)).text()
}
