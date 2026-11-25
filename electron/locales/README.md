# Interface translations

English is the fallback and is written in the HTML and renderer source. Each
additional language has its own file. To add one:

1. Copy `zh-CN.js`, set its BCP 47 locale tag and native display name, and
   translate the message values. Omit keys you are leaving in English.
2. Load the file beside the other locale in `../index.html` and require it
   beside the other locale in `../config.cjs`. The language
   picker uses the registered locale tags and display names.
3. Run `node --test tests/i18n.test.cjs` and check the language in the app.

For static copy, the keys are the trimmed English text nodes and
`placeholder`, `title`, `aria-label` and `alt` values from the initial HTML.
For dynamic copy, use `uiText('English source')` or a tagged template such as
`` uiText`Could not open ${filename}: ${error.message}` ``. The latter looks up
`Could not open {0}: {1}`, then inserts the original values into the
translated string. Placeholders may be reordered. Keep protocol strings,
paths, names, and raw diagnostic output separate from interface copy.
