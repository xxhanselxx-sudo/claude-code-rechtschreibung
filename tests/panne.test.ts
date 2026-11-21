// Fällt hunspell aus, bleibt das Tippen unverändert, und es gibt genau eine Meldung.
import { expect, mock, test } from 'claude-code/testing'

const HOME = '/home/panne'

test('hunspell kaputt: Text unverändert, eine Meldung', async ($, on) => {
  mock.env(on, { HOME })
  const dateien: Record<string, string> = {
    [`${HOME}/.claude/settings.json`]: JSON.stringify({ spellcheck: { enabled: true, checker: 'hunspell', language: 'de_DE' } }),
    [`${HOME}/.hunspell_de_DE`]: 'Clara\n',
  }
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/ersetzungen.json')) {
      return { value: '{"nciht":"nicht"}' }
    }
    const inhalt = dateien[e.path]
    return inhalt === undefined ? { deny: 'fehlt' } : { value: inhalt }
  })
  on('fs.stat', (_, e) => {
    const inhalt = dateien[e.path]
    return inhalt === undefined ? { deny: 'fehlt' } : { value: { kind: 'file', size: inhalt.length, mtimeMs: 2, isLink: false } }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'kaputt', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.edit', (_, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.paint', (_, e) => ({ value: { isPainted: true, text: e.text ?? '', cursor: 0 } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  let text = ''
  for (const z of 'das nciht ist neu ') {
    const r = await $.prompt.edit({ origin: { kind: 'composer' }, key: { key: z }, text, cursor: text.length, start: text.length, end: text.length, inputText: z })
    text = r.text
    await new Promise(fertig => setTimeout(fertig, 5))
  }
  await new Promise(fertig => setTimeout(fertig, 50))
  expect(text).toBe('das nciht ist neu ')
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('hunspell')
})
