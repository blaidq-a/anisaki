// Splitting text into sentences before the on-device models translate it, and repairing what they
// return. Both models were trained on movie subtitles and share the same habits; the rules below come
// from counting errors over three translated episodes (Frieren, Dandadan, Bleach TYBW: 953 lines).

/**
 * Sentence by sentence ("What? Get out!" → two), so the model doesn't drop the second one. Not after
 * abbreviations ("U.S. Army", "Mr. Smith") or when the next word is lowercase ("Wait... what").
 */
const ABBR = /^(?:(?:[A-Za-z]\.)+|(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|Lt|Col|Gen|Capt|Sgt|Prof|No)\.)$/
export function sentences(s: string): string[] {
  const out: string[] = []
  const re = /[.!?…]+["'”»)]*\s+/g
  let start = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length
    const word = /(\S+)$/.exec(s.slice(start, end).trimEnd())?.[1]?.replace(/["'”»)]+$/, '') ?? ''
    if (ABBR.test(word) || !/^[A-Z0-9"'“‘¿¡(\[-]/.test(s.slice(end))) continue
    out.push(s.slice(start, end).trim())
    start = end
  }
  out.push(s.slice(start).trim())
  return out.filter(Boolean)
}

/** The model was trained on movie subtitles and sometimes adds a dialogue dash or an invented reply. */
export function clean(src: string, out: string) {
  let t = out.trim()
  if (!/^[-–—]/.test(src)) t = t.replace(/^[-–—]\s*/, '')
  if (!/\s[-–—]\s/.test(src)) t = t.split(/\s[-–—]\s/)[0]
  return t.trim() || out.trim()
}

/* --------------------------- before / after one sentence --------------------------- */

/**
 * Translate one sentence with `run`, working around the models' habits:
 *  - a leading dialogue dash ("-What?") makes them invent the other speaker's line: translated without it
 *  - on-screen text in capitals ("THE NORTHERNMOST POINT...") comes out garbled: translated in sentence
 *    case, then put back in capitals
 * and then repaired (see repair()).
 */
export async function translateSentence(src: string, run: (s: string) => Promise<string>): Promise<string> {
  const dash = /^([-–—]\s*)/.exec(src)?.[1] ?? ''
  let text = disambiguate(src.slice(dash.length).trim())
  if (!text) return src
  const letters = text.replace(/[^\p{L}]/gu, '')
  const caps = letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
  if (caps) text = sentenceCase(text)
  let out = repair(text, clean(text, await run(text)))
  if (caps) out = out.toLocaleUpperCase('tr-TR')
  return (dash ? '-' : '') + out
}

/**
 * Words with two meanings where the small model, seeing one sentence without the scene, picks the one
 * that never fits an anime fight: "my first strike" became "ilk grevim" (a workers' strike). They are
 * swapped for an unambiguous English word before translating; other uses ("strike a deal") are left.
 */
const DET = '(?:my|his|her|your|our|their|the|a|an|one|that|this|every|each|next|last|final|single)'
const SENSES: [RegExp, string][] = [
  // "strike" as a blow: after a determiner, maybe with one word between ("my first strike", "a single strike")
  [new RegExp(`\\b(${DET}\\s+(?:\\w+\\s+)?)strike(s?)\\b(?!\\s+(?:a|the)\\s+(?:deal|bargain|pose|balance))`, 'gi'), '$1attack$2'],
  [/\bstruck down\b/gi, 'cut down'],
  // "blow" as a hit ("one blow", "his blow"), not "blow up" / "blow away"
  [new RegExp(`\\b(${DET}\\s+(?:\\w+\\s+)?)blow(s?)\\b(?!\\s+(?:up|away|out|off))`, 'gi'), '$1hit$2']
]
/*
 * Object put first for emphasis, verb with nothing after it: "And your arm, Ichigo, I tore off next!".
 * The small model takes the fronted words for the subject ("Ve kolun… ben yırtıldım"), so the sentence is
 * put back in the plain order ("And next, Ichigo, I tore off your arm!"). Only with a possessive or
 * this/that phrase in front and a past-tense verb, so "My friends, we fight!" is left alone.
 */
const PAST = '(?:\\w+ed|tore|took|broke|cut|stole|ate|beat|crushed|smashed|killed|saw|made|got|threw|bit|shot|hit|put|left|lost|won|caught|struck|split|tore off|ripped off|cut off|took out|broke off)'
const FRONTED = new RegExp(
  `^(And |But |So )?((?:my|your|his|her|our|their|this|that|those|these)\\s+[a-z]+(?:\\s+[a-z]+)?),\\s+(?:([A-Z][\\p{L}-]+),\\s+)?(I|we|he|she|they)\\s+((?:already\\s+|just\\s+|also\\s+)?${PAST})(\\s+(?:next|first|too|as well|already|later|then|myself|ourselves))?([!.?…]*)$`,
  'iu'
)
function unfront(s: string): string {
  const m = FRONTED.exec(s)
  if (!m) return s
  const [, conj = '', obj, voc, subj, verb, adv = '', end] = m
  const lead = conj + (adv.trim() ? adv.trim() + ', ' : '') + (voc ? voc + ', ' : '')
  const out = `${lead}${subj} ${verb} ${obj.toLowerCase()}${end}`
  return out.charAt(0).toUpperCase() + out.slice(1)
}
// "tear off" a body part is ripping it off (koparmak), not tearing paper (yırtmak)
const BODY = '(?:arms?|legs?|heads?|hands?|feet|foot|fingers?|ears?|wings?|tails?|limbs?|horns?|eyes?|faces?|jaws?|throats?|hearts?)'
const TEAR = new RegExp(`\\b(tore|tear|tears|tearing|torn)\\s+off\\b(?=[^.!?]*\\b${BODY}\\b)|\\b(tore|tear|tears|tearing|torn)(\\s+(?:\\w+\\s+){0,2}${BODY})\\s+off\\b`, 'gi')
const RIP: Record<string, string> = { tore: 'ripped', tear: 'rip', tears: 'rips', tearing: 'ripping', torn: 'ripped' }
const tearOff = (s: string) => s.replace(TEAR, (all, a, b, rest) => (a ? RIP[a.toLowerCase()] + ' off' : RIP[b.toLowerCase()] + rest + ' off'))
const disambiguate = (s: string) => tearOff(SENSES.reduce((t, [re, to]) => t.replace(re, to), unfront(s)))

function sentenceCase(s: string) {
  const low = s.toLowerCase()
  // "I" stays a capital, and so does the first letter
  return low.replace(/\bi\b/g, 'I').replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase())
}

/** Short replies the models append on their own ("I'm sorry." → "Özür dilerim. Ne?"), with the English
 *  words that would justify them. */
const FILLER: [RegExp, RegExp][] = [
  [/^ne$/, /\b(what|huh)\b/i],
  [/^evet$/, /\b(yes|yeah|yep|right)\b/i],
  [/^hayır$/, /\b(no|nope|not)\b/i],
  [/^tamam$/, /\b(ok|okay|alright|fine|all right)\b/i],
  [/^gel$/, /\bcome\b/i],
  [/^hadi$/, /\b(come on|let's|go)\b/i],
  [/^(ah|oh|hı|hm|eh)$/, /\b(ah|oh|huh|hm+|eh)\b/i]
]
const bare = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** The same 1–6 words three or more times in a row (a model stuck in a loop) → once. */
function collapseLoops(t: string, src: string) {
  // the source repeats itself ("No, no, no!"): so may the translation
  if (/\b(\w+)\b\W+\1\b\W+\1\b/i.test(src)) return t
  const w = t.split(/\s+/)
  const key = (x: string) => x.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '')
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i + 3 * n <= w.length; i++) {
      const same = (a: number, b: number) => {
        for (let k = 0; k < n; k++) if (key(w[a + k]) !== key(w[b + k]) || !key(w[a + k])) return false
        return true
      }
      let reps = 1
      while (i + (reps + 1) * n <= w.length && same(i, i + reps * n)) reps++
      if (reps >= 3) {
        // one copy, ending like the last one ("Hayır, hayır, hayır." → "Hayır.", not "Hayır,")
        const tail = /[^\p{L}\p{N}]*$/u.exec(w[i + reps * n - 1])![0]
        w.splice(i + n, (reps - 1) * n)
        w[i + n - 1] = w[i + n - 1].replace(/[^\p{L}\p{N}]*$/u, '') + tail
      }
    }
  }
  return w.join(' ')
}

/** End punctuation of a sentence ("?!", "...", "…"), quotes ignored */
const endOf = (s: string) => (/[.!?…]+(?=["'”»)]*$)/.exec(s.trim())?.[0] ?? '')

/**
 * Repair one translated sentence:
 *  - repeats: "Teşekkür ederim. Teşekkür ederim.", "Kes sesini! Kes sesini!", "Hayır, hayır, hayır." for a
 *    single "No…", and runaway loops ("ANOMALY DETECTED ANOMALY DETECTED ...")
 *  - invented short replies at the end ("Özür dilerim. Ne?")
 *  - lost end punctuation ("What?!" → "Ne?", "…" → "...", a missing final ".")
 */
export function repair(src: string, out: string): string {
  let t = out.trim()
  if (!t) return t
  t = collapseLoops(t, src)
  // repeated sentences that the source doesn't repeat
  const srcParts = sentences(src)
  let parts = sentences(t)
  if (parts.length > srcParts.length) {
    parts = parts.filter((p, i) => i === 0 || bare(p) !== bare(parts[i - 1]))
    // invented short replies at the end
    while (parts.length > Math.max(1, srcParts.length)) {
      const last = bare(parts[parts.length - 1])
      const f = FILLER.find(([tr]) => tr.test(last.split(' ')[0] ?? '') && last.split(' ').every(w => w === last.split(' ')[0]))
      if (!f || f[1].test(src)) break
      parts.pop()
    }
    t = parts.join(' ')
  }
  // "Hayır, hayır, hayır." for a single "No…"
  const words = bare(src).split(' ')
  t = t.replace(/^(\p{L}+)((?:,\s*\1)+)(?=\P{L}|$)/iu, (m, w: string) => (new Set(words).size < words.length ? m : w))
  // end punctuation like the source's
  const e = endOf(src)
  const o = endOf(t)
  const keepTheirs =
    (e === '.' && /[?!]/.test(o)) || // a question or exclamation in Turkish can end differently
    (e === '?' && o === '.') ||
    (e === '...' && o === '…')
  if (e && e !== o && !keepTheirs) {
    const m = /[.!?…]*(["'”»)]*)$/.exec(t)!
    t = t.slice(0, m.index) + (e === '….' ? '…' : e) + m[1]
  }
  return t.trim()
}
