# Translating CDPlayer

CDPlayer's interface comes in English and Russian. Adding a language is one file: `src/locales/<code>.json`.

## Start

```bash
npm install
npm run i18n -- es        # your language's code: es, de, fr, pt-BR, ja…
```

This creates (or brings up to date) `src/locales/es.json`: every piece of text in the interface, with an empty
translation. Run it again any time — new text is added empty, text that's gone is removed, your translations stay. It
prints how much is done.

## Fill it in

```json
{
  "_language": "Español",
  "_locale": "es",
  "THEME": "TEMA",
  "QUEUE {at} / {of}": "COLA {at} / {of}",
  "{n} TRACKS": { "one": "{n} PISTA", "other": "{n} PISTAS" }
}
```

- `_language` is your language's name **in your language** — it's what Settings → LANGUAGE shows.
- Each key is the English as CDPlayer shows it; the value is your translation. Leave one empty and the English is shown.
- Keep every `{name}` exactly as it is; CDPlayer fills them in (a number, an album, a folder).
- Text with `{n}` can change with the number: write an object of forms instead of a string, using the plural categories
  your language has (`one`, `few`, `many`, `other`… — see
  [Intl.PluralRules](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)).
  `other` is required.
- Labels the interface writes in capitals (`THEME`, `NOW PLAYING`) are capitals in the translation too.
- Buttons are small: keep a translation about as long as the English where you can.
- A key ending in `|something` (`NEXT|step`) is the same English used somewhere else with another meaning; translate it
  for the place it names.
- Not translated, on purpose: the What's New window, theme names, the made-up record shops on receipts, and anything
  from your music's tags.

## Check

```bash
npm test     # placeholders and plural forms are checked for every language
npm start    # Settings → LANGUAGE → your language → RESTART
```

Then open a pull request with just your `src/locales/<code>.json`. Thank you!
