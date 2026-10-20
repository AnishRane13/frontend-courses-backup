---
title: "Internationalization in Node and Express"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Internationalization in Node and Express

*30 min read · Updated 12 Oct 2026 · Topic 116 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 (full ICU 78.3, CLDR 48.0, tz data 2026b) and Express 5.3.0, i18next 26.4.4, i18next-http-middleware 3.9.9, i18next-icu 2.5.0, intl-messageformat 12.1.3, PostgreSQL 18.4 (run locally via the embedded-postgres npm package, no Docker), pg 8.23.1

---

## Why it matters

An API that only ever talks to one country can hard-code `$`, `MM/DD/YYYY` and `"1 items"`. As soon as users in other places sign up, every hard-coded format is a bug report:

- **Numbers and money look different.** `1234.5` euros is `1.234,50 €` in Germany, `€1,234.50` in Ireland, and a yen amount has no decimals at all. India groups digits as `12,34,567`.
- **Dates hide a time zone.** `2026-10-12T22:30Z` is still the 12th in London but already the 13th in Kolkata. A server that formats dates in its own zone shows customers the wrong day.
- **Plurals are not "1 vs many".** English has two plural forms. Polish has four (`1 produkt`, `2 produkty`, `5 produktów`, `1,5 produktu`) and Arabic has six. Code like `count === 1 ? 'item' : 'items'` cannot be translated.
- **Sorting and splitting text depend on language.** JavaScript's default sort puts `Zebra` before `apple` and `Ärzte` after `Zoë`; `'👨‍👩‍👧'.length` is 8.

Internationalization (i18n) is the work of making code locale-neutral: it keeps the data in neutral forms (UTC instants, numbers, message keys) and formats them for a locale only at the edge. Localization (l10n) is the per-language work done on top: the translations and any locale-specific choices.

## The concept, simply

A **locale** is a BCP 47 language tag such as `en-US`, `de-AT` or `pl`: a language, optionally a region, and optionally extras such as a numbering system. Three rules cover most server-side i18n:

1. **Store neutral values.** Instants in UTC (`timestamptz`, ISO strings ending in `Z`), money in integer minor units plus a currency code, text as message keys.
2. **Pick a locale per request.** Read the user's saved preference, a `?lng=` parameter, or the `Accept-Language` header, and match it against the languages you support.
3. **Format at the edge.** Turn the neutral values into text with the built-in `Intl` APIs for numbers, dates, lists and plurals, and a message library (i18next, ICU MessageFormat) for sentences.

text

```
 request ──► detect locale ──► handler works with neutral data ──► format for locale ──► response
 Accept-Language: pl;q=0.9      instant = 2026-10-12T15:30:00Z      "12 paź 2026, 17:30"     Content-Language: pl
 ?lng=de                        total  = 123450 (cents, EUR)        "1 234,50 €"             Vary: Accept-Language
                                key    = cart, count = 5            "5 produktów w koszyku"
```

## How it works

1. **ICU does the formatting.** V8 implements the `Intl` APIs on top of ICU (International Components for Unicode) and its locale data from CLDR (the Unicode Common Locale Data Repository). The Node docs say "The full ICU data set is provided by Node.js by default" (`--with-intl=full-icu (default)`). Builds with `small-icu` (English-only data) or `none` exist, so check `process.versions.icu` and `process.config.variables.icu_small` if you run someone else's binary (Example 1).
2. **A formatter is built once and reused.** `new Intl.NumberFormat(locale, options)` resolves the locale (falling back to a less specific one, then to the default locale) and loads the patterns. `format()` only applies them. `resolvedOptions()` tells you what was actually picked.
3. **The server's own locale and zone are defaults, not user settings.** Without an explicit locale, `Intl` uses the process default (on this machine `en-US`; `LANG=de_DE.UTF-8` changed it to `de-DE`). Without an explicit `timeZone`, it uses the `TZ` environment variable or the OS zone (Example 12).
4. **The request picks the locale.** `Accept-Language: fr-FR,fr;q=0.9,pl;q=0.8` is a list of language ranges with weights from 0 to 1 (1 if omitted). Express's `req.acceptsLanguages(list)` sorts them by weight and returns the best item from *your* list, or `false` (Example 6; full API in [lesson 54](54-express-request-response-api-reference.md)).
5. **A message library maps keys to sentences.** i18next looks up `namespace:key` in the resources for the request's language, walks a fallback chain (`de-AT` → `de` → `en`), interpolates values, and chooses a plural form with `Intl.PluralRules` (Example 7). With `i18next-icu`, messages use ICU MessageFormat syntax instead (`{count, plural, one {…} other {…}}`, Example 8).
6. **The response says what it did.** Set `Content-Language` to the language you served and `Vary: Accept-Language` so a shared cache does not serve the Polish page to a German user.

**The `Intl` APIs at a glance.** All are globals in Node v24.19.0. Each constructor takes `(locales, options)`; each instance has `resolvedOptions()`.

| API | What it does | Example call → output (Node v24.19.0) |
|---|---|---|
| `Intl.NumberFormat` | numbers, currency, percent, units, compact notation | `('de', { notation: 'compact' }).format(1250000)` → `1,3 Mio.` |
| `Intl.DateTimeFormat` | dates and times in a locale and a time zone | `('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' })` → `12 paź 2026, 17:30` |
| `Intl.PluralRules` | maps a number to a CLDR plural category (`zero one two few many other`) | `('pl').select(22)` → `few` |
| `Intl.RelativeTimeFormat` | "yesterday", "in 3 hours" | `('pl', { numeric: 'auto' }).format(-1, 'day')` → `wczoraj` |
| `Intl.ListFormat` | "A, B, and C" / "A, B oder C" | `('de', { type: 'disjunction' })` → `Ada, Lin oder Zoë` |
| `Intl.Collator` | language-aware string comparison for sorting and searching | `('sv').compare` sorts `Ä`/`Ö` after `Z` |
| `Intl.Segmenter` | splits text into graphemes, words or sentences | 14 graphemes in a string whose `.length` is 24 |

**Locale detection, in detail.** A client sends `Accept-Language`; a browser builds it from the user's language settings. Matching is the server's job:

- Weights win over position: `pl;q=0.5, de;q=0.9` prefers German.
- `q=0` means "not acceptable". Express's negotiator drops such entries. The i18next-http-middleware header lookup (3.9.9) parses `q` only to sort, so it still chose `pl` for `Accept-Language: pl;q=0` (Example 7).
- Region tags need a rule. With `supportedLngs: ['de']`, a request for `de-AT` should get German. In i18next that is `nonExplicitSupportedLngs: true`; Express's `req.acceptsLanguages(['de'])` already matched `de-AT` to `de`.
- A saved user preference or an explicit `?lng=` beats the header, because the header reflects a browser setting the user may never have changed. The i18next detector's `order` option sets this priority.

**i18next and its Express middleware.** i18next is a framework-neutral translation library. i18next-http-middleware is its HTTP adapter for Express, Fastify, Hapi, Koa and Deno. Its README says it is "based on the deprecated i18next-express-middleware" and is a drop-in replacement, and npm marks `i18next-express-middleware` as deprecated ("replaced by i18next-http-middleware"), so do not install the old package. The new one is maintained: 3.9.9 was published on 2026-09-08, the seventh release of 2026 (npm `time` field, 3.9.3 on 2026-04-18 through 3.9.9). What `middleware.handle(i18next)` does per request (read from `esm/index.js` of 3.9.9):

1. It clones the shared i18next instance (`i18next.cloneInstance`) so one request's `changeLanguage` cannot affect another request.
2. It runs the `LanguageDetector`, which tries each source in `detection.order` (`querystring`, `cookie`, `header`, and optionally `path` and `session`) and returns the first language that `supportedLngs` allows.
3. It sets `req.language`, `req.languages` (the fallback chain) and `req.t`, sets a `Content-Language` header to the detected language, and fills `res.locals` for templates.
4. With `caches: ['cookie']` it writes the detected language back to a cookie (`lookupCookie`, default `i18next`).

**Namespaces and fallbacks.** A namespace is one file (or object) of keys, for example `common` and `checkout`. Splitting by feature keeps files small and lets a backend load only what a page uses. `t('checkout:pay')` or `t('pay', { ns: 'checkout' })` selects one; `defaultNS` is used otherwise. When a key is missing in the current language, i18next tries the next language in the chain and finally `fallbackLng`; when it is missing everywhere, `t()` returns the key itself (`nope` in Example 7), which shows up in the UI as an untranslated key.

**ICU MessageFormat.** i18next's own JSON format chooses plural forms by key suffix (`items_one`, `items_few`, `items_many`, `items_other`). ICU MessageFormat puts the whole choice into one string, which translators and translation tools know: `{count, plural, =0 {…} one {# item} other {# items}}`, `{gender, select, female {…} other {…}}`, plus `selectordinal`, `number`, `date` and `time` arguments. `#` is the number formatted for the locale. Two libraries are used here: **intl-messageformat 12.1.3** (FormatJS) parses and formats ICU messages, and **i18next-icu 2.5.0** plugs it into i18next (its peer dependency range is `intl-messageformat >=10.3.3 <13.0.0`). The i18next-icu README warns that with the plugin "only the ICU message format is respected": `{{name}}` becomes `{name}`.

**Time zones.** Store instants, convert at the edge:

- `Date` holds one number: milliseconds since 1970-01-01T00:00:00Z. `toISOString()` always prints it in UTC with a `Z`. `toString()`, `toLocaleString()` and `getDate()` use the process time zone.
- PostgreSQL `timestamptz` does not store a zone either. The PostgreSQL 18 docs: "the value is stored internally as UTC, and the originally stated or assumed time zone is not retained". The session's `TimeZone` setting (`SET TIME ZONE`) only changes how the value is printed and how zone-less input is read (Example 10).
- PostgreSQL `timestamp` (without time zone) stores a wall-clock reading with no zone at all. node-postgres writes a JS `Date` into it as local time and reads it back as local time, so two servers in different zones disagree about the same row (Example 11).
- Keep the user's IANA zone name (`Europe/Warsaw`, not `+02:00`) when you need to show their local time or schedule something "at 9:00 their time": offsets change with daylight saving time.

**Temporal in Node 24.** `Temporal` is the new date-time API for JavaScript (`ZonedDateTime`, `PlainDate`, `Instant`, `Duration`). In Node v24.19.0 (V8 13.6.233.17-node.51) it is **not available by default**: `typeof Temporal` is `'undefined'`. V8 has an option `--harmony-temporal`, listed by `node --v8-options` as `enable "Temporal" (in progress / experimental)`, and `node --harmony-temporal` does create a `Temporal` global. That build is an old snapshot of the proposal: it still has `Temporal.TimeZone` and `Temporal.Calendar` classes, which are not in the current MDN reference, it has no `Temporal.Now.timeZoneId()`, and `ZonedDateTime.prototype.toLocaleString` printed the time in the process zone and not in the value's own zone (Example 14). Do not use the flag in production; use `Date` plus `Intl` with an explicit `timeZone`, or a library, until a Node release enables Temporal by default.

## Code examples

**Example 1 — check the ICU build and see one value in six locales.** The machine's own zone is `Asia/Kolkata`, which ICU 78.3 reports by its older alias `Asia/Calcutta`.

javascript

```
// icu-check.mjs — which ICU does this Node have, and does it know other locales?
console.log('icu:', process.versions.icu, '| unicode:', process.versions.unicode,
  '| cldr:', process.versions.cldr, '| tz data:', process.versions.tz);
console.log('small-icu build:', process.config.variables.icu_small);
console.log('time zones:', Intl.supportedValuesOf('timeZone').length, '| currencies:', Intl.supportedValuesOf('currency').length);
console.log('defaults:', Intl.DateTimeFormat().resolvedOptions());
console.log('supported:', Intl.DateTimeFormat.supportedLocalesOf(['pl-PL', 'ar-EG', 'ja-JP', 'hi-IN', 'xx-XX']));
const when = new Date('2026-10-12T15:30:00Z');
for (const locale of ['en-US', 'de-DE', 'pl-PL', 'ar-EG', 'ja-JP', 'hi-IN']) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(when);
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(1234567.891);
  console.log(locale.padEnd(6), '|', date, '|', money);
}
console.log('digits: ar =', new Intl.NumberFormat('ar').resolvedOptions().numberingSystem,
  '| ar-EG =', new Intl.NumberFormat('ar-EG').resolvedOptions().numberingSystem);

// Real output (Node v24.19.0, full ICU 78.3):
//   icu: 78.3 | unicode: 17.0 | cldr: 48.0 | tz data: 2026b
//   small-icu build: false
//   time zones: 418 | currencies: 162
//   defaults: {
//     locale: 'en-US',
//     calendar: 'gregory',
//     numberingSystem: 'latn',
//     timeZone: 'Asia/Calcutta',
//     year: 'numeric',
//     month: 'numeric',
//     day: 'numeric'
//   }
//   supported: [ 'pl-PL', 'ar-EG', 'ja-JP', 'hi-IN' ]
//   en-US  | Monday, October 12, 2026 | €1,234,567.89
//   de-DE  | Montag, 12. Oktober 2026 | 1.234.567,89 €
//   pl-PL  | poniedziałek, 12 października 2026 | 1 234 567,89 €
//   ar-EG  | الاثنين، ١٢ أكتوبر ٢٠٢٦ | ‏١٬٢٣٤٬٥٦٧٫٨٩ €
//   ja-JP  | 2026年10月12日月曜日 | €1,234,567.89
//   hi-IN  | सोमवार, 12 अक्टूबर 2026 | €12,34,567.89
//   digits: ar = latn | ar-EG = arab
```

`small-icu build: false` and 418 known time zones mean the full data set is present. `supportedLocalesOf` dropped `xx-XX`, so it is a quick way to see which of your languages ICU can format. `ar-EG` uses Arabic-Indic digits; plain `ar` uses Latin digits in this CLDR version (last line), which is visible again in Example 8.

**Example 2 — `Intl.NumberFormat`: currency, compact notation, units.**

javascript

```
// numbers.mjs — Intl.NumberFormat: currency, compact, units
const show = (label, value) => console.log(label.padEnd(22), value);
const price = 1234.5;
show('en-US USD', new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price));
show('de-DE EUR', new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price));
show('ja-JP JPY', new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(price));
show('en-IN INR', new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(1234567.5));
show('en-US EUR code', new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', currencyDisplay: 'code' }).format(price));
show('en-US accounting', new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', currencySign: 'accounting' }).format(-price));
show('en compact', new Intl.NumberFormat('en', { notation: 'compact' }).format(1_250_000));
show('de compact', new Intl.NumberFormat('de', { notation: 'compact' }).format(1_250_000));
show('ja compact', new Intl.NumberFormat('ja', { notation: 'compact' }).format(1_250_000));
show('en-IN compact', new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(1_250_000));
show('en unit km/h', new Intl.NumberFormat('en', { style: 'unit', unit: 'kilometer-per-hour' }).format(88));
show('de unit long', new Intl.NumberFormat('de', { style: 'unit', unit: 'liter', unitDisplay: 'long' }).format(2.5));
show('fr percent', new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(0.1234));
show('en bytes', new Intl.NumberFormat('en', { style: 'unit', unit: 'megabyte', unitDisplay: 'narrow' }).format(512));
try { new Intl.NumberFormat('en', { style: 'currency' }); } catch (e) { show('no currency', `${e.name}: ${e.message}`); }
try { new Intl.NumberFormat('en', { style: 'unit', unit: 'furlong' }); } catch (e) { show('bad unit', `${e.name}: ${e.message}`); }

// Real output (Node v24.19.0, ICU 78.3):
//   en-US USD              $1,234.50
//   de-DE EUR              1.234,50 €
//   ja-JP JPY              ￥1,235
//   en-IN INR              ₹12,34,567.50
//   en-US EUR code         EUR 1,234.50
//   en-US accounting       ($1,234.50)
//   en compact             1.3M
//   de compact             1,3 Mio.
//   ja compact             125万
//   en-IN compact          13L
//   en unit km/h           88 km/h
//   de unit long           2,5 Liter
//   fr percent             12,3 %
//   en bytes               512MB
//   no currency            TypeError: Currency code is required with currency style.
//   bad unit               RangeError: Invalid unit argument for Intl.NumberFormat() 'furlong'
```

The currency decides the number of decimals (JPY has none, so `1234.5` became `￥1,235`); the locale decides the symbol position, the separators and the digit grouping (`₹12,34,567.50`). Unit identifiers come from a fixed list in ECMA-402 (`kilometer-per-hour`, `liter`, `megabyte`…); anything else is a `RangeError`.

**Example 3 — `Intl.DateTimeFormat` with `timeZone` and `dateStyle`.** The stored value is one UTC instant; each user sees it in their own locale and zone.

javascript

```
// dates.mjs — one instant, shown in the user's locale and time zone
const instant = new Date('2026-10-12T15:30:00Z'); // stored value: UTC
const users = [
  ['en-US', 'America/New_York'],
  ['en-GB', 'Europe/London'],
  ['de-DE', 'Europe/Berlin'],
  ['pl-PL', 'Europe/Warsaw'],
  ['ja-JP', 'Asia/Tokyo'],
  ['hi-IN', 'Asia/Kolkata'],
];
for (const [locale, timeZone] of users) {
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  console.log(locale.padEnd(6), timeZone.padEnd(17), fmt.format(instant));
}
// timeZoneName, and the parts if you need to build your own layout
const ny = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
console.log(ny.format(instant));
console.log(ny.formatToParts(instant).map((p) => `${p.type}=${p.value}`).join(' '));
// dateStyle cannot be mixed with individual fields
try { new Intl.DateTimeFormat('en', { dateStyle: 'short', hour: 'numeric' }); }
catch (e) { console.log(`${e.name}: ${e.message}`); }
// an unknown zone name throws instead of falling back
try { new Intl.DateTimeFormat('en', { timeZone: 'Mars/Olympus' }); }
catch (e) { console.log(`${e.name}: ${e.message}`); }

// Real output (Node v24.19.0, ICU 78.3, tz data 2026b):
//   en-US  America/New_York  Oct 12, 2026, 11:30 AM
//   en-GB  Europe/London     12 Oct 2026, 16:30
//   de-DE  Europe/Berlin     12.10.2026, 17:30
//   pl-PL  Europe/Warsaw     12 paź 2026, 17:30
//   ja-JP  Asia/Tokyo        2026/10/13 0:30
//   hi-IN  Asia/Kolkata      12 अक्टू॰ 2026, 9:00 pm
//   11:30 AM EDT
//   hour=11 literal=: minute=30 literal=  dayPeriod=AM literal=  timeZoneName=EDT
//   TypeError: Invalid option : option
//   RangeError: Invalid time zone specified: Mars/Olympus
```

The Tokyo user sees the next day. `dateStyle`/`timeStyle` cannot be combined with individual fields such as `hour`; V8's error message for that is the unhelpful `Invalid option : option`. Pass zone names from user input through a `try` or check them against `Intl.supportedValuesOf('timeZone')`.

**Example 4 — `PluralRules`, `RelativeTimeFormat`, `ListFormat`, `Collator`, `Segmenter`.**

javascript

```
// more-intl.mjs — PluralRules, RelativeTimeFormat, ListFormat, Collator, Segmenter
const counts = [0, 1, 2, 3, 5, 11, 12, 22, 25, 101, 1.5];
for (const locale of ['en', 'pl', 'ar']) {
  const pr = new Intl.PluralRules(locale);
  console.log(locale, pr.resolvedOptions().pluralCategories.join('/'));
  console.log('  ', counts.map((n) => `${n}:${pr.select(n)}`).join(' '));
}
const ordinal = new Intl.PluralRules('en', { type: 'ordinal' });
const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
console.log([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map((n) => n + suffix[ordinal.select(n)]).join(' '));

const rtfEn = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const rtfPl = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });
console.log(rtfEn.format(-1, 'day'), '|', rtfEn.format(3, 'hour'), '|', rtfEn.format(-5, 'minute'));
console.log(rtfPl.format(-1, 'day'), '|', rtfPl.format(3, 'hour'), '|', rtfPl.format(-5, 'minute'));

const items = ['Ada', 'Lin', 'Zoë'];
console.log(new Intl.ListFormat('en', { type: 'conjunction' }).format(items));
console.log(new Intl.ListFormat('de', { type: 'disjunction' }).format(items));
console.log(new Intl.ListFormat('pl', { type: 'conjunction' }).format(items));

const names = ['Zoë', 'Ärzte', 'apple', 'Zebra', 'Österreich', 'file10', 'file9'];
console.log('default sort:', [...names].sort().join(', '));
console.log('de collator: ', [...names].sort(new Intl.Collator('de').compare).join(', '));
console.log('sv collator: ', [...names].sort(new Intl.Collator('sv').compare).join(', '));
console.log('numeric:     ', ['file10', 'file9', 'file1'].sort(new Intl.Collator('en', { numeric: true }).compare).join(', '));
const base = new Intl.Collator('en', { sensitivity: 'base' });
console.log('base equal:  ', base.compare('resume', 'Résumé') === 0);

const text = 'Hi 👋🏽 family 👨‍👩‍👧!';
const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)];
console.log('length:', text.length, '| graphemes:', graphemes.length);
const ja = '東京都に住んでいます';
const words = [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(ja)]
  .filter((s) => s.isWordLike).map((s) => s.segment);
console.log('ja words:', words.join(' | '));

// Real output (Node v24.19.0, ICU 78.3, CLDR 48.0):
//   en one/other
//      0:other 1:one 2:other 3:other 5:other 11:other 12:other 22:other 25:other 101:other 1.5:other
//   pl one/few/many/other
//      0:many 1:one 2:few 3:few 5:many 11:many 12:many 22:few 25:many 101:many 1.5:other
//   ar zero/one/two/few/many/other
//      0:zero 1:one 2:two 3:few 5:few 11:many 12:many 22:many 25:many 101:other 1.5:other
//   1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 101st
//   yesterday | in 3 hours | 5 minutes ago
//   wczoraj | za 3 godziny | 5 minut temu
//   Ada, Lin, and Zoë
//   Ada, Lin oder Zoë
//   Ada, Lin i Zoë
//   default sort: Zebra, Zoë, apple, file10, file9, Ärzte, Österreich
//   de collator:  apple, Ärzte, file10, file9, Österreich, Zebra, Zoë
//   sv collator:  apple, file10, file9, Zebra, Zoë, Ärzte, Österreich
//   numeric:      file1, file9, file10
//   base equal:   true
//   length: 24 | graphemes: 14
//   ja words: 東京 | 都 | に | 住 | んで | い | ます
```

Read the plural lines carefully: Polish 22 is `few` but 25 is `many`, and Arabic uses all six categories. `1.5` is `other` in all three. The default `sort()` compares UTF-16 code units, so capitals come first and `Ä` comes after `z`. German and Swedish collators disagree about `Ä`/`Ö`, which is why the collator must use the user's locale, not the server's. `sensitivity: 'base'` treats `resume` and `Résumé` as equal, which is what a search box usually wants.

**Example 5 — edge case: formatted strings contain no-break spaces.** A test that compares `format()` output with a string typed in an editor can fail even though the two look identical.

javascript

```
// nbsp.mjs — formatted strings contain no-break spaces, not U+0020
const hex = (s) => [...s].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join(' ');
const de = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(1234.5);
const fr = new Intl.NumberFormat('fr-FR').format(1234567);
const time = new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: 'UTC' }).format(new Date(0));
console.log(JSON.stringify(de), de === '1.234,50 €', hex(de));
console.log(JSON.stringify(fr), hex(fr));
console.log(JSON.stringify(time), time === '12:00 AM', hex(time));
// In a test, normalise both kinds of no-break space before comparing
const normalise = (s) => s.replace(/[  ]/g, ' ');
console.log(normalise(de) === '1.234,50 €', normalise(time) === '12:00 AM');

// Real output (Node v24.19.0, ICU 78.3):
//   "1.234,50 €" false 0031 002e 0032 0033 0034 002c 0035 0030 00a0 20ac
//   "1 234 567" 0031 202f 0032 0033 0034 202f 0035 0036 0037
//   "12:00 AM" true 0031 0032 003a 0030 0030 0020 0041 004d
//   true true
```

German currency puts U+00A0 NO-BREAK SPACE before `€`; French digit grouping uses U+202F NARROW NO-BREAK SPACE. The `en-US` time in this ICU version uses a plain space. These characters come from CLDR and can change when Node updates ICU, so tests should normalise them or build the expected value with the same formatter, and an API should never parse formatted strings back into numbers.

**Example 6 — locale detection with `req.acceptsLanguages()` and q-values.** No i18n library yet: just Express choosing from four supported languages.

javascript

```
// negotiate.mjs — req.acceptsLanguages() with q-values (Express 5.3.0)
import express from 'express';

const SUPPORTED = ['en', 'de', 'pl', 'pt-BR'];
const app = express();
app.get('/', (req, res) => {
  res.vary('Accept-Language');
  res.json({ all: req.acceptsLanguages(), pick: req.acceptsLanguages(SUPPORTED) || 'en (fallback)' });
});

const server = app.listen(7501, async () => {
  const headers = [
    'pl;q=0.5, de;q=0.9, en;q=0.1', // order by q, not by position
    'de-AT',                         // region tag, only the base language is supported
    'pt',                            // base tag, only a region variant is supported
    'fr, *;q=0.1',                   // wildcard
    'en;q=0, de;q=0',                // q=0 means "not acceptable"
    null,                            // no header at all
  ];
  for (const h of headers) {
    const r = await fetch('http://127.0.0.1:7501/', { headers: h === null ? {} : { 'Accept-Language': h } });
    console.log(String(h).padEnd(31), JSON.stringify(await r.json()));
  }
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0, accepts 2.0.0, negotiator 1.1.0):
//   pl;q=0.5, de;q=0.9, en;q=0.1    {"all":["de","pl","en"],"pick":"de"}
//   de-AT                           {"all":["de-AT"],"pick":"de"}
//   pt                              {"all":["pt"],"pick":"pt-BR"}
//   fr, *;q=0.1                     {"all":["fr","*"],"pick":"en"}
//   en;q=0, de;q=0                  {"all":[],"pick":"en (fallback)"}
//   null                            {"all":["*"],"pick":"en"}
```

What the six cases show:

- The highest `q` wins, regardless of order in the header.
- `de-AT` matched the supported `de`, and a bare `pt` matched the supported `pt-BR`.
- For `*`, and for a request with no header (which Express treats as `*`), the result is the *first* item of your list, so put your default language first.
- When everything is `q=0`, `acceptsLanguages` returns `false`; the `|| 'en (fallback)'` is the application's choice.

**Example 7 — i18next in Express with namespaces, fallbacks and plurals.** Resources are inline to keep the example in one file; in a real app they would be JSON files under `locales/{{lng}}/{{ns}}.json` loaded by a backend such as i18next-fs-backend.

bash

```
$ npm install express@5.3.0 i18next@26.4.4 i18next-http-middleware@3.9.9
```

javascript

```
// app.mjs — Express 5.3.0 + i18next 26.4.4 + i18next-http-middleware 3.9.9
import express from 'express';
import i18next from 'i18next';
import * as middleware from 'i18next-http-middleware';

const resources = {
  en: {
    common: { greeting: 'Hello, {{name}}!', items_one: '{{count}} item', items_other: '{{count}} items' },
    checkout: { pay: 'Pay now', refund: 'Refunds take 5 days' },
  },
  de: {
    common: { greeting: 'Hallo, {{name}}!', items_one: '{{count}} Artikel', items_other: '{{count}} Artikel' },
    checkout: { pay: 'Jetzt bezahlen' }, // no "refund": falls back to en
  },
  pl: {
    common: {
      greeting: 'Cześć, {{name}}!',
      items_one: '{{count}} produkt', items_few: '{{count}} produkty',
      items_many: '{{count}} produktów', items_other: '{{count}} produktu',
    },
    checkout: { pay: 'Zapłać teraz', refund: 'Zwrot trwa 5 dni' },
  },
};

await i18next.use(middleware.LanguageDetector).init({
  resources,
  supportedLngs: ['en', 'de', 'pl'],
  nonExplicitSupportedLngs: true, // accept de-AT, pl-PL… and resolve them to de, pl
  fallbackLng: 'en',
  ns: ['common', 'checkout'],
  defaultNS: 'common',
  detection: { order: ['querystring', 'header'], lookupQuerystring: 'lng', caches: false },
  interpolation: { escapeValue: false }, // we send JSON, not HTML
});

const app = express();
app.use(middleware.handle(i18next));

app.get('/hello', (req, res) => {
  const n = Number(req.query.n ?? 1);
  res.set('Content-Language', req.resolvedLanguage);
  res.vary('Accept-Language');
  res.json({
    detected: req.language,
    resolved: req.resolvedLanguage,
    chain: req.languages,
    express: req.acceptsLanguages('en', 'de', 'pl'),
    greeting: req.t('greeting', { name: 'Ada' }),
    items: req.t('items', { count: n }),
    pay: req.t('checkout:pay'),
    refund: req.t('refund', { ns: 'checkout' }),
    missing: req.t('checkout:nope'),
  });
});

const server = app.listen(7500, async () => {
  const cases = [
    ['de-AT,de;q=0.9,en;q=0.5', ''],
    ['fr-FR,fr;q=0.9,pl;q=0.8,en;q=0.5', '?n=5'],
    ['en;q=0.2, pl;q=0.9', '?n=22'],
    ['ja', '?n=2'],
    ['pl', '?lng=de&n=3'],
    ['pl;q=0', ''],
  ];
  for (const [header, qs] of cases) {
    const r = await fetch(`http://127.0.0.1:7500/hello${qs}`, { headers: { 'Accept-Language': header } });
    console.log(`Accept-Language: ${header} ${qs}`);
    console.log('  ', r.headers.get('content-language'), JSON.stringify(await r.json()));
  }
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0, i18next 26.4.4, i18next-http-middleware 3.9.9):
//   Accept-Language: de-AT,de;q=0.9,en;q=0.5 
//      de {"detected":"de-AT","resolved":"de","chain":["de-AT","de","en"],"express":"de","greeting":"Hallo, Ada!","items":"1 Artikel","pay":"Jetzt bezahlen","refund":"Refunds take 5 days","missing":"nope"}
//   Accept-Language: fr-FR,fr;q=0.9,pl;q=0.8,en;q=0.5 ?n=5
//      pl {"detected":"pl","resolved":"pl","chain":["pl","en"],"express":"pl","greeting":"Cześć, Ada!","items":"5 produktów","pay":"Zapłać teraz","refund":"Zwrot trwa 5 dni","missing":"nope"}
//   Accept-Language: en;q=0.2, pl;q=0.9 ?n=22
//      pl {"detected":"pl","resolved":"pl","chain":["pl","en"],"express":"pl","greeting":"Cześć, Ada!","items":"22 produkty","pay":"Zapłać teraz","refund":"Zwrot trwa 5 dni","missing":"nope"}
//   Accept-Language: ja ?n=2
//      en {"detected":"en","resolved":"en","chain":["en"],"express":false,"greeting":"Hello, Ada!","items":"2 items","pay":"Pay now","refund":"Refunds take 5 days","missing":"nope"}
//   Accept-Language: pl ?lng=de&n=3
//      de {"detected":"de","resolved":"de","chain":["de","en"],"express":"pl","greeting":"Hallo, Ada!","items":"3 Artikel","pay":"Jetzt bezahlen","refund":"Refunds take 5 days","missing":"nope"}
//   Accept-Language: pl;q=0 
//      pl {"detected":"pl","resolved":"pl","chain":["pl","en"],"express":false,"greeting":"Cześć, Ada!","items":"1 produkt","pay":"Zapłać teraz","refund":"Zwrot trwa 5 dni","missing":"nope"}
```

What each request shows:

- **`de-AT`**: `req.language` is the detected `de-AT`, `req.resolvedLanguage` is `de` (thanks to `nonExplicitSupportedLngs`). `refund` is missing in German, so it came from `en`, the `fallbackLng`. `checkout:nope` is missing everywhere, so `t()` returned the key.
- **`fr-FR,fr;q=0.9,pl;q=0.8,en;q=0.5`**: French is not supported; the detector took the next entry, `pl`. `5` selected `items_many` (`produktów`).
- **`en;q=0.2, pl;q=0.9`**: sorted by q, so Polish; `22` is `few` (`produkty`).
- **`ja`**: unsupported, so `fallbackLng`; Express's own `acceptsLanguages` returned `false`.
- **`?lng=de` with `Accept-Language: pl`**: `querystring` comes before `header` in `detection.order`, so German won.
- **`pl;q=0`**: the client said Polish is *not* acceptable, yet the detector chose Polish; `acceptsLanguages` correctly returned `false`. If that matters to you, write a custom detector or pre-filter the header.

The handler sets `Content-Language` to the resolved language (the middleware had already set it to the detected one, `de-AT`) and adds `Vary: Accept-Language`. `escapeValue: false` is right for JSON responses; leave the default (`true`) when `t()` output goes into HTML.

**Example 8 — ICU MessageFormat plurals and `select`: English vs Polish vs Arabic.**

bash

```
$ npm install i18next@26.4.4 i18next-icu@2.5.0 intl-messageformat@12.1.3
```

javascript

```
// icu-messages.mjs — ICU MessageFormat via i18next-icu 2.5.0 (intl-messageformat 12.1.3 under it)
import i18next from 'i18next';
import ICU from 'i18next-icu';

const resources = {
  en: { translation: {
    cart: '{count, plural, =0 {Your cart is empty} one {# item in your cart} other {# items in your cart}}',
    invite: '{gender, select, female {She invited you} male {He invited you} other {They invited you}}',
  } },
  pl: { translation: {
    cart: '{count, plural, =0 {Koszyk jest pusty} one {# produkt w koszyku} few {# produkty w koszyku} many {# produktów w koszyku} other {# produktu w koszyku}}',
    invite: '{gender, select, female {Zaprosiła cię} male {Zaprosił cię} other {Zaproszono cię}}',
  } },
  ar: { translation: {
    cart: '{count, plural, zero {لا منتجات} one {منتج واحد} two {منتجان} few {# منتجات} many {# منتجًا} other {# منتج}}',
  } },
};

const i18n = i18next.createInstance();
await i18n.use(ICU).init({ resources, lng: 'en', fallbackLng: 'en' });

for (const lng of ['en', 'pl', 'ar']) {
  const t = i18n.getFixedT(lng);
  console.log(lng, [0, 1, 2, 5, 22, 1.5].map((count) => t('cart', { count })).join(' | '));
}
for (const lng of ['en', 'pl']) {
  const t = i18n.getFixedT(lng);
  console.log(lng, ['female', 'male', 'nonbinary'].map((gender) => t('invite', { gender })).join(' | '));
}

// Real output (Node v24.19.0, i18next 26.4.4, i18next-icu 2.5.0, intl-messageformat 12.1.3):
//   en Your cart is empty | 1 item in your cart | 2 items in your cart | 5 items in your cart | 22 items in your cart | 1.5 items in your cart
//   pl Koszyk jest pusty | 1 produkt w koszyku | 2 produkty w koszyku | 5 produktów w koszyku | 22 produkty w koszyku | 1,5 produktu w koszyku
//   ar لا منتجات | منتج واحد | منتجان | 5 منتجات | 22 منتجًا | 1.5 منتج
//   en She invited you | He invited you | They invited you
//   pl Zaprosiła cię | Zaprosił cię | Zaproszono cię
```

The same `count` values select different branches per language: `22` is `other` in English, `few` in Polish and `many` in Arabic. `=0` is an exact-value match and is checked before the category, which is why English and Polish print a special empty-cart sentence. Arabic uses the CLDR `zero` category for the same purpose. `#` is formatted for the locale: `1,5` in Polish. The `select` branch keys are plain strings; `other` catches every value you did not list (`nonbinary` here).

**Example 9 — edge case: three ICU message traps, with intl-messageformat directly.**

javascript

```
// imf-edge.mjs — intl-messageformat 12.1.3 used directly: two plural traps
import { IntlMessageFormat } from 'intl-messageformat';

// Trap 1: "zero" is a CLDR category. English has no "zero" category, so it never matches.
const wrong = new IntlMessageFormat('{n, plural, zero {no files} one {# file} other {# files}}', 'en');
const right = new IntlMessageFormat('{n, plural, =0 {no files} one {# file} other {# files}}', 'en');
console.log('zero {…}:', wrong.format({ n: 0 }), '| =0 {…}:', right.format({ n: 0 }));

// Trap 2: every plural/select needs an "other" branch; the parser rejects the message.
try {
  new IntlMessageFormat('{n, plural, one {# file}}', 'en');
} catch (e) {
  console.log(`${e.name}: ${e.message}`);
}

// Trap 3: a missing variable throws at format time.
try {
  right.format({});
} catch (e) {
  console.log(`${e.name}: ${e.message}`);
}

// Number, date and selectordinal arguments use Intl under the hood
const msg = new IntlMessageFormat(
  'Paid {amount, number, ::currency/EUR} on {when, date, long}, your {k, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} order',
  'en-GB',
);
console.log(msg.format({ amount: 1234.5, when: new Date('2026-10-12T12:00:00Z'), k: 23 }));

// Real output (Node v24.19.0, intl-messageformat 12.1.3):
//   zero {…}: 0 files | =0 {…}: no files
//   SyntaxError: MISSING_OTHER_CLAUSE
//   Error: The intl string context variable "n" was not provided to the string "{n, plural, =0 {no files} one {# file} other {# files}}"
//   Paid €1,234.50 on 12 October 2026, your 23rd order
```

1. `zero {…}` in an English message never matches, because English has no `zero` category: `0` is `other`. Use `=0` for "exactly zero".
2. A plural or select without `other` is rejected when the message is parsed (`MISSING_OTHER_CLAUSE`). Parse every message in CI so a bad translation fails the build, not a request.
3. A missing argument throws at format time. i18next-icu's default `parseErrorHandler` "swallows the error and returns the unsubstituted string" (README), so in an i18next app the user sees the raw `{count, plural, …}` text instead.

The last line shows `number` with a skeleton (`::currency/EUR`), `date, long` and `selectordinal`, all formatted through `Intl`.

**Example 10 — store UTC: `toISOString()` and PostgreSQL `timestamptz`.** Same stored row, three session time zones. PostgreSQL 18.4 runs locally on port 7510 (started with the embedded-postgres package, as in [lesson 80](80-database-migrations-and-seeding.md)); `npm install pg@8.23.1`.

javascript

```
// tz-pg.mjs — timestamptz stores an instant; SET TIME ZONE changes only how it is shown
// PostgreSQL 18.4, pg 8.23.1
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('DROP TABLE IF EXISTS events');
await client.query('CREATE TABLE events (id int PRIMARY KEY, at timestamptz NOT NULL)');

const instant = new Date('2026-10-12T15:30:00Z');
console.log('JS toISOString():', instant.toISOString());
await client.query('INSERT INTO events VALUES (1, $1)', [instant.toISOString()]);

for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
  await client.query(`SET TIME ZONE '${zone}'`);
  const { rows: [row] } = await client.query(
    `SELECT at::text AS shown, extract(epoch FROM at) AS epoch, at FROM events WHERE id = 1`);
  console.log(zone.padEnd(16), '| shown:', row.shown, '| epoch:', row.epoch,
    '| pg Date:', row.at.toISOString());
}

// Converting for display inside SQL: AT TIME ZONE returns a plain timestamp (wall clock)
const { rows: [w] } = await client.query(
  `SELECT (at AT TIME ZONE 'Europe/Warsaw')::text AS warsaw_wall_clock FROM events WHERE id = 1`);
console.log('AT TIME ZONE:', w.warsaw_wall_clock);
await client.end();
```

bash

```
$ export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:7510/app
$ node tz-pg.mjs
JS toISOString(): 2026-10-12T15:30:00.000Z
UTC              | shown: 2026-10-12 15:30:00+00 | epoch: 1791819000.000000 | pg Date: 2026-10-12T15:30:00.000Z
America/New_York | shown: 2026-10-12 11:30:00-04 | epoch: 1791819000.000000 | pg Date: 2026-10-12T15:30:00.000Z
Asia/Tokyo       | shown: 2026-10-13 00:30:00+09 | epoch: 1791819000.000000 | pg Date: 2026-10-12T15:30:00.000Z
AT TIME ZONE: 2026-10-12 17:30:00
```

`SET TIME ZONE` changed the text PostgreSQL prints (`15:30+00`, `11:30-04`, `00:30+09` on the next day) but not the epoch, and node-postgres parsed every version into the same `Date`. `AT TIME ZONE 'Europe/Warsaw'` turns a `timestamptz` into a zone-less wall-clock `timestamp` for display or for grouping "by local day".

**Example 11 — edge case: `timestamp` without time zone and servers in different zones.** One server in India writes a `Date` into both column types; servers in UTC and New York read the row.

javascript

```
// naive.mjs — the same Date through `timestamp` (no zone) and `timestamptz`, from servers in different TZs
// usage: TZ=… node naive.mjs write|read     (PostgreSQL 18.4, pg 8.23.1)
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
if (process.argv[2] === 'write') {
  await client.query('DROP TABLE IF EXISTS orders');
  await client.query('CREATE TABLE orders (id int PRIMARY KEY, naive timestamp, aware timestamptz)');
  const d = new Date('2026-10-12T15:30:00Z');
  await client.query('INSERT INTO orders VALUES (1, $1, $2)', [d, d]);
  console.log(`TZ=${process.env.TZ} wrote ${d.toISOString()}`);
}
const { rows: [r] } = await client.query('SELECT naive, aware, naive::text AS naive_text FROM orders');
console.log(`TZ=${process.env.TZ} read  naive=${r.naive.toISOString()} (stored '${r.naive_text}')  aware=${r.aware.toISOString()}`);
await client.end();
```

bash

```
$ TZ=Asia/Kolkata node naive.mjs write
TZ=Asia/Kolkata wrote 2026-10-12T15:30:00.000Z
TZ=Asia/Kolkata read  naive=2026-10-12T15:30:00.000Z (stored '2026-10-12 21:00:00')  aware=2026-10-12T15:30:00.000Z
$ TZ=UTC node naive.mjs read
TZ=UTC read  naive=2026-10-12T21:00:00.000Z (stored '2026-10-12 21:00:00')  aware=2026-10-12T15:30:00.000Z
$ TZ=America/New_York node naive.mjs read
TZ=America/New_York read  naive=2026-10-13T01:00:00.000Z (stored '2026-10-12 21:00:00')  aware=2026-10-12T15:30:00.000Z
```

node-postgres 8.23.1 sent the `Date` as local time with an offset (`dateToString` in `pg/lib/utils.js` uses `getTimezoneOffset()`; the default `parseInputDatesAsUTC: false`); the `timestamp` column threw the offset away and kept `21:00`, the wall clock in Kolkata. Each reader then interpreted `21:00` in *its* zone, so the "same" order is at three different instants. The `timestamptz` column gave all three the right instant. A first draft of this script passed one `$1` for both columns and PostgreSQL refused it with `inconsistent types deduced for parameter $1` (code `42P08`, `timestamp without time zone versus timestamp with time zone`), so it uses `$1, $2`.

**Example 12 — edge case: `toLocaleString()` without `timeZone` depends on the server.**

javascript

```
// server-tz.mjs — run with different TZ values: the same instant prints differently
const d = new Date('2026-10-12T22:30:00Z');
console.log('TZ =', process.env.TZ ?? '(unset)', '| resolved:', Intl.DateTimeFormat().resolvedOptions().timeZone);
console.log('  toISOString()          ', d.toISOString());
console.log('  toString()             ', d.toString());
console.log('  toLocaleString("en-GB")', d.toLocaleString('en-GB'));
console.log('  getDate()              ', d.getDate(), '(local day)  getUTCDate():', d.getUTCDate());
console.log('  with timeZone          ', d.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
```

bash

```
$ TZ=UTC node server-tz.mjs
TZ = UTC | resolved: UTC
  toISOString()           2026-10-12T22:30:00.000Z
  toString()              Mon Oct 12 2026 22:30:00 GMT+0000 (Coordinated Universal Time)
  toLocaleString("en-GB") 12/10/2026, 22:30:00
  getDate()               12 (local day)  getUTCDate(): 12
  with timeZone           12/10/2026, 23:30:00
$ TZ=Asia/Kolkata node server-tz.mjs
TZ = Asia/Kolkata | resolved: Asia/Calcutta
  toISOString()           2026-10-12T22:30:00.000Z
  toString()              Tue Oct 13 2026 04:00:00 GMT+0530 (India Standard Time)
  toLocaleString("en-GB") 13/10/2026, 04:00:00
  getDate()               13 (local day)  getUTCDate(): 12
  with timeZone           12/10/2026, 23:30:00
$ TZ=America/Los_Angeles node server-tz.mjs
TZ = America/Los_Angeles | resolved: America/Los_Angeles
  toISOString()           2026-10-12T22:30:00.000Z
  toString()              Mon Oct 12 2026 15:30:00 GMT-0700 (Pacific Daylight Time)
  toLocaleString("en-GB") 12/10/2026, 15:30:00
  getDate()               12 (local day)  getUTCDate(): 12
  with timeZone           12/10/2026, 23:30:00
```

Everything except `toISOString()`, `getUTCDate()` and the explicit-`timeZone` line changed with `TZ`; on the Kolkata server even the day changed. A developer laptop, a CI runner (often UTC) and a production container can each run in a different zone, so a test that passes locally can fail in CI. Always pass `timeZone` (the user's zone, or `'UTC'` for logs and machine-readable output), and run the test suite at least once with a non-UTC `TZ` (for example `TZ=Asia/Kolkata npm test`) so a forgotten case fails there.

**Example 13 — edge case: currency rounding.** `Intl.NumberFormat` rounds for display; it does not make float arithmetic correct.

javascript

```
// money.mjs — currency rounding: formatting is display, not arithmetic
const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const jpy = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

// 1. The formatter rounds to the currency's minor unit (2 for EUR, 0 for JPY)
console.log(eur.format(0.125), eur.format(0.135), jpy.format(100.5), jpy.format(101.5));
console.log(eur.resolvedOptions().maximumFractionDigits, jpy.resolvedOptions().maximumFractionDigits,
  eur.resolvedOptions().roundingMode);

// 2. Floating point: 1.005 is really 1.00499999…; toFixed and Intl round it differently
console.log((1.005).toFixed(2), eur.format(1.005), (1.005).toPrecision(20));

// 3. Rounding each line vs rounding the total
const lines = [0.333, 0.333, 0.333];           // e.g. 1.00 split three ways, in floats
const shownLines = lines.map((x) => eur.format(x));
console.log(shownLines.join(' + '), '=', eur.format(lines.reduce((a, b) => a + b, 0)));

// 4. Keep integer minor units and split with an explicit remainder rule
const totalCents = 100;
const parts = 3;
const base = Math.floor(totalCents / parts);
const split = Array.from({ length: parts }, (_, i) => base + (i < totalCents % parts ? 1 : 0));
console.log(split, split.reduce((a, b) => a + b), split.map((c) => eur.format(c / 100)).join(' + '));

// 5. An explicit roundingMode (the default is halfExpand, see line 2 of the output)
const floor = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', roundingMode: 'floor' });
console.log(floor.format(9.999), eur.format(9.999));

// Real output (Node v24.19.0, ICU 78.3):
//   €0.13 €0.14 ￥101 ￥102
//   2 0 halfExpand
//   1.00 €1.01 1.0049999999999998934
//   €0.33 + €0.33 + €0.33 = €1.00
//   [ 34, 33, 33 ] 100 €0.34 + €0.33 + €0.33
//   €9.99 €10.00
```

1. The formatter rounds to the currency's minor unit with `halfExpand` (half away from zero): `0.125` → `€0.13`, `100.5` yen → `￥101`.
2. `1.005` is not exactly representable; its double is `1.00499999…`. `toFixed(2)` gave `1.00`, `Intl` gave `€1.01`. Two "standard" ways to round the same value disagree, so neither belongs in money logic.
3. Three lines of `€0.33` "add up" to `€1.00` on the invoice, because the total was rounded from the unrounded sum.
4. Keep amounts in integer cents and split with an explicit rule for the remainder (first part gets the extra cent): `34 + 33 + 33 = 100`.
5. `roundingMode: 'floor'` is available when a rule requires it (`€9.99` vs `€10.00`).

**Example 14 — Temporal in Node v24.19.0: off by default, an old experimental build behind a V8 flag.**

javascript

```
// temporal.mjs — is Temporal in Node v24.19.0 (V8 13.6)? Run with and without --harmony-temporal
console.log('typeof Temporal:', typeof globalThis.Temporal);
if (globalThis.Temporal) {
  console.log('members:', Object.getOwnPropertyNames(Temporal).join(' '));
  // DST-aware arithmetic: Berlin skips 02:00–03:00 on 2026-03-29
  const z = Temporal.ZonedDateTime.from('2026-03-29T00:30:00[Europe/Berlin]');
  console.log('+2h across DST:', z.add({ hours: 2 }).toString());
  console.log('Jan 31 + 1 month:', Temporal.PlainDate.from('2026-01-31').add({ months: 1 }).toString());
  // the finished proposal has Now.timeZoneId() and no TimeZone/Calendar classes
  console.log('Now.timeZoneId:', typeof Temporal.Now.timeZoneId, '| Now.timeZone:', typeof Temporal.Now.timeZone);
  console.log('toLocaleString:', z.toLocaleString('de-DE'));
}
```

bash

```
$ node temporal.mjs
typeof Temporal: undefined
$ node --harmony-temporal temporal.mjs
typeof Temporal: object
members: Now PlainDate PlainTime PlainDateTime ZonedDateTime Duration Instant PlainYearMonth PlainMonthDay TimeZone Calendar
+2h across DST: 2026-03-29T03:30:00+02:00[Europe/Berlin]
Jan 31 + 1 month: 2026-02-28
Now.timeZoneId: undefined | Now.timeZone: function
toLocaleString: 29.3.2026, 05:00:00 GMT+5:30
$ TZ=UTC node --harmony-temporal temporal.mjs 2>&1 | tail -1
toLocaleString: 28.3.2026, 23:30:00 UTC
```

The arithmetic is right (adding 2 hours across the spring-forward gap lands on 03:30+02:00; 31 January plus one month clamps to 28 February), but the API surface is an older shape of the proposal (`TimeZone`, `Calendar`, `Now.timeZone()`; the current MDN reference lists only `Now`, `Instant`, `ZonedDateTime`, `PlainDate`, `PlainTime`, `PlainDateTime`, `PlainYearMonth`, `PlainMonthDay` and `Duration`), and `toLocaleString` ignored the value's own `[Europe/Berlin]` zone and used the process zone (05:00 in Kolkata, 23:30 in UTC, where Berlin wall-clock time was 00:30). Both fit the flag's own description, "in progress / experimental".

## Common mistakes & gotchas

- **Formatting in the server's locale or zone.** `date.toLocaleString()` with no arguments uses the process's `LANG` and `TZ`, which differ between laptop, CI and production (Example 12). Always pass a locale and `timeZone`.
- **Hand-written plural logic.** `n === 1 ? 'item' : 'items'` is wrong for Polish, Arabic, Russian and many others. Use `Intl.PluralRules`, i18next plural suffixes or ICU `plural`.
- **`zero {…}` for "no items" in English.** English has no `zero` category; use `=0` (Example 9).
- **Concatenating translated fragments.** `t('you_have') + n + t('items')` fixes the word order to English. Translate the whole sentence with placeholders.
- **Comparing formatted output with typed strings.** CLDR uses U+00A0 and U+202F (Example 5), and those can change between ICU versions.
- **`timestamp` instead of `timestamptz`.** A zone-less column plus servers in different zones stores and reads different instants (Example 11).
- **Storing offsets instead of zone names.** `+01:00` is wrong for half the year in Berlin. Store `Europe/Berlin`.
- **Float money.** Round only for display, keep integer minor units, and decide explicitly where the leftover cent goes (Example 13).
- **Trusting q=0 handling.** i18next-http-middleware 3.9.9's header lookup does not drop `q=0` entries (Example 7).
- **Forgetting `Vary: Accept-Language`.** A CDN caches the first language it saw and serves it to everyone.
- **Missing keys disappear silently.** i18next returns the key, and i18next-icu returns the raw message on a format error. Log missing keys in development (`saveMissing`, `missingKeyHandler`) and parse all messages in CI.
- **Using `--harmony-temporal` in production.** It is an experimental, outdated build (Example 14).
- **Running a Node built without full ICU.** The Node docs list `--with-intl=small-icu` (English-only data) and `none` as build options; on such a binary, non-English formatting falls back or is missing. Check `process.config.variables.icu_small` (Example 1).

## Best practices

- **Store neutral data:** `timestamptz` and ISO-8601 with `Z`, integer minor units plus an ISO 4217 currency code, IANA zone names, message keys.
- **Decide the locale once per request** (saved preference → `?lng=` → `Accept-Language` → default) and put it on `req`/`res.locals`; send `Content-Language` and `Vary: Accept-Language`.
- **Cache formatters.** Create `Intl.*` objects once per locale and option set and reuse them; `format()` is the cheap part.
- **Return raw values from JSON APIs** (`"total": 123450, "currency": "EUR"`, `"at": "2026-10-12T15:30:00.000Z"`) and let the client format them, unless the API's job is to produce display text (emails, PDFs, server-rendered pages).
- **Use one message format across the project** (i18next JSON or ICU) and keep keys in namespaces per feature.
- **Configure fallbacks deliberately:** `supportedLngs`, `nonExplicitSupportedLngs` for region tags, `fallbackLng` for the last resort.
- **Test with a language that has many plural forms** (Polish, Arabic) and a right-to-left one, and run CI with `TZ=UTC` and a non-UTC zone.
- **Pass `timeZone` explicitly** to every `DateTimeFormat`/`toLocale*String` call.

## ⭐ Interview lens

> **Q: “How would you store and display timestamps for users in many time zones?”**  
> A: Store the instant in UTC: `timestamptz` in PostgreSQL (stored internally as UTC; the session `TimeZone` only changes display), ISO strings with `Z` in JSON. Store each user's IANA zone name. Convert only when formatting, with `Intl.DateTimeFormat(locale, { timeZone: user.zone })`, or in SQL with `AT TIME ZONE`. *Trap:* `timestamp` without time zone: node-postgres writes and reads it in the process's local zone, so servers in different zones disagree about the same row.

> **Q: “Why can't you just do `count === 1 ? singular : plural`?”**  
> A: Plural categories are language-specific. CLDR defines up to six (`zero one two few many other`); Polish uses `one/few/many/other`, so 2, 3, 22 are `few` and 5, 11, 25 are `many`; Arabic uses all six. `Intl.PluralRules(locale).select(n)` gives the category, and i18next suffixes or ICU `plural` messages pick the matching text. *Trap:* in ICU, `zero` is a category, `=0` is an exact match; English never selects `zero`.

> **Q: “How does an Express server pick a response language?”**  
> A: A stored user preference or an explicit `?lng=`/path segment first, then `Accept-Language`: parse the ranges and weights, drop `q=0`, sort by weight, and match against supported languages with prefix matching (`de-AT` → `de`), else a default. `req.acceptsLanguages(list)` does the negotiation; i18next-http-middleware's detector chains querystring, cookie, header and other sources. Then send `Content-Language` and `Vary: Accept-Language`.

> **Q: “What happens if you call `toLocaleString()` on a server without passing anything?”**  
> A: It uses the process default locale (from `LANG`/ICU) and the process time zone (`TZ` or the OS zone). The same instant can print as a different day on servers in different zones, and tests that pass on a laptop fail in a UTC CI runner. Pass both a locale and `timeZone`.

> **Q: “Is Temporal available in Node 24?”**  
> A: Not by default: `typeof Temporal` is `'undefined'` in Node v24.19.0. V8's `--harmony-temporal` flag exposes an experimental, outdated build (it still has `Temporal.TimeZone`/`Calendar`, lacks `Now.timeZoneId()`, and its `toLocaleString` ignored the value's zone). Use `Date` + `Intl` with explicit `timeZone`, or a library, for now.

## Cheat-card

- **ICU check:** `process.versions.icu` (78.3), `process.config.variables.icu_small` (`false` = full ICU), `Intl.DateTimeFormat().resolvedOptions()` for the default locale and zone.
- **Numbers:** `new Intl.NumberFormat(loc, { style: 'currency', currency })`, `{ notation: 'compact' }`, `{ style: 'unit', unit: 'kilometer-per-hour' }`; decimals come from the currency; default rounding `halfExpand`.
- **Dates:** `new Intl.DateTimeFormat(loc, { dateStyle, timeStyle, timeZone })`; never mix `dateStyle` with field options; unknown zone → `RangeError`.
- **Plurals:** `new Intl.PluralRules(loc).select(n)`; `{ type: 'ordinal' }` for 1st/2nd; en = one/other, pl = one/few/many/other, ar = all six.
- **Others:** `RelativeTimeFormat` (`numeric: 'auto'` → "yesterday"), `ListFormat` (`conjunction`/`disjunction`), `Collator` (`numeric: true`, `sensitivity: 'base'`), `Segmenter` (`grapheme`/`word`/`sentence`).
- **Express:** `req.acceptsLanguages(['en', 'de'])` → best match or `false`; no header = first item; set `Content-Language` and `Vary: Accept-Language`.
- **i18next 26.4.4 + i18next-http-middleware 3.9.9:** `i18next.use(middleware.LanguageDetector).init({ supportedLngs, nonExplicitSupportedLngs, fallbackLng, ns, defaultNS, detection: { order } })`, `app.use(middleware.handle(i18next))`, `req.t('ns:key', { count })`.
- **ICU messages (i18next-icu 2.5.0, intl-messageformat 12.1.3):** `{n, plural, =0 {…} one {# …} other {# …}}`, `{g, select, female {…} other {…}}`; `other` is required; `{name}` not `{{name}}`.
- **Time:** store UTC (`timestamptz`, `toISOString()`); `SET TIME ZONE` changes display only; avoid `timestamp` without time zone; store IANA zone names.
- **Temporal:** not in Node v24.19.0 by default; `--harmony-temporal` = experimental, outdated build.
- **Money:** integer minor units; format only for display.

---

## Learn More

- [Internationalization support (Node.js v24 docs) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/intl.html)
- [Intl (MDN) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
- [Configuration options (i18next) i18next.com](https://www.i18next.com/overview/configuration-options)
- [Plurals (i18next) i18next.com](https://www.i18next.com/translation-function/plurals)
- [i18next-http-middleware github.com](https://github.com/i18next/i18next-http-middleware)
- [i18next-icu github.com](https://github.com/i18next/i18next-icu)
- [intl-messageformat (FormatJS) formatjs.github.io](https://formatjs.github.io/docs/intl-messageformat/)
- [Formatting messages (ICU user guide) unicode-org.github.io](https://unicode-org.github.io/icu/userguide/format_parse/messages/)
- [Plural rules (CLDR) cldr.unicode.org](https://cldr.unicode.org/index/cldr-spec/plural-rules)
- [Date/time types (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/datatype-datetime.html)
- [Express 5.x API reference expressjs.com](https://expressjs.com/en/5x/api.html)
- [Temporal (MDN) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
