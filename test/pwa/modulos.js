// @ts-check
// Grafo de módulos de la PWA para los tests: lo que el navegador descarga a partir de js/app.js. Solo tests.
import { readFileSync } from 'node:fs'

export const RAIZ = new URL('../../', import.meta.url)

/** Contenido de un archivo del repositorio. @param {string} ruta relativa a la raíz */
export const leer = (ruta) => readFileSync(new URL(ruta, RAIZ), 'utf8')

/** Imports estáticos de un módulo (no los `import('…')` de los comentarios JSDoc). @param {string} fuente */
export const importsDe = (fuente) => [...fuente.matchAll(/^import\s[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1])

/** Todos los módulos que carga el navegador a partir de js/app.js, como rutas relativas a la raíz, ordenados. */
export function modulosDeLaApp() {
  const vistos = new Set()
  const pendientes = ['js/app.js']
  while (pendientes.length > 0) {
    const ruta = /** @type {string} */ (pendientes.pop())
    if (vistos.has(ruta)) continue
    vistos.add(ruta)
    for (const destino of importsDe(leer(ruta))) {
      pendientes.push(new URL(destino, new URL(ruta, 'https://x/')).pathname.slice(1))
    }
  }
  return [...vistos].sort()
}
