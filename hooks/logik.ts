// Wortlogik des Rechtschreib-Mods: reine Funktionen, kein $, kein Zustand.

import type { PromptDecoration } from 'claude-code'

/** Ein Wort: Buchstaben, innen auch Bindestriche (E-Mail). */
export const WORT = /\p{L}+(?:-\p{L}+)*/gu

/** Satzzeichen, die zwischen einem Wort und dem Leerzeichen stehen dürfen, das es fertig macht. */
export const SATZZEICHEN = /^[.,;:!?)\]}"»«“”…]*$/u

/** Was vor einem Wort im selben Stück stehen darf, ohne dass es Code, Pfad oder Link ist. */
const DAVOR = /^[(\[„"«»“]*$/u
/** Was danach im selben Stück stehen darf. */
const DANACH = /^[.,;:!?)\]}"»«“”…]*$/u

/** Ab dieser Länge gilt ein Stück ohne Tastendruck als eingefügt (Diktat, Einfügen), nicht als getippt. */
export const EINGEFUEGT_AB = 13

/** Ein Wort im Text, das die Erweiterung im Blick behält. */
export type Verfolgt = {
  start: number
  end: number
  /** Das Wort, wie es jetzt im Text steht. */
  wort: string
  /** `offen`: getippt und fertig, Urteil steht aus oder ist ein Vorschlag. `getauscht`: von der Erweiterung ersetzt. */
  zustand: 'offen' | 'getauscht'
  /** Bei `getauscht`: was getippt war. */
  original?: string
  /** Bei `getauscht`: der jüngste Austausch, mit der Rücktaste direkt danach zurückzuholen. */
  frisch?: boolean
  /** Bei `getauscht`: so viele fertige Wörter lang bleibt er noch grün. */
  gruen?: number
  /** Beim Absenden ohne Leerzeichen am Schluss: nur sicher tauschen, denn man sieht es vor dem Senden nicht mehr. */
  nurSicher?: boolean
  /** Bei `getauscht`: woher der Austausch kam. Gemerkt wird ein zurückgeholtes Wort nur bei `wahrscheinlich`. */
  art?: 'liste' | 'schreibweise' | 'wahrscheinlich'
}

/** Stimmt das Wort mit einer Zeile der festen Liste überein? Groß am Anfang bleibt groß. */
export function ausListe(wort: string, liste: ReadonlyMap<string, string>): string | undefined {
  const ziel = liste.get(wort.toLowerCase())
  if (ziel === undefined || ziel === wort) {
    return undefined
  }
  const erstes = wort.charAt(0)
  const istGross = erstes !== erstes.toLowerCase()
  const zielErstes = ziel.charAt(0)
  if (istGross && zielErstes === zielErstes.toLowerCase()) {
    return zielErstes.toUpperCase() + ziel.slice(1)
  }
  return ziel
}

/**
 * Andere Schreibweisen desselben Worts, nur Groß und klein, nie andere Buchstaben. Reihenfolge = Vorrang:
 * die Schreibweise aus dem Eigenwörterbuch, großer Anfangsbuchstabe, „ZWei GRoße“ am Anfang, ganz groß bis vier Buchstaben.
 */
export function schreibweisen(wort: string, eigen: ReadonlyMap<string, string>): string[] {
  const k: string[] = []
  const ausEigen = eigen.get(wort.toLowerCase())
  if (ausEigen !== undefined && ausEigen !== wort) {
    k.push(ausEigen)
  }
  const erstes = wort.charAt(0)
  if (erstes !== erstes.toUpperCase() && erstes === erstes.toLowerCase()) {
    k.push(erstes.toUpperCase() + wort.slice(1))
  }
  if (wort.length >= 3 && /^\p{Lu}\p{Lu}\p{Ll}+$/u.test(wort)) {
    k.push(erstes + wort.slice(1).toLowerCase())
  }
  if (wort.length <= 4 && wort !== wort.toUpperCase()) {
    k.push(wort.toUpperCase())
  }
  return [...new Set(k)].filter(w => w !== wort && w.toLowerCase() === wort.toLowerCase())
}

/**
 * Der sichere Austausch für ein fertig getipptes Wort.
 * `istFalsch(w)`: true = hunspell kennt es nicht, false = kennt es, undefined = noch nicht gefragt.
 * Antwort: das Ersatzwort; `null`, wenn es keinen sicheren Austausch gibt; `undefined`, solange hunspell noch gefragt werden muss.
 */
export function sichererAustausch(
  wort: string,
  istFalsch: (w: string) => boolean | undefined,
  liste: ReadonlyMap<string, string>,
  eigen: ReadonlyMap<string, string>,
): string | null | undefined {
  const falsch = istFalsch(wort)
  if (falsch === undefined) {
    return undefined
  }
  if (!falsch) {
    return null
  }
  const ausDerListe = ausListe(wort, liste)
  if (ausDerListe !== undefined) {
    return ausDerListe
  }
  for (const k of schreibweisen(wort, eigen)) {
    const f = istFalsch(k)
    if (f === undefined) {
      return undefined
    }
    if (!f) {
      return k
    }
  }
  return null
}

/**
 * Das wahrscheinlichste richtige Wort aus den Vorschlägen von hunspell. Unter den ersten drei brauchbaren Vorschlägen
 * gewinnt der, den man selbst am häufigsten schreibt (Verlauf), bei Gleichstand der von hunspell früher genannte.
 * Gemessen an 210 typischen Vertippern aus der Autokorrektur von LibreOffice, Wort für Wort: Der erste Vorschlag
 * trifft bei 78 %, unter den ersten drei steht das richtige Wort bei 94 %.
 * Antwort: das Wort; `null` ohne brauchbaren Vorschlag; `undefined`, solange die Vorschläge fehlen.
 */
export function bestesWort(
  wort: string,
  vorschlaege: readonly string[] | undefined,
  haeufigkeit: (w: string) => number,
): string | null | undefined {
  if (vorschlaege === undefined) {
    return undefined
  }
  const brauchbar = vorschlaege
    .filter(s => s.trim() !== '' && !s.startsWith('-') && !s.endsWith('-') && s !== wort)
    .slice(0, 3)
  let bestes: string | undefined
  let besteZahl = -1
  for (const s of brauchbar) {
    const zahl = haeufigkeit(s.toLowerCase())
    if (zahl > besteZahl) {
      bestes = s
      besteZahl = zahl
    }
  }
  if (bestes === undefined) {
    return null
  }
  const erstes = wort.charAt(0)
  const istGross = erstes !== erstes.toLowerCase()
  const bestesErstes = bestes.charAt(0)
  if (istGross && bestesErstes === bestesErstes.toLowerCase()) {
    return bestesErstes.toUpperCase() + bestes.slice(1)
  }
  return bestes
}

/**
 * Der Austausch für ein fertig getipptes Wort: zuerst das Sichere (feste Liste, Groß und klein), sonst das
 * wahrscheinlichste Wort. `null` heißt: bleibt, wie es ist. `undefined`: hunspell muss noch gefragt werden.
 */
export function wahrscheinlichsterAustausch(
  wort: string,
  istFalsch: (w: string) => boolean | undefined,
  liste: ReadonlyMap<string, string>,
  eigen: ReadonlyMap<string, string>,
  vorschlaege: (w: string) => readonly string[] | undefined,
  haeufigkeit: (w: string) => number,
): string | null | undefined {
  const sicher = sichererAustausch(wort, istFalsch, liste, eigen)
  if (sicher !== null) {
    return sicher
  }
  if (istFalsch(wort) !== true) {
    return null
  }
  return bestesWort(wort, vorschlaege(wort), haeufigkeit)
}

/** Darf die Erweiterung dieses Wort überhaupt anfassen? Nein bei Code, Pfaden, Links, Ziffern, Abkürzungen in Großbuchstaben. */
export function darfAnfassen(text: string, start: number, end: number): boolean {
  const wort = text.slice(start, end)
  if (wort.length < 2 || wort.length > 40) {
    return false
  }
  if (wort === wort.toUpperCase()) {
    return false
  }
  let a = start
  while (a > 0 && !/\s/u.test(text.charAt(a - 1))) {
    a -= 1
  }
  let b = end
  while (b < text.length && !/\s/u.test(text.charAt(b))) {
    b += 1
  }
  if (!DAVOR.test(text.slice(a, start)) || !DANACH.test(text.slice(end, b))) {
    return false
  }
  const backticks = (text.slice(0, start).match(/`/g) ?? []).length
  return backticks % 2 === 0
}

/** Gilt das Stück einer Bearbeitung als getippt (Taste, oder ein kurzer Schwall Tasten) statt als eingefügt? */
export function istGetippt(hatTaste: boolean, eingabe: string): boolean {
  if (hatTaste) {
    return true
  }
  return eingabe.length < EINGEFUEGT_AB && !eingabe.includes('\n')
}

/**
 * Wörter, die diese Bearbeitung fertig gemacht hat: Hinter dem Wort stehen höchstens Satzzeichen, dann ein Leerraum,
 * und dieser Leerraum kam mit dem eingefügten Stück. Ein Punkt allein macht nichts fertig (seite.py, 12:30, Links).
 * `text` ist der Text nach der Bearbeitung, das Stück beginnt bei `start` und ist `laenge` lang.
 */
export function fertigeWoerter(text: string, start: number, laenge: number): Array<{ start: number; end: number }> {
  if (laenge <= 0) {
    return []
  }
  const von = Math.max(0, start - 64)
  const bis = Math.min(text.length, start + laenge)
  const aus: Array<{ start: number; end: number }> = []
  const re = new RegExp(WORT.source, 'gu')
  for (const m of text.slice(von, bis).matchAll(re)) {
    const s = von + (m.index ?? 0)
    const e = s + m[0].length
    let k = e
    while (k < bis && !/\s/u.test(text.charAt(k))) {
      k += 1
    }
    if (k < start + laenge && k >= start && /\s/u.test(text.charAt(k)) && SATZZEICHEN.test(text.slice(e, k))) {
      aus.push({ start: s, end: e })
    }
  }
  return aus
}

/** Das letzte Wort am Ende des Texts, Satzzeichen dahinter erlaubt: für das Absenden ohne Leerzeichen am Schluss. */
export function letztesWort(text: string): { start: number; end: number } | undefined {
  const m = /(\p{L}+(?:-\p{L}+)*)([.,;:!?)\]}"»«“”…]*)$/u.exec(text)
  if (m === null || m[1] === undefined) {
    return undefined
  }
  return { start: m.index, end: m.index + m[1].length }
}

/**
 * Verschiebt die verfolgten Wörter um eine Bearbeitung (ersetzt `start..end` durch `neu`).
 * `beruehrt`: Wörter, in die hinein oder an die heran getippt wurde. Sie gelten nicht mehr.
 */
export function verschiebe(
  liste: readonly Verfolgt[],
  start: number,
  end: number,
  neu: string,
): { bleibt: Verfolgt[]; beruehrt: Verfolgt[] } {
  const delta = neu.length - (end - start)
  const bleibt: Verfolgt[] = []
  const beruehrt: Verfolgt[] = []
  for (const v of liste) {
    if (end <= v.start) {
      const haengtVorne = end === v.start && neu.length > 0 && /\p{L}$/u.test(neu)
      if (haengtVorne) {
        beruehrt.push(v)
      } else {
        bleibt.push({ ...v, start: v.start + delta, end: v.end + delta })
      }
    } else if (start >= v.end) {
      const haengtHinten = start === v.end && /^\p{L}/u.test(neu)
      if (haengtHinten) {
        beruehrt.push(v)
      } else {
        bleibt.push(v)
      }
    } else {
      beruehrt.push(v)
    }
  }
  return { bleibt, beruehrt }
}

/** Die Läufe, die die Erweiterung über den Text malt: grün für den frischen Austausch, blass der Vorschlag dahinter. */
export function dekorationen(
  text: string,
  liste: readonly Verfolgt[],
  vorschlagFuer: (v: Verfolgt) => string | undefined,
): PromptDecoration[] {
  const aus: PromptDecoration[] = []
  for (const v of liste) {
    if (text.slice(v.start, v.end) !== v.wort) {
      continue
    }
    if (v.zustand === 'getauscht') {
      if ((v.gruen ?? 0) > 0) {
        aus.push({ start: v.start, end: v.end, color: 'green' })
      }
      continue
    }
    const vorschlag = vorschlagFuer(v)
    if (vorschlag !== undefined && vorschlag !== v.wort) {
      aus.push({ start: v.end, end: v.end, virtualText: `→${vorschlag}`, dimColor: true })
    }
  }
  return aus
}

/** Liest die Antwort von `hunspell -a`: je falschem Wort seine Vorschläge (leer, wenn hunspell keine hat). */
export function leseVorschlaege(ausgabe: string): Map<string, string[]> {
  const aus = new Map<string, string[]>()
  for (const zeile of ausgabe.split('\n')) {
    if (zeile.startsWith('& ')) {
      const doppelpunkt = zeile.indexOf(': ')
      const kopf = zeile.slice(2, doppelpunkt === -1 ? undefined : doppelpunkt).split(' ')
      const wort = kopf[0] ?? ''
      const vorschlaege = doppelpunkt === -1 ? [] : zeile.slice(doppelpunkt + 2).split(', ').filter(s => s !== '')
      aus.set(wort, vorschlaege)
    } else if (zeile.startsWith('# ')) {
      const wort = zeile.slice(2).split(' ')[0] ?? ''
      aus.set(wort, [])
    }
  }
  return aus
}

/** Eingabe für `hunspell -a`: ein Wort je Zeile, jede mit `^`, damit keine Zeile ein Befehl wird (`*wort` schriebe ins Eigenwörterbuch). */
export function pipeEingabe(woerter: readonly string[]): string {
  return woerter.map(w => '^' + w.replace(/[\r\n]/g, ' ')).join('\n') + '\n'
}

/** Liest das Eigenwörterbuch (`~/.hunspell_de_DE`): klein geschrieben → wie es dort steht. */
export function leseEigen(text: string): Map<string, string> {
  const aus = new Map<string, string>()
  for (const zeile of text.split('\n')) {
    const w = (zeile.split('/')[0] ?? '').trim()
    if (w !== '' && !w.startsWith('*') && !aus.has(w.toLowerCase())) {
      aus.set(w.toLowerCase(), w)
    }
  }
  return aus
}

/** Liest die feste Liste (`ersetzungen.json`, ein Objekt Vertipper → richtig): klein geschrieben → Ersatz. */
export function leseListe(json: string): Map<string, string> {
  const roh: unknown = JSON.parse(json)
  const aus = new Map<string, string>()
  if (roh !== null && typeof roh === 'object') {
    for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
      if (typeof v === 'string' && !k.startsWith('_')) {
        aus.set(k.toLowerCase(), v)
      }
    }
  }
  return aus
}

/** Wie oft jedes Wort im eigenen Verlauf (`~/.claude/history.jsonl`) vorkommt, klein geschrieben. */
export function zaehleWoerter(verlauf: string): Map<string, number> {
  const zahl = new Map<string, number>()
  for (const [w, n] of zaehleSchreibweisen(verlauf)) {
    zahl.set(w.toLowerCase(), (zahl.get(w.toLowerCase()) ?? 0) + n)
  }
  return zahl
}

/** Die häufigsten Wörter aus dem eigenen Verlauf (`~/.claude/history.jsonl`), zum Vorprüfen beim Start. */
export function haeufigsteWoerter(verlauf: string, anzahl: number): string[] {
  return [...zaehleSchreibweisen(verlauf).entries()].sort((a, b) => b[1] - a[1]).slice(0, anzahl).map(([w]) => w)
}

function zaehleSchreibweisen(verlauf: string): Map<string, number> {
  const zahl = new Map<string, number>()
  for (const zeile of verlauf.split('\n')) {
    let eintrag: unknown
    try {
      eintrag = JSON.parse(zeile)
    } catch {
      continue
    }
    const text = (eintrag as { display?: unknown } | null)?.display
    if (typeof text !== 'string' || text.startsWith('/') || text.startsWith('!')) {
      continue
    }
    for (const m of text.matchAll(new RegExp(WORT.source, 'gu'))) {
      const s = m.index ?? 0
      if (darfAnfassen(text, s, s + m[0].length)) {
        zahl.set(m[0], (zahl.get(m[0]) ?? 0) + 1)
      }
    }
  }
  return zahl
}
