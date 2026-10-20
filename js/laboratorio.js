// @ts-check
// Pestaña «Laboratorio» del Backtest (spec del laboratorio §7): lectura defensiva de data/laboratorio.json, que
// genera scripts/laboratorio.mjs. Funciones puras: cualquier campo ausente o con otro tipo se enseña como «—» o se
// omite, nunca rompe la vista.
import { claseSigno, entero, euros, fecha, fechaHora, numero, porcentaje, VACIO } from './formato.js'

export const RUTA_LABORATORIO = 'data/laboratorio.json'
export const AVISO_FUTURO = 'Un resultado del pasado no garantiza el futuro.'

/**
 * data/laboratorio.json relativo a la página (vale bajo /ORACLE/). null si aún no existe (404). Un archivo marcado
 * `sintetico: true` (los datos inventados de los tests) nunca se enseña: lanza, aunque alguien lo copie a data/.
 * @param {typeof fetch} fetch
 * @returns {Promise<unknown|null>}
 */
export async function cargarLaboratorio(fetch) {
  const respuesta = await fetch(RUTA_LABORATORIO)
  if (respuesta.status === 404) return null
  if (!respuesta.ok) throw new Error(`${RUTA_LABORATORIO}: HTTP ${respuesta.status}`)
  const datos = await respuesta.json()
  if (datos?.sintetico === true) throw new Error(`${RUTA_LABORATORIO}: son datos sintéticos de prueba y no se muestran`)
  return datos
}

/** Nombres de las familias del laboratorio (spec del laboratorio §3); una familia desconocida se enseña tal cual. */
export const NOMBRES_FAMILIA = Object.freeze(/** @type {Record<string, string>} */ ({
  cruce: 'F1 Cruce de medias 1D',
  ruptura: 'F2 Ruptura de Donchian 1D',
  momentum: 'F3 Momentum 1D',
  caidas: 'F4 Caídas en tendencia 1D',
  v1stops: 'F5 v1 con stops amplios',
}))

/** Nombres de los parámetros de las configuraciones; uno desconocido se enseña tal cual. */
const NOMBRES_PARAMETRO = Object.freeze(/** @type {Record<string, string>} */ ({
  dias: 'días', revision: 'revisión', rapida: 'rápida', umbralRsi: 'umbral RSI(2)', multStopLoss: 'stop-loss × ATR',
  takeProfit: 'take-profit × ATR',
}))

/** @param {unknown} x @returns {x is Record<string, any>} */
const esObjeto = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
/** @param {unknown} x @returns {any[]} */
const lista = (x) => (Array.isArray(x) ? x : [])
/** @param {unknown} x */
const texto = (x) => (typeof x === 'string' ? x : '')
/** @param {unknown} x @returns {number|null} */
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
/** Número o texto como texto; cualquier otra cosa, ''. @param {unknown} x */
const escalar = (x) => (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)) ? String(x) : '')
/** @param {unknown} familia */
const nombreFamilia = (familia) => {
  const t = texto(familia)
  return Object.hasOwn(NOMBRES_FAMILIA, t) ? NOMBRES_FAMILIA[t] : t
}
/** Caída positiva (0,25 = −25 %) enseñada en negativo; sin caída, 0. @param {number|null} d */
const caida = (d) => (d !== null && d > 0 ? -d : d)

/**
 * Configuración de una familia ({ rapida: 20, lenta: 100 } → 'rapida 20 · lenta 100'). null = 'no' (p. ej. sin stop).
 * @param {unknown} config
 */
export function textoConfig(config) {
  if (typeof config === 'string') return config
  if (!esObjeto(config)) return ''
  return Object.entries(config)
    .map(([clave, valor]) => {
      const nombre = Object.hasOwn(NOMBRES_PARAMETRO, clave) ? NOMBRES_PARAMETRO[clave] : clave
      if (valor === null) return `${nombre} no`
      if (typeof valor === 'boolean') return `${nombre} ${valor ? 'sí' : 'no'}`
      const v = typeof valor === 'number' && Number.isFinite(valor) && !Number.isInteger(valor) ? numero(valor, 1) : escalar(valor)
      return v === '' ? '' : `${nombre} ${v}`
    })
    .filter(Boolean)
    .join(' · ')
}

/**
 * Años de prueba: [2020, 2021], [{ prueba: 2020 }, …] o, como los escribe scripts/laboratorio.mjs,
 * [{ ano: 2019, prueba: false }, { ano: 2020, prueba: true }, …] (solo los de prueba) → '2020, 2021'.
 * @param {unknown} tramos
 */
export function textoTramos(tramos) {
  return lista(tramos)
    .map((t) => {
      if (!esObjeto(t)) return escalar(t)
      if (typeof t.prueba === 'boolean') return t.prueba ? escalar(t.ano ?? t.anio ?? t.año) : ''
      return escalar(t.prueba ?? t.ano ?? t.anio ?? t.año)
    })
    .filter(Boolean)
    .join(', ')
}

/** @param {unknown} c texto o { texto | descripcion } */
const unCriterio = (c) => (typeof c === 'string' ? c : esObjeto(c) ? texto(c.texto) || texto(c.descripcion) : '')

/** Puntos del criterio: un texto, un objeto o la lista [{ id, texto }] de scripts/laboratorio.mjs. @param {unknown} criterio */
const textosCriterio = (criterio) => (Array.isArray(criterio) ? criterio : [criterio]).map(unCriterio).filter(Boolean)

/**
 * Una estrategia desplegada: 'v3' o { version, familia, config, experimental }.
 * @param {unknown} s
 * @param {Map<string, boolean|null>} cumplePorVersion criterio del ranking por versión
 */
function lecturaSeleccion(s, cumplePorVersion) {
  const o = typeof s === 'string' ? { version: s } : esObjeto(s) ? s : {}
  const version = texto(o.version)
  const textoS = [version, nombreFamilia(o.familia), textoConfig(o.config)].filter(Boolean).join(' · ')
  return { version, texto: textoS, experimental: o.experimental === true, cumple: cumplePorVersion.get(version) ?? null }
}

/** 'a', 'a y b', 'a, b y c'. @param {string[]} xs */
const enumerar = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`)

/**
 * Qué familias cumplen el criterio y cuáles se despliegan como experimentales, en una frase.
 * @param {{ version: string, familia: string, cumple: boolean|null }[]} ranking
 * @param {{ version: string, experimental: boolean }[]} seleccion
 */
function conclusionLaboratorio(ranking, seleccion) {
  if (ranking.length === 0) return ''
  const nombre = (/** @type {{ version: string, familia: string }} */ r) => (r.version ? `${r.version} (${r.familia})` : r.familia)
  const ganadoras = ranking.filter((r) => r.cumple === true).map(nombre)
  const experimentales = seleccion.filter((s) => s.experimental).map((s) => s.version).filter(Boolean)
  const cumplen = ganadoras.length === 0
    ? 'Ninguna familia cumple todos los puntos del criterio.'
    : `${ganadoras.length === 1 && ranking.length > 1 ? 'Solo ' : ''}${enumerar(ganadoras)} ${ganadoras.length === 1 ? 'cumple' : 'cumplen'} todos los puntos del criterio.`
  if (experimentales.length === 0) return cumplen
  const una = experimentales.length === 1
  return `${cumplen} ${enumerar(experimentales)} ${una ? 'va' : 'van'} al bot como ${una ? 'experimental' : 'experimentales'} para completar `
    + `las ${seleccion.length} en vivo: ${una ? 'no lo cumple' : 'no lo cumplen'}.`
}

/**
 * Un valor del tramo reservado según su clave: rentabilidades y caídas en %, fechas en ms como fecha.
 * @param {string} clave @param {unknown} valor
 */
function valorReservado(clave, valor) {
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no'
  if (typeof valor === 'string') return valor
  const n = num(valor)
  if (n === null) return VACIO
  if (/drawdown|caida|caída/i.test(clave)) return porcentaje(caida(n))
  if (/rentabilidad|hodl/i.test(clave)) return porcentaje(n, { signo: true })
  if (/desde|hasta|inicio|fin/i.test(clave) && n > 1e11) return fecha(n)
  if (/operaciones/i.test(clave) && Number.isInteger(n)) return entero(n)
  return numero(n, 2)
}

/** Etiquetas de las claves sueltas del tramo reservado. */
const NOMBRES_RESERVADO = Object.freeze(/** @type {Record<string, string>} */ ({ desde: 'Desde', hasta: 'Hasta', monedas: 'Monedas' }))

/**
 * Tramo reservado como filas etiqueta → valor: los valores sueltos, las listas de textos unidas por comas y, un nivel
 * por debajo, los de cada objeto ('v3 · rentabilidad'). `porVersion` va aparte (reservadoPorVersion).
 * @param {unknown} reservado
 * @returns {{ etiqueta: string, valor: string }[]}
 */
export function filasReservado(reservado) {
  if (!esObjeto(reservado)) return []
  return Object.entries(reservado).flatMap(([clave, valor]) => {
    if (clave === 'porVersion') return []
    const etiqueta = Object.hasOwn(NOMBRES_RESERVADO, clave) ? NOMBRES_RESERVADO[clave] : clave
    if (Array.isArray(valor)) {
      const textos = valor.filter((v) => typeof v === 'string' && v !== '')
      return textos.length > 0 && textos.length === valor.length ? [{ etiqueta, valor: textos.join(', ') }] : []
    }
    if (esObjeto(valor)) {
      return Object.entries(valor)
        .filter(([, v]) => !esObjeto(v) && !Array.isArray(v) && v !== null && v !== undefined)
        .map(([k, v]) => ({ etiqueta: `${clave} · ${k}`, valor: valorReservado(k, v) }))
    }
    if (valor === null || valor === undefined) return []
    return [{ etiqueta, valor: valorReservado(clave, valor) }]
  })
}

/**
 * Resultado de cada estrategia desplegada en el tramo reservado (`reservado.porVersion`), en el orden del archivo.
 * @param {unknown} reservado
 * @param {Set<string>} experimentales versiones desplegadas como experimentales
 */
export function reservadoPorVersion(reservado, experimentales = new Set()) {
  const porVersion = esObjeto(reservado) && esObjeto(reservado.porVersion) ? reservado.porVersion : {}
  return Object.entries(porVersion).filter(([, r]) => esObjeto(r)).map(([version, r]) => ({
    version,
    experimental: experimentales.has(version),
    rentabilidad: porcentaje(num(r.rentabilidad), { signo: true }),
    clase: claseSigno(num(r.rentabilidad)),
    caida: porcentaje(caida(num(r.drawdownMaximo))),
    operaciones: num(r.operaciones) === null ? VACIO : entero(num(r.operaciones)),
    rentabilidadHodl: porcentaje(num(r.rentabilidadHodl), { signo: true }),
    caidaHodl: porcentaje(caida(num(r.drawdownMaximoHodl))),
  }))
}

/**
 * Un puesto del ranking listo para pintar.
 * @param {Record<string, any>} r
 * @param {number} i posición (0 = primero)
 * @param {Set<string>} experimentales versiones desplegadas como experimentales
 */
function lecturaPuesto(r, i, experimentales) {
  const oos = esObjeto(r.oos) ? r.oos : {}
  const criterio = esObjeto(r.criterio) ? r.criterio : {}
  const rentabilidad = num(oos.rentabilidad)
  const cumple = typeof criterio.cumple === 'boolean' ? criterio.cumple : null
  return {
    posicion: i + 1,
    familia: nombreFamilia(r.familia) || `Familia ${i + 1}`,
    version: texto(r.version),
    experimental: r.experimental === true || experimentales.has(texto(r.version)),
    operaciones: num(oos.operaciones) === null ? VACIO : entero(num(oos.operaciones)),
    config: textoConfig(r.config),
    rentabilidad: porcentaje(rentabilidad, { signo: true }),
    claseRentabilidad: claseSigno(rentabilidad),
    caida: porcentaje(caida(num(oos.drawdownMaximo))),
    rentabilidadHodl: porcentaje(num(oos.rentabilidadHodl), { signo: true }),
    caidaHodl: porcentaje(caida(num(oos.drawdownMaximoHodl))),
    cumple,
    textoCumple: cumple === true ? 'Cumple' : cumple === false ? 'No cumple' : VACIO,
    puntos: lista(criterio.puntos).filter(esObjeto).map((p) => ({
      texto: texto(p.texto) || escalar(p.id) || VACIO,
      cumple: p.cumple === true,
      marca: p.cumple === true ? '✓ Cumple' : p.cumple === false ? '✗ No cumple' : VACIO,
    })),
    porAno: lista(oos.porAno).filter(esObjeto).map((a) => ({
      ano: escalar(a.ano ?? a.anio ?? a.año) || VACIO,
      rentabilidad: porcentaje(num(a.rentabilidad), { signo: true }),
      hodl: porcentaje(num(a.hodl), { signo: true }),
      clase: claseSigno(num(a.rentabilidad)),
    })),
    porMoneda: Object.entries(esObjeto(oos.porMoneda) ? oos.porMoneda : {}).map(([simbolo, b]) => ({
      simbolo,
      beneficio: euros(num(b), { signo: true }),
      positivo: num(b) === null ? VACIO : /** @type {number} */ (num(b)) > 0 ? 'Sí' : 'No',
      clase: claseSigno(num(b)),
    })),
  }
}

/**
 * Todo lo que enseña la pestaña Laboratorio a partir de data/laboratorio.json, sin fiarse de su forma.
 * @param {unknown} lab
 */
export function lecturaLaboratorio(lab) {
  const l = esObjeto(lab) ? lab : {}
  const crudas = lista(l.seleccion).filter((s) => typeof s === 'string' || esObjeto(s))
  const experimentales = new Set(crudas.filter((s) => esObjeto(s) && s.experimental === true).map((s) => texto(s.version)).filter(Boolean))
  const ranking = lista(l.ranking).filter(esObjeto).map((r, i) => lecturaPuesto(r, i, experimentales))
  /** @type {Map<string, boolean|null>} */
  const cumplePorVersion = new Map(ranking.filter((r) => r.version).map((r) => [r.version, r.cumple]))
  const seleccion = crudas.map((s) => lecturaSeleccion(s, cumplePorVersion)).filter((s) => s.texto)
  const aviso = texto(l.aviso)
  const generado = typeof l.generadoEn === 'string' ? Date.parse(l.generadoEn) : Number.NaN
  return {
    generado: Number.isNaN(generado) ? VACIO : fechaHora(generado),
    datosHasta: num(l.datosHasta) === null ? VACIO : fecha(num(l.datosHasta)),
    aviso: aviso.includes(AVISO_FUTURO.slice(0, -1)) ? aviso : `${aviso}${aviso ? ' ' : ''}${AVISO_FUTURO}`,
    criterio: textosCriterio(l.criterio),
    tramos: textoTramos(l.tramos) || VACIO,
    familias: lista(l.familias).length,
    ranking,
    ganadoras: ranking.filter((r) => r.cumple === true).length,
    conclusion: conclusionLaboratorio(ranking, seleccion),
    seleccion,
    reservado: filasReservado(l.reservado),
    reservadoPorVersion: reservadoPorVersion(l.reservado, experimentales),
  }
}
