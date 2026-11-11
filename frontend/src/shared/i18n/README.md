# Frontend languages

Supported locales: `vi` (default), `en-US`, `zh-CN` (Simplified Chinese).
The language picker is available in PMS and Manager headers, sign-in, and hotel
profile settings. The selection is stored under `loha-ui-language` in localStorage,
synchronized across tabs, and updates `document.documentElement.lang`.
If storage is unavailable, the selection remains usable in memory.

`shared/styles/fonts.css` bundles Inter, Be Vietnam Pro and Noto Sans SC through
Fontsource and defines `--font-sans` and `--font-mono`. Chinese UI prioritizes
Noto Sans SC through the document's `lang` attribute. Use these font stacks for
CSS and inline styles, including dialogs and form controls, so Chinese glyphs
render on devices without installed Chinese fonts. The font files are served
with the app; Chinese text
does not depend on Google Fonts being reachable. Keep remote CSS imports out of
application stylesheets: an unavailable imported stylesheet can block the entire
app and delay local font loading. Unicode ranges let the browser load only the
required font segments.

Each locale has a flat `key: value` JSON dictionary in `locales/`. Keep the same
keys and named parameters in all three files. Missing translations fall back to
Vietnamese; unknown keys display the key so missing entries remain visible.

```jsx
import { useI18n } from './useI18n.js';

function SaveButton() {
  const { t } = useI18n();
  return <button type="submit">{t('common.save')}</button>;
}
```

Use named parameters for complete sentences:

```jsx
t('hk.taskTitle', { room: '101' });
```

Components migrated from existing UI use `useI18n()` to subscribe and the stable
`tUi` import to translate keys. `tr` / `labelUi` translate existing fixed metadata
such as navigation, role, status and feature labels using the Vietnamese catalog.
Use this compatibility helper only for known UI labels. Hotel names, employee
names, room type names, guest details, notes and form values are business data and
must remain unchanged.

Older screens translate source-authored UI literals with `tr(...)`, using the
generated compatibility catalogs. Keep expressions containing hotel names,
guest details, notes, or other business data outside this helper, even when their
text matches a UI label. New components should use named `t(...)` keys.

`LegacyI18nBridge` only translates explicitly marked legacy UI. Set
`data-i18n-ui` on an element to translate its direct text nodes; descendants do
not inherit this opt-in. To translate UI attributes, list their names in
`data-i18n-attrs="placeholder aria-label title"`. Only these three attributes are
supported. Leave business text and attributes unmarked. `data-i18n-ignore` and
editable containers protect their entire subtree, including marked descendants.
Form values are never translated by the bridge.

The API client preserves backend-owned display references in React state. Use
`i18n:key.name` for a fixed value, or a descriptor
such as `{ "$i18n": "key.name", "values": { "id": "123" } }` when the frontend
must interpolate API data. Definitions, feature labels and notification copy live
in the frontend locale files; the backend only returns stable keys and values.
Resolve these references at render time with `useI18n().apiText(...)` so they
follow language changes. Ordinary strings remain unchanged, and descriptor
interpolation values are inserted verbatim. The compatibility catalog translates
legacy strings only in the root `message` and `error.message` response envelopes.
Nested business fields, arrays, and error details remain opaque; a field named
`message`, `title`, or `description` inside business data does not opt in.

The dictionaries cover shared controls, PMS/Manager navigation, sign-in, settings,
dashboard, profile, housekeeping, room status and the daily rate matrix, with
shared labels reused in other screens. Remaining specialized copy and messages
provided by the backend should use stable translation keys instead of adding
language tables to Python. Interface language is independent of the hotel's
stored profile language.

Display dates and numbers use the selected locale; API date values remain ISO,
and business dates continue to use the hotel's time zone. Currency and timezone
settings are unaffected. Changing the language does not remount pages or discard
form drafts or current selections.

Run `npm run i18n:audit` to find Vietnamese source literals not covered by either
catalog layer. Run `npm test` to verify catalog completeness, parameters,
persistence, fallback, tab synchronization, formatting and key references.
