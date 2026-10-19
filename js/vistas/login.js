// @ts-check
// Acceso con PIN (spec §12): se pide una vez y queda guardado en el dispositivo.
import { mensajeError } from '../api.js'
import { aviso, h } from '../dom.js'
import { cabecera } from './comun.js'

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaLogin(ctx) {
  const mensaje = h('div', { class: 'login-mensaje', 'aria-live': 'assertive' },
    ctx.mensajeLogin ? aviso(ctx.mensajeLogin, 'error') : null)
  const campo = h('input', {
    id: 'pin', name: 'pin', type: 'password', autocomplete: 'current-password', required: true, enterkeyhint: 'go',
    'aria-describedby': 'pin-ayuda',
  })
  const boton = h('button', { type: 'submit', class: 'boton boton-principal' }, 'Entrar')
  const formulario = h('form', { class: 'login', novalidate: true },
    h('label', { for: 'pin' }, 'PIN'),
    campo,
    h('p', { id: 'pin-ayuda', class: 'ayuda' }, 'El PIN del Worker (secret ORACLE_PIN). Se guarda solo en este dispositivo.'),
    boton,
    mensaje)
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    const pin = campo.value.trim()
    if (!pin) {
      mensaje.replaceChildren(aviso('Escribe el PIN.', 'error'))
      campo.focus()
      return
    }
    boton.disabled = true
    boton.textContent = 'Comprobando…'
    try {
      await ctx.entrar(pin)
    } catch (e) {
      mensaje.replaceChildren(aviso(mensajeError(e), 'error'))
      campo.select()
      campo.focus()
    } finally {
      boton.disabled = false
      boton.textContent = 'Entrar'
    }
  })
  const nodo = h('div', { class: 'vista vista-login' },
    cabecera('Acceso'),
    h('p', null, 'ORACLE analiza BTC, ETH, SOL, BNB y XRP cada hora y simula un bot de paper trading con dinero virtual.'),
    formulario)
  return { titulo: 'Acceso', nodo, montar: () => { campo.focus() } }
}
