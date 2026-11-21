# Rechtschreibung für Claude Code

Wir sind alle Vibecoder: Wir reden mit Claude, statt zu tippen. Aber manchmal geht das nicht. Mal ist es zu leise
(Kirche, Bibliothek an der Uni, das Baby schläft endlich), mal zu laut (Stadion, der Fernseher läuft nebenher), mal zu
voll (S-Bahn um halb acht), und auf der Arbeit hören zu viele mit. Dann wird doch getippt, schnell und schief.

Dieses Mod für das Eingabefeld von [Claude Code](https://claude.com/claude-code) räumt dabei auf: Es tauscht
Tippfehler schon beim Tippen gegen das wahrscheinlichste richtige Wort aus. Gebaut für Deutsch, mit hunspell. Kein
offizielles Projekt von Anthropic.

*English: We're all vibe coders, talking to Claude instead of typing. But sometimes you can't: too quiet (church,
university library), too loud (stadium, TV), too crowded (the 7:30 train), and at work too many people are listening.
This Claude Code mod fixes typos in the prompt while you type, using hunspell and Claude Code's built-in `spellcheck`
setting. Built for German, works with any hunspell language.*

## Was es tut

Sobald ein Wort fertig ist (Leerzeichen dahinter) und hunspell es nicht kennt, tauscht das Mod es aus:

1. nach der festen Liste `ersetzungen.json` (häufige Vertipper wie nciht → nicht) und deiner eigenen Liste,
2. sonst bei falscher Groß- und Kleinschreibung (seite → Seite),
3. sonst gegen den Vorschlag von hunspell, den du selbst am häufigsten schreibst. Dafür zählt das Mod die Wörter in
   deinem Verlauf und nimmt unter den ersten drei Vorschlägen das häufigste.

Das getauschte Wort ist grün, bis zwei weitere Wörter fertig sind. Die Rücktaste direkt danach holt dein Wort zurück,
und das Mod fasst es in diesem Text nicht mehr an. War es ein Tausch nach Punkt 3 und steht dein Wort beim Absenden
noch da, merkt sich das Mod es im Eigenwörterbuch und zeigt das mit einer Meldung. Ab dann gilt es als richtig.

Kennt das Mod ein Wort noch nicht, steht nach etwa einer halben Sekunde der Vorschlag blass dahinter, getauscht wird
beim nächsten Tastendruck. Das letzte Wort vor Enter wird nur nach Punkt 1 und 2 verbessert, weil du einen Tausch dort
nicht mehr sehen würdest.

Unberührt bleiben eingefügter Text, Code in Backticks, Links, Pfade, Wörter mit Ziffern oder Sonderzeichen,
Abkürzungen in Großbuchstaben und Text, der nicht im Terminal getippt wurde (Remote Control, `claude -p`).

Wie oft es richtig liegt: Bei 210 typischen deutschen Vertippern aus der Autokorrektur von LibreOffice trifft hunspells
erster Vorschlag bei 78 %, unter den ersten drei steht das richtige Wort bei 94 %. Etwa jeder fünfte Tausch geht also
daneben, dafür gibt es die Rücktaste.

## Voraussetzungen

- Claude Code im Terminal, mit Mods (getestet mit Version 2.1.330 unter Linux)
- hunspell, das Prüfprogramm, mit einem Wörterbuch je Sprache (für Deutsch `de_DE`, für englische Fachwörter
  zusätzlich `en_US`)
- git, damit Claude Code das Repo von GitHub holen kann
- die eingebaute Rechtschreibprüfung von Claude Code, eingeschaltet in `~/.claude/settings.json`

Mehr braucht es nicht: kein Node, kein Python und im Betrieb keine Internetverbindung.

## Einrichten

### Am einfachsten: Claude Code macht es

Kopiere diesen Prompt in Claude Code. Es prüft, was fehlt, installiert es nach deinem Okay, schaltet die
Rechtschreibprüfung ein und gibt dir am Ende die Zeile, mit der du das Mod installierst.

```text
Richte mir das Mod „rechtschreibung“ für Claude Code ein (https://github.com/xxhanselxx-sudo/claude-code-rechtschreibung).
Frag mich, bevor du etwas installierst. Braucht ein Befehl mein Passwort (sudo), führe ihn nicht selbst aus, sondern
gib ihn mir zum Eintippen.

1. Prüfe mit `hunspell -v`, ob hunspell installiert ist. Wenn nicht, installiere es mit dem Paketmanager meines Systems.
2. Prüfe mit `hunspell -D </dev/null`, ob die Wörterbücher de_DE und en_US gefunden werden. Fehlt eins, installiere
   es (Debian und Ubuntu: hunspell-de-de, hunspell-en-us). Gibt es kein Paket, nimm die Dateien aus
   https://github.com/LibreOffice/dictionaries.
3. Prüfe mit `git --version`, ob git installiert ist. Wenn nicht, installiere es.
4. Trage in ~/.claude/settings.json diesen Block ein und ändere sonst nichts an der Datei:
   "spellcheck": { "enabled": true, "checker": "hunspell", "language": "de_DE,en_US" }
   Nimm bei "language" nur Wörterbücher, die hunspell wirklich findet.
5. Prüfe mit `echo nciht | hunspell -a -d de_DE`, ob hunspell „nicht“ vorschlägt.
6. Sag mir zum Schluss, was du gemacht hast, und gib mir diese Zeile zum Eintippen:
   /plugin install rechtschreibung --marketplace xxhanselxx-sudo/claude-code-rechtschreibung
```

### Von Hand

1. **hunspell, Wörterbücher und git installieren.** Unter Debian und Ubuntu:

   ```
   sudo apt install hunspell hunspell-de-de hunspell-en-us git
   ```

   Auf anderen Systemen: hunspell gibt es unter https://hunspell.github.io, Wörterbücher für fast jede Sprache unter
   https://github.com/LibreOffice/dictionaries und git unter https://git-scm.com/downloads. Auf dem Mac geht hunspell
   mit `brew install hunspell` (https://brew.sh), die Wörterbücher kommen nach `~/Library/Spelling` (ungeprüft).
2. **Die Rechtschreibprüfung einschalten**, in `~/.claude/settings.json`:

   ```json
   "spellcheck": { "enabled": true, "checker": "hunspell", "language": "de_DE,en_US" }
   ```

   Claude Code unterstreicht dann falsche Wörter rot. Das Mod liest von dort Ein/Aus und Sprache und läuft nur mit
   `"checker": "hunspell"`.
3. **Das Mod installieren**, am Prompt von Claude Code im Terminal:

   ```
   /plugin install rechtschreibung --marketplace xxhanselxx-sudo/claude-code-rechtschreibung
   ```

   Die Frage „Add marketplace?“ mit `y` beantworten, dann den Bereich wählen (Enter nimmt den Benutzer-Bereich). Aus
   der Shell geht es auch:

   ```
   claude plugin install rechtschreibung --marketplace xxhanselxx-sudo/claude-code-rechtschreibung
   ```

## Eigene Wörter, eigene Ersetzungen

- **Eigene Wörter** gelten als richtig und stehen in `~/.hunspell_de_DE`, ein Wort je Zeile (der Name folgt der ersten
  Sprache in der Einstellung). Dorthin schreibt das Mod auch, was es sich merkt.
- **Eigene Ersetzungen** stehen in `~/.claude/rechtschreibung-ersetzungen.json`, in derselben Form wie
  `ersetzungen.json`:

  ```json
  { "teh": "the", "dsa": "das" }
  ```

  Sie gehen der mitgelieferten Liste vor und überstehen Updates. Änderungen gelten nach `/reload-plugins` oder in
  einer neuen Sitzung.

## Andere Sprachen

Die Sprache kommt aus der Einstellung, das Mod selbst hängt an keiner. Für Französisch etwa das französische
Wörterbuch installieren (unter Debian und Ubuntu `hunspell-fr`) und `"language": "fr_FR"` setzen. Deutsch bleiben dann
nur die mitgelieferte Liste, die du durch eine eigene ergänzen kannst, und die Meldungen. Wörter mit Apostroph
(l'homme, c'est, gibt's) lässt das Mod ganz in Ruhe, auch wenn sie falsch geschrieben sind.

## Was das Mod liest und schreibt

Alles bleibt auf deinem Rechner. Das Mod liest `~/.claude/settings.json` (nur den Block `spellcheck`), deinen Verlauf
`~/.claude/history.jsonl` (nur um zu zählen, wie oft du welches Wort schreibst), dein Eigenwörterbuch und deine eigene
Liste. Es ruft `hunspell` auf und schreibt nur ins Eigenwörterbuch, jedes Mal mit Meldung.

## Grenzen

- Tab übernimmt einen blassen Vorschlag nicht, getauscht wird mit dem nächsten Tastendruck.
- Ein Wort, das vor ein schon stehendes Leerzeichen getippt wird, gilt nicht als fertig.
- Geprüft nur im Terminal. In der Desktop-App und in VS Code ist es ungetestet.

## Prüfungen

```
claude plugin test .
```

## Lizenz

MIT, siehe `LICENSE`.
