// TV remote: the arrow keys move between buttons, cards and fields by where they sit on the screen (the
// nearest one in that direction), OK presses, Back goes back (handled in api.ts). The focused element
// scrolls into view and gets a clear frame (mobile.css, html.tv).
const FOCUSABLE = 'button:not(:disabled), a[href], input:not([type=hidden]):not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])'

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  if (r.width < 4 || r.height < 4) return false
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
}

/** The open dialog / menu / panel keeps the focus inside it (the last opened one when there are several). */
const LAYERS = '.tvpick, .exitask, .whopick, .ctxmenu, .pmenu-pop, .modal-back, .dialog, .sheet'
function scope(): ParentNode {
  for (const sel of LAYERS.split(', ')) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el && visible(el)) return el
  }
  return document
}

/** Things the remote skips: the header's logo and arrows (the remote has Back), drag arrows on rows, the
 *  search text box itself (its button opens it: moving over it no longer pops up the keyboard), the banner's tags. */
const skip = (el: HTMLElement) =>
  !!el.closest('.hero3 .pills, .navarrows') || el.matches('.dragarrow, .logo') || (el.matches('#search') && document.activeElement !== el)
const candidates = () => [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => visible(el) && !skip(el))

function move(dir: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', from?: HTMLElement) {
  const cur = from ?? (document.activeElement as HTMLElement | null)
  // the banner's genre / format tags are left out: Down from the top goes straight to Play
  const all = candidates()
  if (!all.length) return
  // a menu / dialog just opened: start inside it
  if (scope() !== document && (!cur || !(scope() as HTMLElement).contains(cur))) return void focus(all[0])
  // focus dropped but the element is still there (the WebView took the focus back for a moment): go on from it
  if ((!cur || cur === document.body) && lastEl?.isConnected && all.includes(lastEl)) return void move.call(null, dir, lastEl)
  // focus lost (the element under it went away): carry on from where it was
  if (!cur || cur === document.body || !all.includes(cur)) {
    if (!last) return void focus(all[0])
    const lx = last.left + last.width / 2, ly = last.top + last.height / 2
    const near = (el: HTMLElement) => { const b = el.getBoundingClientRect(); return Math.hypot(b.left + b.width / 2 - lx, b.top + b.height / 2 - ly) }
    return void focus(all.reduce((p, el) => (near(el) < near(p) ? el : p)))
  }
  // Up / Down stay in the column they are in (settings list | settings, Keşfet's filters | results, the
  // anime page's side | main), and only cross to the next column when there is nothing more above / below
  if (dir === 'ArrowUp' || dir === 'ArrowDown') {
    const col = cur.closest(COLUMNS)
    if (col) {
      const inCol = pick(all.filter(el => el !== cur && col.contains(el)), cur, dir)
      if (inCol) return void focus(inCol)
    }
  }
  // Between the header and the page: Up from the page stays in the page while there is anything above (the
  // part scrolled away under the header included), and only then goes to the header; Down from the header
  // goes to the top of the page, not to whatever happens to sit below it on screen.
  const content = document.querySelector('.content')
  if (content && scope() === document) {
    const inPage = content.contains(cur)
    if (!inPage && dir === 'ArrowDown') {
      const top = all.filter(el => content.contains(el)).sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      const ct = content.getBoundingClientRect().top
      // the first item of the page that is not scrolled away, else the very first
      const first = top.find(el => el.getBoundingClientRect().bottom > ct + 4) ?? top[0]
      if (first) return void focus(first)
    }
    if (inPage && dir === 'ArrowUp') {
      const a0 = cur.getBoundingClientRect()
      const above = all.filter(el => content.contains(el) && el !== cur && el.getBoundingClientRect().bottom <= a0.top + 4)
      if (!above.length) return void focus(nearestIn(all.filter(el => !content.contains(el)), a0) ?? cur)
      return void focus(pick(above, cur, dir))
    }
  }
  const best = pick(all, cur, dir)
  if (best) focus(best)
}

/** Side-by-side columns of a page. */
const COLUMNS = '.settings-nav, .settings-main, .filters, .discover > :not(.filters), .d2-side, .d2-main'

function nearestIn(list: HTMLElement[], r: DOMRect) {
  const x = r.left + r.width / 2
  let best: HTMLElement | null = null
  let bd = Infinity
  for (const el of list) {
    const b = el.getBoundingClientRect()
    const d = Math.abs(b.left + b.width / 2 - x)
    if (d < bd) (bd = d), (best = el)
  }
  return best
}

/** The nearest element in that direction (Android's FocusFinder rule). */
function pick(all: HTMLElement[], cur: HTMLElement, dir: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') {
  const a = cur.getBoundingClientRect()
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of all) {
    if (el === cur) continue
    const b = el.getBoundingClientRect()
    const bx = b.left + b.width / 2, by = b.top + b.height / 2
    // Android's own rule (FocusFinder): distance along the arrow counts 13× more than off to the side;
    // off to the side is measured between the edges, so a wide item right below counts as straight below
    let main: number, side: number
    if (dir === 'ArrowRight') (main = b.left - a.right), (side = Math.max(0, b.top - a.bottom, a.top - b.bottom) + Math.abs(by - ay) * 0.1)
    else if (dir === 'ArrowLeft') (main = a.left - b.right), (side = Math.max(0, b.top - a.bottom, a.top - b.bottom) + Math.abs(by - ay) * 0.1)
    else if (dir === 'ArrowDown') (main = b.top - a.bottom), (side = Math.max(0, b.left - a.right, a.left - b.right) + Math.abs(bx - ax) * 0.1)
    else (main = a.top - b.bottom), (side = Math.max(0, b.left - a.right, a.left - b.right) + Math.abs(bx - ax) * 0.1)
    if (main < -4) continue
    // left / right stay in the same row (else the end of the header jumped to a row of cards far below)
    if ((dir === 'ArrowLeft' || dir === 'ArrowRight') && (b.bottom <= a.top + 2 || b.top >= a.bottom - 2)) continue
    const score = 13 * Math.max(0, main) ** 2 + side ** 2
    if (score < bestScore) (bestScore = score), (best = el)
  }
  return best
}

/** Where the focus last was (on screen), for when the element under it goes away. */
let last: DOMRect | null = null
let lastEl: HTMLElement | null = null
let lostAt = 0
/** What the remote last moved to (Android's own focus moves don't count): the place to go back to. */
let chosen: HTMLElement | null = null

/** The page is drawn at a zoom on a TV (mobile.css): screen distances are that much smaller than CSS ones. */
const zoom = () => parseFloat(getComputedStyle(document.documentElement).zoom) || 1

function scroller(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    const o = axis === 'y' ? s.overflowY : s.overflowX
    if (/(auto|scroll)/.test(o) && (axis === 'y' ? p.scrollHeight > p.clientHeight + 2 : p.scrollWidth > p.clientWidth + 2)) return p
  }
  return null
}

/**
 * Focus, and bring it into view like a TV app: the row it is in moves to the middle of the screen (what is
 * above and below stays in sight); anything near the top of the page scrolls the page back to the very top
 * (the banner, the header); in a sideways row the cards slide along.
 */
let lastMove = 0

function focus(el: HTMLElement) {
  // held / fast presses scroll at once: a new smooth scroll on every press stuttered and crawled
  const now = performance.now()
  const behavior: ScrollBehavior = now - lastMove < 280 ? 'auto' : 'smooth'
  lastMove = now
  lastEl = chosen = el
  el.focus({ preventScroll: true })
  const z = zoom()
  const r = el.getBoundingClientRect()
  const hs = scroller(el, 'x')
  if (hs) {
    const sr = hs.getBoundingClientRect()
    const pad = 48 * z
    if (r.left < sr.left + pad) hs.scrollBy({ left: (r.left - sr.left - pad) / z, behavior })
    else if (r.right > sr.right - pad) hs.scrollBy({ left: (r.right - sr.right + pad) / z, behavior })
  }
  const vs = scroller(el, 'y')
  // something that stays put while the page scrolls (Keşfet's filters, the settings list): the page stays too
  let fixedPart = false
  for (let p: HTMLElement | null = el; p && p !== vs; p = p.parentElement) if (/sticky|fixed/.test(getComputedStyle(p).position)) fixedPart = true
  if (vs && !fixedPart) {
    const sr = vs.getBoundingClientRect()
    const y = (r.top - sr.top) / z + vs.scrollTop // where it is on the page, in the page's own units
    const h = r.height / z
    const top = y < vs.clientHeight * 0.55 ? 0 : y + h / 2 - vs.clientHeight * 0.5
    if (Math.abs(top - vs.scrollTop) > 4) vs.scrollTo({ top, behavior })
  }
}

const isText = (t: Element | null): t is HTMLInputElement | HTMLTextAreaElement =>
  !!t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes((t as HTMLInputElement).type)))

/** Set a form value the way typing would (React only notices values set through the element's own setter). */
function setValue(el: HTMLInputElement | HTMLSelectElement, v: string, ev: 'input' | 'change') {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event(ev, { bubbles: true }))
}

/**
 * One remote key. On a TV the app's Android side sends every arrow and OK here (MainActivity: inside a text
 * box the WebView kept them, and the first press of all got lost); a keyboard on other devices comes through
 * the keydown listener below. Answers true when the key was used.
 */
function tvKey(key: string): boolean {
  const t = document.activeElement as HTMLElement | null
  if (key.startsWith('Arrow')) {
    // sliders: left / right change the value
    if (t instanceof HTMLInputElement && t.type === 'range' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const step = Number(t.step) || 1
      const v = Math.min(Number(t.max || 100), Math.max(Number(t.min || 0), Number(t.value) + (key === 'ArrowRight' ? step : -step)))
      setValue(t, String(v), 'input')
      return true
    }
    move(key as any)
    return true
  }
  if (key === 'ContextMenu') {
    // OK held: the menu a right click opens on a computer (add to list, hide…)
    if (!t || t === document.body) return false
    const r = t.getBoundingClientRect()
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
    return true
  }
  if (key === 'Enter') {
    if (!t || t === document.body) return false
    // lists open a picker with every choice (they used to step to the next choice on each press)
    if (t instanceof HTMLSelectElement) return void openPicker(t), true
    // the search button: open the box and the TV's keyboard
    if (t.matches('.searchbox')) {
      const input = t.querySelector<HTMLInputElement>('#search')
      if (input) (input.focus(), (window as any).AnisakiTV?.keyboard?.())
      return true
    }
    if (isText(t)) return false // the Android side brings up the keyboard
    t.click()
    return true
  }
  return false
}

/** A list's choices as big buttons (TV): pick one with OK, Back closes. */
function openPicker(sel: HTMLSelectElement) {
  document.querySelector('.tvpick')?.remove()
  const box = document.createElement('div')
  box.className = 'tvpick'
  const label = sel.closest('label')?.firstChild?.textContent?.trim() || sel.getAttribute('aria-label') || ''
  box.innerHTML = `<div class="tvpick-panel" role="listbox"><h3></h3><div class="tvpick-list"></div></div>`
  box.querySelector('h3')!.textContent = label
  const list = box.querySelector('.tvpick-list')!
  let current: HTMLElement | null = null
  for (const o of [...sel.options]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = o.textContent
    if (o.selected) (b.setAttribute('aria-selected', 'true'), (current = b))
    b.onclick = () => {
      setValue(sel, o.value, 'change')
      box.remove()
      focus(sel)
    }
    list.appendChild(b)
  }
  box.onclick = e => e.target === box && (box.remove(), focus(sel))
  document.body.appendChild(box)
  focus(current ?? (list.firstElementChild as HTMLElement))
}

/** Closes the topmost picker / menu / dialog; false when nothing was open. */
export function closeLayer(): boolean {
  const pick = document.querySelector('.tvpick, .exitask')
  if (pick) return pick.remove(), (chosen?.isConnected ? focus(chosen) : undefined), true
  if (document.querySelector('.pmenu-pop')) return document.querySelector<HTMLElement>('.pmenu-btn')?.click(), true
  if (document.querySelector('.ctxmenu, .modal-back, .dialog, .sheet, .shist')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.activeElement instanceof HTMLElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  }
  return false
}

/** "Uygulamadan çıkılsın mı?" (Back on the home page) */
export function askExit(exit: () => void) {
  if (document.querySelector('.exitask')) return
  const box = document.createElement('div')
  box.className = 'exitask tvpick'
  box.innerHTML = `<div class="tvpick-panel"><h3>Uygulamadan çıkılsın mı?</h3><div class="exitask-row"><button type="button" data-a="no">Vazgeç</button><button type="button" data-a="yes">Çık</button></div></div>`
  box.querySelector<HTMLElement>('[data-a=no]')!.onclick = () => closeLayer()
  box.querySelector<HTMLElement>('[data-a=yes]')!.onclick = () => exit()
  box.onclick = e => e.target === box && closeLayer()
  document.body.appendChild(box)
  const no = box.querySelector<HTMLElement>('[data-a=no]')!
  if (isTvMode) focus(no)
}
let isTvMode = false

export function startTvNavigation() {
  isTvMode = true
  // the search box is a button on a TV (OK opens it): it can have the focus without its text box
  const markSearch = () => document.querySelector('.searchbox')?.setAttribute('tabindex', '0')
  markSearch()
  new MutationObserver(markSearch).observe(document.body, { childList: true, subtree: true })
  ;(window as any).__tvKey = tvKey
  ;(window as any).__tvRefocus = () => {
    const el = chosen
    if (el?.isConnected && visible(el) && document.activeElement !== el) (el.focus({ preventScroll: true }), (lastEl = el))
  }
  // tell the Android side when a text box has the focus (its left / right move the cursor there)
  const bridge = () => (window as any).AnisakiTV as { typing(b: boolean): void } | undefined
  document.addEventListener('focusin', e => bridge()?.typing(isText(e.target as Element)))
  document.addEventListener('focusout', () => setTimeout(() => bridge()?.typing(isText(document.activeElement)), 0))
  document.addEventListener(
    'keydown',
    e => {
      const t = e.target as HTMLElement
      // inside a text box left / right move the cursor; up / down leave it
      if (isText(t) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) return
      if (e.key.startsWith('Arrow') || e.key === 'Enter') {
        if (tvKey(e.key)) e.preventDefault()
      }
    },
    true
  )
  document.addEventListener('focusin', e => { if (e.target instanceof HTMLElement && e.target !== document.body) lastEl = e.target })
  // where the focus was, measured when it is needed (the page may have scrolled since)
  document.addEventListener('focusout', e => { if (e.target instanceof HTMLElement && e.target.isConnected) last = e.target.getBoundingClientRect() })
  // Focus lost (back from the player, another page opened, the focused button went away): after a moment
  // it goes to the page's main button, else to whatever is nearest to where it was. Never left nowhere.
  setInterval(() => {
    if (!document.hasFocus() || document.querySelector('.whopick')) return
    const a = document.activeElement
    // a menu / dialog opened (profile menu, long-press menu…): the remote goes into it
    const layer = scope()
    if (layer !== document && !(layer as HTMLElement).contains(a)) {
      const first = candidates()[0]
      if (first) return focus(first)
    }
    if (a && a !== document.body && a.isConnected) return void (lostAt = 0)
    if (!lostAt) lostAt = Date.now()
    // back from the player on the same page: where it was
    if (lastEl?.isConnected && visible(lastEl) && scope().contains(lastEl)) return focus(lastEl)
    const main = document.querySelector<HTMLElement>('.content [data-tv-start], .content .pill-play, .content .btn.primary')
    if (main && visible(main)) return focus(main)
    // a page still loading gets a few seconds to show its main button
    if (Date.now() - lostAt < 3500) return
    const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
    if (!all.length) return
    if (!last) return focus(all[0])
    const lx = last.left + last.width / 2, ly = last.top + last.height / 2
    const d = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - lx, r.top + r.height / 2 - ly) }
    focus(all.reduce((p, el) => (d(el) < d(p) ? el : p)))
  }, 700)
  // something to start from: Play on the banner once the page has it (the shows load after the app)
  let tries = 0
  const start = setInterval(() => {
    // the profile picker puts the focus on a profile itself; after it, Play gets it
    if (document.querySelector('.whopick')) return
    if (document.activeElement && document.activeElement !== document.body) return clearInterval(start)
    const first = document.querySelector<HTMLElement>('.pill-play') ?? (++tries > 20 ? document.querySelector<HTMLElement>('.content button, .topnav button, button') : null)
    if (first) (focus(first), clearInterval(start))
  }, 500)
}
