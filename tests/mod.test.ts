// Prüfungen der Rechtschreib-Erweiterung durch die Engine: Tippen Taste für Taste, hunspell als Attrappe.
import { expect, mock, test } from 'claude-code/testing'
import type { On, PromptDecoration } from 'claude-code'

const HOME = '/home/probe'
const RICHTIG = new Set([
  'das', 'ist', 'nicht', 'Nicht', 'die', 'Seite', 'auf', 'dem', 'VPS', 'Wenn', 'Clara', 'GitHub', 'und', 'x', 'hier',
  'direkt', 'mit', 'so', 'vor', 'allem', 'eingefügt', 'Satz', 'neu', 'läuft', 'lauft', 'Lohse', 'Liker', 'es', 'gut',
  'bei', 'dir',
])
const VORSCHLAEGE: Record<string, string[]> = {
  dirkte: ['direkt', 'dirket'],
  Lhotse: ['Lohse'],
  Riker: ['Liker'],
  leuft: ['lauft', 'läuft'],
  bloed: ['-blöd', 'Blödsinn-'],
}
/** Der Verlauf in der Attrappe: „läuft“ kommt oft vor, „lauft“ nie. */
const VERLAUF = ['das läuft gut', 'läuft bei dir', 'es läuft'].map(d => JSON.stringify({ display: d })).join('\n') + '\n'
const LISTE = { _: 'Probe', nciht: 'nicht', klara: 'Clara', vorallem: 'vor allem' }
const EIGEN = 'Clara\nGitHub\nVPS\nOK\n'

type Welt = {
  aufrufe: Array<{ argv: readonly string[]; stdin: string }>
  toasts: string[]
  gemalt: PromptDecoration[][]
  abgeschickt: string[]
  geschrieben: Array<{ path: string; text: string }>
}

/** Die Welt unter dem Mod: Einstellungen, Dateien, hunspell, das Eingabefeld. */
function welt(on: On, hunspellKaputt = false, extra: Record<string, string> = {}): Welt {
  const w: Welt = { aufrufe: [], toasts: [], gemalt: [], abgeschickt: [], geschrieben: [] }
  mock.env(on, { HOME })
  mock.clock(on)
  on('prompt.submit', (_, e) => {
    w.abgeschickt.push(e.text)
    return { text: e.text }
  })
  const dateien: Record<string, string> = {
    [`${HOME}/.claude/settings.json`]: JSON.stringify({
      spellcheck: { enabled: true, checker: 'hunspell', language: 'de_DE,en_US' },
    }),
    [`${HOME}/.hunspell_de_DE`]: EIGEN,
    [`${HOME}/.claude/history.jsonl`]: VERLAUF,
    ...extra,
  }
  on('fs.write', (_, e) => {
    w.geschrieben.push({ path: e.path, text: e.text })
    dateien[e.path] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/ersetzungen.json')) {
      return { value: JSON.stringify(LISTE) }
    }
    const inhalt = dateien[e.path]
    return inhalt === undefined ? { deny: `keine Datei ${e.path}` } : { value: inhalt }
  })
  on('fs.stat', (_, e) => {
    const inhalt = dateien[e.path]
    return inhalt === undefined
      ? { deny: `keine Datei ${e.path}` }
      : { value: { kind: 'file', size: inhalt.length, mtimeMs: inhalt.length, isLink: false } }
  })
  on('process.run', (_, e) => {
    const stdin = e.init?.stdin ?? ''
    w.aufrufe.push({ argv: e.argv, stdin })
    if (hunspellKaputt) {
      return { value: { exitCode: 1, stdout: '', stderr: 'kaputt', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const zeilen = stdin.split('\n').filter(z => z !== '')
    const eigen = new Set((dateien[`${HOME}/.hunspell_de_DE`] ?? '').split('\n'))
    const kennt = (wort: string) => RICHTIG.has(wort) || eigen.has(wort)
    let stdout = ''
    if (e.argv.includes('-l')) {
      stdout = zeilen.filter(z => !kennt(z)).map(z => z + '\n').join('')
    } else {
      stdout = '@(#) International Ispell Version 3.2.06 (but really Hunspell 1.7.2)\n'
      for (const z of zeilen) {
        const wort = z.startsWith('^') ? z.slice(1) : z
        const v = VORSCHLAEGE[wort]
        stdout += kennt(wort) ? '*\n\n' : v ? `& ${wort} ${v.length} 0: ${v.join(', ')}\n\n` : `# ${wort} 0\n\n`
      }
    }
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('prompt.read', () => ({ value: { text: IM_FELD, cursor: IM_FELD.length } }))
  on('prompt.paint', (_, e) => {
    w.gemalt.push([...e.decorations])
    return { value: { isPainted: true, text: e.text ?? '', cursor: 0 } }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return w
}

type Box = { text: string; cursor: number; decorations: PromptDecoration[] }

/** Tippt Taste für Taste, wie ein Mensch. */
async function tippe($: any, box: Box, zeichen: string): Promise<Box> {
  for (const z of zeichen) {
    const r = await $.prompt.edit({
      origin: { kind: 'composer' },
      key: { key: z === ' ' ? 'space' : z },
      text: box.text,
      cursor: box.cursor,
      start: box.cursor,
      end: box.cursor,
      inputText: z,
    })
    box = { text: r.text, cursor: r.cursor, decorations: r.decorations ?? [] }
    IM_FELD = box.text
  }
  return box
}

async function ruecktaste($: any, box: Box): Promise<Box> {
  const r = await $.prompt.edit({
    origin: { kind: 'composer' },
    key: { key: 'backspace' },
    text: box.text,
    cursor: box.cursor,
    start: box.cursor - 1,
    end: box.cursor,
    inputText: '',
  })
  return { text: r.text, cursor: r.cursor, decorations: r.decorations ?? [] }
}

async function leeren($: any, box: Box): Promise<Box> {
  const r = await $.prompt.edit({
    origin: { kind: 'composer' },
    key: { key: 'backspace', ctrl: true },
    text: box.text,
    cursor: box.cursor,
    start: 0,
    end: box.text.length,
    inputText: '',
  })
  return { text: r.text, cursor: r.cursor, decorations: r.decorations ?? [] }
}

/** Lässt die Prüfung im Hintergrund fertig werden. */
async function warte(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve()
  }
  await new Promise(fertig => setTimeout(fertig, 30))
}

const LEER: Box = { text: '', cursor: 0, decorations: [] }
/** Was im Eingabefeld steht, für `$.prompt.read` der Attrappe. */
let IM_FELD = ''

test('Vertipper aus der festen Liste wird beim Weitertippen getauscht und grün', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'das ist nciht ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('das ist nicht x')
  expect(box.decorations).toContainEqual({ start: 8, end: 13, color: 'green' })
  await leeren($, box)
})

test('Am Satzanfang bleibt der Ersatz groß', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'Nciht ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('Nicht x')
  await leeren($, box)
})

test('Nur Groß und klein: seite, vps, WEnn, github, klara', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'die seite auf dem vps WEnn github klara ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('die Seite auf dem VPS Wenn GitHub Clara x')
  await leeren($, box)
})

test('Code, Pfade, Links, Ziffern bleiben, wie getippt, Namen bekommen das wahrscheinlichste Wort', async ($, on) => {
  welt(on)
  // Erst „seite“ bekannt machen, damit ein zu früh fertiges Wort sofort getauscht würde (Fund vom 21.11.: Seite.py).
  let box = await tippe($, LEER, 'seite ')
  await warte()
  box = await leeren($, await tippe($, box, 'x'))
  box = await tippe($, LEER, 'Lhotse Riker `seite` seite.py http://seite x3 a_b ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('Lohse Liker `seite` seite.py http://seite x3 a_b x')
  await leeren($, box)
})

test('Ein falscher Buchstabe wird zum wahrscheinlichsten Wort und grün', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'so dirkte ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('so direkt x')
  expect(box.decorations).toContainEqual({ start: 3, end: 9, color: 'green' })
  await leeren($, box)
})

test('Unter den Vorschlägen gewinnt das Wort, das man selbst am häufigsten schreibt', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'es ')
  await warte()
  box = await tippe($, box, 'leuft ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('es läuft x')
  await leeren($, box)
})

test('Bruchstücke wie „-blöd“ werden nie eingesetzt', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'so bloed ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('so bloed x')
  await leeren($, box)
})

test('Grün bleibt, bis zwei weitere Wörter fertig sind', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'nciht ')
  await warte()
  box = await tippe($, box, 'das ')
  expect(box.text).toBe('nicht das ')
  expect(box.decorations).toContainEqual({ start: 0, end: 5, color: 'green' })
  box = await tippe($, box, 'ist ')
  expect(box.decorations.filter(d => d.color === 'green')).toEqual([])
  await leeren($, box)
})

test('Zurückgeschrieben und abgeschickt: das Wort bleibt und wird gemerkt', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'Riker ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('Liker x')
  const r = await $.prompt.edit({
    origin: { kind: 'composer' },
    key: { key: 'r' },
    text: box.text,
    cursor: 5,
    start: 0,
    end: 5,
    inputText: 'Riker',
  })
  box = { text: r.text, cursor: r.cursor, decorations: r.decorations ?? [] }
  IM_FELD = box.text
  expect(box.text).toBe('Riker x')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  await warte()
  expect(w.abgeschickt).toEqual(['Riker x'])
  const woerterbuch = w.geschrieben.filter(g => g.path.endsWith('/.hunspell_de_DE')).at(-1)?.text ?? ''
  expect(woerterbuch.split('\n')).toContain('Riker')
  expect(woerterbuch.startsWith(EIGEN)).toBe(true)
  expect(w.toasts.some(t => t.includes('Riker'))).toBe(true)
  box = await tippe($, LEER, 'Riker ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('Riker x')
  await leeren($, box)
  IM_FELD = ''
})

test('Wörter der festen Liste werden nie gemerkt, auch wenn sie zurückgeholt wurden', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'nciht ')
  await warte()
  box = await leeren($, await tippe($, box, 'x'))
  box = await tippe($, box, 'nciht ')
  box = await ruecktaste($, box)
  expect(box.text).toBe('nciht')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  await warte()
  expect(w.geschrieben.filter(g => g.path.endsWith('/.hunspell_de_DE'))).toEqual([])
})

test('Zurückgeholte Groß- und Kleinschreibung wird nicht gemerkt (Rücktaste fürs Komma)', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'die seite ')
  await warte()
  box = await leeren($, await tippe($, box, 'x'))
  box = await tippe($, box, 'die seite ')
  expect(box.text).toBe('die Seite ')
  box = await ruecktaste($, box)
  expect(box.text).toBe('die seite')
  box = await tippe($, box, ',')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  await warte()
  expect(w.abgeschickt).toEqual(['die seite,'])
  expect(w.geschrieben.filter(g => g.path.endsWith('/.hunspell_de_DE'))).toEqual([])
})

test('Das letzte Wort beim Absenden wird nur sicher verbessert, sonst bleibt es', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'so ist dirkte')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  box = await tippe($, LEER, 'so ist seite')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  expect(w.abgeschickt).toEqual(['so ist dirkte', 'so ist Seite'])
})

test('Die Vorschau nach einer Pause wird gemalt und beim nächsten Tippen gelöscht, nichts steht doppelt', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'mit dirkte ')
  await warte()
  const vorschau = w.gemalt.at(-1) ?? []
  expect(vorschau).toContainEqual({ start: 10, end: 10, virtualText: '→direkt', dimColor: true })
  box = await tippe($, box, 'x')
  await warte()
  expect(w.gemalt.at(-1)).toEqual([])
  expect(box.text).toBe('mit direkt x')
  expect(box.decorations.filter(d => d.virtualText !== undefined)).toEqual([])
  await leeren($, box)
  IM_FELD = ''
})

test('Eingefügter Text bleibt unberührt', async ($, on) => {
  welt(on)
  const r = await $.prompt.edit({
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText: 'eingefügt nciht und seite hier ',
  })
  await warte()
  const box = await tippe($, { text: r.text, cursor: r.cursor, decorations: [] }, 'x')
  expect(box.text).toBe('eingefügt nciht und seite hier x')
  await leeren($, box)
})

test('Vom Handy oder aus claude -p geht der Text unverändert durch', async ($, on) => {
  const w = welt(on)
  for (const kind of ['bridge', 'sdk'] as const) {
    await $.prompt.submit({ text: 'das ist nciht seite', origin: { kind }, wait: false } as any)
  }
  expect(w.abgeschickt).toEqual(['das ist nciht seite', 'das ist nciht seite'])
})

test('Beim Absenden wird auch das letzte getippte Wort verbessert, Satzzeichen dahinter erlaubt', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'das ist nciht')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  box = await tippe($, LEER, 'die seite.')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  expect(w.abgeschickt).toEqual(['das ist nicht', 'die Seite.'])
})

test('Herkunft allein: Derselbe Text vom Handy bleibt unverändert, auch wenn er im Feld getippt steht', async ($, on) => {
  const w = welt(on)
  const box = await tippe($, LEER, 'das ist nciht')
  await $.prompt.submit({ text: box.text, origin: { kind: 'bridge' }, wait: false } as any)
  expect(w.abgeschickt).toEqual(['das ist nciht'])
})

test('Entwurf allein: Weicht der abgeschickte Text vom getippten ab, bleibt er unverändert', async ($, on) => {
  const w = welt(on)
  await tippe($, LEER, 'das ist x')
  await $.prompt.submit({ text: 'das ist nciht', origin: { kind: 'composer' }, wait: false } as any)
  expect(w.abgeschickt).toEqual(['das ist nciht'])
})

test('Satzzeichen vor dem Leerzeichen: das Wort ist trotzdem fertig', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'die seite, ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('die Seite, x')
  await leeren($, box)
})

test('Rücktaste direkt nach dem Austausch holt das Wort zurück, danach bleibt es', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'nciht ')
  await warte()
  box = await leeren($, await tippe($, box, 'x'))
  box = await tippe($, box, 'nciht ')
  expect(box.text).toBe('nicht ')
  box = await ruecktaste($, box)
  expect(box.text).toBe('nciht')
  box = await tippe($, box, ' x')
  await warte()
  box = await tippe($, box, ' ')
  expect(box.text).toBe('nciht x ')
  // Abgelehnt heißt auch: kein blasser Vorschlag mehr für dieses Wort.
  expect(box.decorations.filter(d => d.virtualText !== undefined)).toEqual([])
  await leeren($, box)
})

test('Abgelehnt gilt auch beim Absenden', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'nciht ')
  await warte()
  box = await leeren($, await tippe($, box, 'x'))
  box = await tippe($, box, 'nciht ')
  expect(box.text).toBe('nicht ')
  box = await ruecktaste($, box)
  expect(box.text).toBe('nciht')
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' }, wait: false } as any)
  expect(w.abgeschickt).toEqual(['nciht'])
})

test('Zurückgeschrieben: Wer ins getauschte Wort tippt, bekommt es nicht noch einmal getauscht', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, 'vorallem ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('vor allem x')
  const r = await $.prompt.edit({
    origin: { kind: 'composer' },
    key: { key: 'm' },
    text: box.text,
    cursor: 9,
    start: 3,
    end: 9,
    inputText: 'allem',
  })
  box = { text: r.text, cursor: r.cursor, decorations: r.decorations ?? [] }
  expect(box.text).toBe('vorallem x')
  box = await tippe($, { ...box, cursor: box.text.length }, ' vorallem ')
  await warte()
  box = await tippe($, box, 'y')
  expect(box.text).toBe('vorallem x vorallem y')
  await leeren($, box)
})

test('Jede Zeile an hunspell -a beginnt mit ^, an -l gehen nur Wörter', async ($, on) => {
  const w = welt(on)
  let box = await tippe($, LEER, 'so Riker *dirkte dirkte ')
  await warte()
  box = await tippe($, box, 'x')
  const zeilen = w.aufrufe.filter(a => a.argv.includes('-a')).flatMap(a => a.stdin.split('\n').filter(z => z !== ''))
  expect(zeilen.length).toBeGreaterThan(0)
  for (const z of zeilen) {
    expect(z.startsWith('^')).toBe(true)
  }
  for (const a of w.aufrufe.filter(a => a.argv.includes('-l'))) {
    for (const z of a.stdin.split('\n').filter(z => z !== '')) {
      expect(/^\p{L}+(?:-\p{L}+)*$/u.test(z)).toBe(true)
    }
  }
  await leeren($, box)
})

test('Eigene Ersetzungen aus ~/.claude/rechtschreibung-ersetzungen.json gelten und gehen der mitgelieferten Liste vor', async ($, on) => {
  welt(on, false, { [`${HOME}/.claude/rechtschreibung-ersetzungen.json`]: JSON.stringify({ _: 'eigene', teh: 'the', nciht: 'nich' }) })
  let box = await tippe($, LEER, 'so teh nciht ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('so the nich x')
  await leeren($, box)
})

test('Eine kaputte eigene Liste: Die mitgelieferte gilt weiter, und es gibt eine Meldung', async ($, on) => {
  const w = welt(on, false, { [`${HOME}/.claude/rechtschreibung-ersetzungen.json`]: '{ kaputt' })
  let box = await tippe($, LEER, 'das ist nciht ')
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe('das ist nicht x')
  expect(w.toasts.some(t => t.includes('rechtschreibung-ersetzungen.json'))).toBe(true)
  await leeren($, box)
})

test('Wörter mit Apostroph bleiben unberührt, auch falsch geschriebene (l\'…, …\'s)', async ($, on) => {
  welt(on)
  let box = await tippe($, LEER, "das l'nciht nciht's ")
  await warte()
  box = await tippe($, box, 'x')
  expect(box.text).toBe("das l'nciht nciht's x")
  await leeren($, box)
})
