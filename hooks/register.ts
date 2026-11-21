// Rechtschreibung im Eingabefeld von Claude Code: tauscht beim Tippen falsche Wörter gegen das wahrscheinlichste
// richtige aus (zuerst feste Liste und Groß/klein, sonst hunspells Vorschläge nach der eigenen Häufigkeit im Verlauf).
// Schreibt man einen Austausch zurück und schickt den Text so ab, merkt es sich das Wort im Eigenwörterbuch.
// Unterstreichen tut Claude Code selbst (Einstellung `spellcheck`). Von dort kommen auch Ein/Aus und Sprache.

import type { EngineInterface, PromptDecoration, PromptEditInput, PromptEditResult, Register } from 'claude-code'

import {
  darfAnfassen,
  dekorationen,
  fertigeWoerter,
  haeufigsteWoerter,
  istGetippt,
  leseEigen,
  letztesWort,
  leseListe,
  leseVorschlaege,
  pipeEingabe,
  schreibweisen,
  sichererAustausch,
  verschiebe,
  wahrscheinlichsterAustausch,
  zaehleWoerter,
  type Verfolgt,
} from './logik'

/** So viele Wörter aus dem Verlauf werden beim Start vorgeprüft (gemessen: 3000 in 0,3 s). */
const VORPRUEFEN = 3000
/** So lange wartet das Absenden höchstens auf hunspell, danach geht der Text unverändert raus. */
const FRIST_ABSENDEN_MS = 1000
/** So lange darf ein hunspell-Aufruf laufen. */
const FRIST_HUNSPELL_MS = 8000
/** Eigene Ersetzungen (unter HOME), gleiche Form wie `ersetzungen.json`. Sie gehen der mitgelieferten Liste vor und
 * überstehen jedes Update des Mods. */
const EIGENE_LISTE = '.claude/rechtschreibung-ersetzungen.json'

// Zustand. Ein Neuladen des Mods fängt leer an.
let geladen: Promise<void> | undefined
let an = false
let sprache = 'de_DE'
let liste = new Map<string, string>()
let eigen = new Map<string, string>()
let eigenPfad = ''
let eigenStand = ''
let gemeldet = false
/** hunspell: true = kennt das Wort nicht. */
const falsch = new Map<string, boolean>()
const vorschlaege = new Map<string, string[]>()
const zuPruefen = new Set<string>()
const zuVorschlagen = new Set<string>()
let laufend: Promise<void> | undefined
let nochmal = false
/** Die Wörter des aktuellen Entwurfs, die die Erweiterung im Blick hat. */
let verfolgt: Verfolgt[] = []
/** Getippte Wörter, deren Austausch zurückgeholt wurde (klein → wie getippt, und woher der Austausch kam): im
 * selben Entwurf nicht noch einmal. War es ein Austausch nach Wahrscheinlichkeit und steht das Wort beim Absenden noch
 * im Text, kommt es ins Eigenwörterbuch. Groß/klein und die feste Liste werden nie gemerkt: Dort ist das Getippte
 * sicher falsch, und eine Rücktaste fürs Komma soll kein „seite“ ins Wörterbuch bringen. */
const abgelehnt = new Map<string, { original: string; art: Verfolgt['art'] }>()
/** Wie oft jedes Wort im eigenen Verlauf vorkommt (klein): entscheidet zwischen hunspells Vorschlägen. */
let haeufigkeit = new Map<string, number>()
let letzterText = ''
let letztesGetippt = false
/** Steht noch eine Vorschau aus `male`? Die nächste Bearbeitung löscht sie, sonst stünde der Vorschlag doppelt da. */
let vorschauSteht = false

function istFalsch(w: string): boolean | undefined {
  return falsch.get(w)
}

function sicher(w: string): string | null | undefined {
  return sichererAustausch(w, istFalsch, liste, eigen)
}

function austausch(w: string): string | null | undefined {
  return wahrscheinlichsterAustausch(
    w,
    istFalsch,
    liste,
    eigen,
    x => vorschlaege.get(x),
    x => haeufigkeit.get(x) ?? 0,
  )
}

function austauschFuer(v: Verfolgt): string | null | undefined {
  return v.nurSicher === true ? sicher(v.wort) : austausch(v.wort)
}

/** Was blass hinter dem Wort steht, solange der Austausch noch aussteht. */
function vorschlagFuer(v: Verfolgt): string | undefined {
  const a = austauschFuer(v)
  return typeof a === 'string' ? a : undefined
}

function deko(text: string): PromptDecoration[] {
  const sichtbar = verfolgt.filter(v => v.zustand === 'getauscht' || darfAnfassen(text, v.start, v.end))
  return dekorationen(text, sichtbar, vorschlagFuer)
}

function entwurfVergessen(text: string): void {
  verfolgt = []
  abgelehnt.clear()
  letzterText = text
  letztesGetippt = false
}

async function melde($: EngineInterface, grund: unknown): Promise<void> {
  if (gemeldet) {
    return
  }
  gemeldet = true
  $.ui.toast(`Rechtschreibung: ${String(grund).slice(0, 160)}`)
}

async function hunspell($: EngineInterface, schalter: string, eingabe: string): Promise<string> {
  const r = await $.process.run(['hunspell', schalter, '-i', 'utf-8', '-d', sprache], {
    stdin: eingabe,
    timeoutMs: FRIST_HUNSPELL_MS,
  })
  if (r.exitCode !== 0) {
    throw new Error(`hunspell endete mit ${r.exitCode}: ${r.stderr.slice(0, 120)}`)
  }
  return r.stdout
}

async function ladeEigen($: EngineInterface): Promise<void> {
  let stand = 'fehlt'
  try {
    const s = await $.fs.stat(eigenPfad)
    stand = `${s.mtimeMs}:${s.size}`
  } catch {
    // Kein Eigenwörterbuch: dann eben keins.
  }
  if (stand === eigenStand) {
    return
  }
  eigen = stand === 'fehlt' ? new Map() : leseEigen(await $.fs.read(eigenPfad))
  eigenStand = stand
  // Ein geändertes Wörterbuch macht alle Urteile alt.
  falsch.clear()
  vorschlaege.clear()
}

async function pruefe($: EngineInterface, woerter: readonly string[]): Promise<void> {
  const unbekannt = new Set((await hunspell($, '-l', woerter.join('\n') + '\n')).split('\n'))
  for (const w of woerter) {
    falsch.set(w, unbekannt.has(w))
  }
}

async function eineRunde($: EngineInterface): Promise<void> {
  await ladeEigen($)
  const neu = [...zuPruefen].filter(w => !falsch.has(w))
  zuPruefen.clear()
  if (neu.length > 0) {
    await pruefe($, neu)
    const weitere = new Set<string>()
    for (const w of neu) {
      if (falsch.get(w) === true) {
        for (const k of schreibweisen(w, eigen)) {
          if (!falsch.has(k)) {
            weitere.add(k)
          }
        }
      }
    }
    if (weitere.size > 0) {
      await pruefe($, [...weitere])
    }
  }
  for (const v of verfolgt) {
    if (
      v.zustand === 'offen' &&
      v.nurSicher !== true &&
      falsch.get(v.wort) === true &&
      sicher(v.wort) === null &&
      !vorschlaege.has(v.wort)
    ) {
      zuVorschlagen.add(v.wort)
    }
  }
  const fuerVorschlag = [...zuVorschlagen].filter(w => !vorschlaege.has(w))
  zuVorschlagen.clear()
  if (fuerVorschlag.length > 0) {
    const gefunden = leseVorschlaege(await hunspell($, '-a', pipeEingabe(fuerVorschlag)))
    for (const w of fuerVorschlag) {
      vorschlaege.set(w, gefunden.get(w) ?? [])
    }
  }
}

async function runden($: EngineInterface): Promise<void> {
  try {
    do {
      nochmal = false
      await eineRunde($)
    } while (nochmal || zuPruefen.size > 0)
    await male($)
  } catch (grund) {
    await melde($, grund)
  }
}

/** Startet die Prüfung im Hintergrund, oder hängt sich an die laufende. Wartet nie im Tippen. */
function rundeAnstossen($: EngineInterface): Promise<void> {
  if (laufend !== undefined) {
    nochmal = true
    return laufend
  }
  laufend = runden($).finally(() => {
    laufend = undefined
  })
  return laufend
}

/** Zeigt, was die Prüfung im Hintergrund ergeben hat, ohne den Text anzufassen. */
async function male($: EngineInterface): Promise<void> {
  const box = await $.prompt.read()
  if (box.text === '' || box.text !== letzterText) {
    return
  }
  const ergebnis = await $.prompt.paint({ text: box.text, decorations: deko(box.text) })
  vorschauSteht = vorschauSteht || ergebnis.isPainted
}

function vorschauLoeschen($: EngineInterface): void {
  if (vorschauSteht) {
    vorschauSteht = false
    void $.prompt.paint({ decorations: [] })
  }
}

async function vorpruefen($: EngineInterface, home: string): Promise<void> {
  const pfad = `${home}/.claude/history.jsonl`
  let groesse = 0
  try {
    groesse = (await $.fs.stat(pfad)).size
  } catch {
    // Kein Verlauf: dann gibt es nichts vorzuprüfen.
    return
  }
  try {
    const max = 4 * 1024 * 1024 - 1
    const verlauf = await $.fs.read(pfad, { offset: Math.max(0, groesse - max), length: Math.min(groesse, max) })
    haeufigkeit = zaehleWoerter(verlauf)
    for (const w of haeufigsteWoerter(verlauf, VORPRUEFEN)) {
      zuPruefen.add(w)
    }
    await rundeAnstossen($)
  } catch (grund) {
    await melde($, grund)
  }
}

/** Liest die eigene Liste. Fehlt sie, gibt es eben keine. Ist sie kaputt, gilt nur die mitgelieferte, mit Meldung. */
async function eigeneListe($: EngineInterface, home: string): Promise<Map<string, string>> {
  let text: string
  try {
    text = await $.fs.read(`${home}/${EIGENE_LISTE}`)
  } catch {
    return new Map()
  }
  try {
    return leseListe(text)
  } catch (grund) {
    await melde($, `~/${EIGENE_LISTE} lässt sich nicht lesen: ${String(grund)}`)
    return new Map()
  }
}

async function lade($: EngineInterface): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  const einstellungen = JSON.parse(await $.fs.read(`${home}/.claude/settings.json`)) as {
    spellcheck?: { enabled?: unknown; checker?: unknown; language?: unknown }
  }
  const sc = einstellungen.spellcheck
  an = sc?.enabled === true && sc?.checker === 'hunspell'
  if (!an) {
    return
  }
  const gewuenscht = sc?.language
  sprache = typeof gewuenscht === 'string' && /^[\w.,-]+$/.test(gewuenscht) ? gewuenscht : 'de_DE'
  liste = leseListe(await $.fs.read(`${$.plugin.root}/ersetzungen.json`))
  for (const [getippt, ersatz] of await eigeneListe($, home)) {
    liste.set(getippt, ersatz)
  }
  eigenPfad = `${home}/.hunspell_${sprache.split(',')[0] ?? 'de_DE'}`
  await ladeEigen($)
  void vorpruefen($, home)
}

function sicherGeladen($: EngineInterface): Promise<void> {
  geladen ??= lade($).catch(async grund => {
    an = false
    await melde($, grund)
  })
  return geladen
}

/** Setzt die sicheren Austausche ein, die feststehen, von hinten nach vorn. Gibt Text und Cursor danach. */
function tauscheAus(text: string, cursor: number): { text: string; cursor: number } {
  const offen = verfolgt.filter(v => v.zustand === 'offen').sort((a, b) => b.start - a.start)
  for (const v of offen) {
    if (abgelehnt.has(v.wort.toLowerCase())) {
      continue
    }
    const neu = austauschFuer(v)
    if (typeof neu !== 'string' || text.slice(v.start, v.end) !== v.wort || !darfAnfassen(text, v.start, v.end)) {
      continue
    }
    const art: Verfolgt['art'] =
      typeof sicher(v.wort) !== 'string' ? 'wahrscheinlich' : liste.has(v.wort.toLowerCase()) ? 'liste' : 'schreibweise'
    const delta = neu.length - v.wort.length
    text = text.slice(0, v.start) + neu + text.slice(v.end)
    if (cursor >= v.end) {
      cursor += delta
    } else if (cursor > v.start) {
      cursor = v.start + Math.min(neu.length, cursor - v.start)
    }
    for (const w of verfolgt) {
      if (w !== v && w.start >= v.end) {
        w.start += delta
        w.end += delta
      }
    }
    v.original = v.wort
    v.wort = neu
    v.end = v.start + neu.length
    v.zustand = 'getauscht'
    v.frisch = true
    v.gruen = 2
    v.art = art
  }
  return { text, cursor }
}

function enthaeltWort(text: string, wort: string): boolean {
  const muster = wort.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}])${muster}(?![\\p{L}])`, 'u').test(text)
}

/** Nimmt Wörter ins Eigenwörterbuch auf, das auch die Unterstreichung liest, und sagt es laut. */
async function lerne($: EngineInterface, woerter: readonly string[]): Promise<void> {
  try {
    let inhalt = ''
    try {
      inhalt = await $.fs.read(eigenPfad)
    } catch {
      // Noch kein Eigenwörterbuch: es entsteht jetzt.
    }
    const da = new Set(inhalt.split('\n').map(z => z.trim()))
    const neu = [...new Set(woerter)].filter(w => !da.has(w))
    if (neu.length === 0) {
      return
    }
    const davor = inhalt === '' || inhalt.endsWith('\n') ? inhalt : inhalt + '\n'
    await $.fs.write(eigenPfad, davor + neu.map(w => w + '\n').join(''))
    for (const w of neu) {
      if (!eigen.has(w.toLowerCase())) {
        eigen.set(w.toLowerCase(), w)
      }
      falsch.set(w, false)
    }
    const s = await $.fs.stat(eigenPfad)
    eigenStand = `${s.mtimeMs}:${s.size}`
    $.ui.toast(`Rechtschreibung: gemerkt, bleibt künftig so: ${neu.join(', ')}`)
  } catch (grund) {
    await melde($, grund)
  }
}

function bearbeite($: EngineInterface, e: PromptEditInput, r: PromptEditResult): PromptEditResult {
  let text = r.text
  let cursor = r.cursor
  vorschauLoeschen($)
  if (text === '') {
    entwurfVergessen('')
    return r
  }
  const { bleibt, beruehrt } = verschiebe(verfolgt, e.start, e.end, e.inputText)
  for (const v of beruehrt) {
    if (v.zustand === 'getauscht' && v.original !== undefined) {
      abgelehnt.set(v.original.toLowerCase(), { original: v.original, art: v.art })
    }
  }
  verfolgt = bleibt.filter(v => text.slice(v.start, v.end) === v.wort)

  // Rücktaste direkt hinter einem frischen Austausch: das getippte Wort kommt zurück.
  const frisch = verfolgt.find(v => v.zustand === 'getauscht' && v.frisch === true && e.start === v.end && e.end === v.end + 1)
  if (e.key?.key === 'backspace' && frisch?.original !== undefined) {
    const delta = frisch.original.length - frisch.wort.length
    text = text.slice(0, frisch.start) + frisch.original + text.slice(frisch.end)
    if (cursor >= frisch.end) {
      cursor += delta
    }
    abgelehnt.set(frisch.original.toLowerCase(), { original: frisch.original, art: frisch.art })
    verfolgt = verfolgt.filter(v => v !== frisch)
    for (const v of verfolgt) {
      if (v.start >= frisch.end) {
        v.start += delta
        v.end += delta
      }
    }
    letzterText = text
    letztesGetippt = true
    return { ...r, text, cursor, decorations: [...(r.decorations ?? []), ...deko(text)] }
  }

  const getippt = istGetippt(e.key !== undefined, e.inputText)
  letztesGetippt = getippt && r.cursor === text.length
  if (getippt) {
    const fertig = fertigeWoerter(text, e.start, e.inputText.length).filter(
      f => darfAnfassen(text, f.start, f.end) && !verfolgt.some(v => v.start === f.start && v.end === f.end),
    )
    if (fertig.length > 0) {
      for (const v of verfolgt) {
        v.frisch = false
        if ((v.gruen ?? 0) > 0) {
          v.gruen = (v.gruen ?? 0) - 1
        }
      }
      for (const f of fertig) {
        verfolgt.push({ start: f.start, end: f.end, wort: text.slice(f.start, f.end), zustand: 'offen' })
      }
    }
  }

  // Abgelehnte Wörter bekommen weder Austausch noch Vorschlag; richtige fallen heraus.
  verfolgt = verfolgt.filter(
    v => v.zustand === 'getauscht' || (!abgelehnt.has(v.wort.toLowerCase()) && falsch.get(v.wort) !== false),
  )
  for (const v of verfolgt) {
    if (v.zustand === 'offen' && !falsch.has(v.wort)) {
      zuPruefen.add(v.wort)
    }
  }
  ;({ text, cursor } = tauscheAus(text, cursor))
  letzterText = text
  if (zuPruefen.size > 0 || verfolgt.some(v => v.zustand === 'offen' && falsch.get(v.wort) === true && !vorschlaege.has(v.wort))) {
    void rundeAnstossen($)
  }
  if (text === r.text && verfolgt.length === 0) {
    return r
  }
  return { ...r, text, cursor, decorations: [...(r.decorations ?? []), ...deko(text)] }
}

async function absenden($: EngineInterface, text: string): Promise<string> {
  if (text !== letzterText) {
    return text
  }
  const letztes = letztesGetippt ? letztesWort(text) : undefined
  if (letztes !== undefined && darfAnfassen(text, letztes.start, letztes.end)) {
    if (!verfolgt.some(v => v.start === letztes.start && v.end === letztes.end)) {
      // Das letzte Wort sieht man nach dem Austausch nicht mehr vor dem Senden: nur Sicheres.
      verfolgt.push({ ...letztes, wort: text.slice(letztes.start, letztes.end), zustand: 'offen', nurSicher: true })
    }
  }
  const fehlt = verfolgt.filter(v => v.zustand === 'offen' && austauschFuer(v) === undefined)
  for (const v of fehlt) {
    zuPruefen.add(v.wort)
  }
  if (fehlt.length > 0) {
    await Promise.race([rundeAnstossen($), $.clock.sleep(FRIST_ABSENDEN_MS)])
  }
  const ende = tauscheAus(text, text.length).text
  const zuLernen = [...abgelehnt.values()]
    .filter(a => a.art === 'wahrscheinlich' && !liste.has(a.original.toLowerCase()) && enthaeltWort(ende, a.original))
    .map(a => a.original)
  if (zuLernen.length > 0) {
    void lerne($, zuLernen)
  }
  return ende
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void sicherGeladen($)
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    await sicherGeladen($)
    if (!an) {
      return r
    }
    return bearbeite($, e, r)
  }).catch(($, e, next) => next(e))

  on('prompt.change', async ($, e, next) => {
    entwurfVergessen(e.text)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await sicherGeladen($)
    if (!an || e.origin.kind !== 'composer' || e.command !== undefined || e.isMeta === true) {
      entwurfVergessen('')
      return next(e)
    }
    const text = await absenden($, e.text)
    entwurfVergessen('')
    return next(text === e.text ? e : { ...e, text })
  }).catch(($, e, next) => next(e))
}
