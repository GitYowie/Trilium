# Content language & Right-to-left support
![](Content%20language%20&%20Right-t.png)

A language hint can be provided for text notes. This option informs the browser or the desktop application about the language the note is written in (for example this might help with spellchecking), and it also determines whether the text is displayed from right-to-left for languages such as Arabic, Hebrew, etc.

## Setting the language

To set the language of the content, go to “Basic Properties” and look for the “Language” field.

## Adjusting the list of languages

By default there will be no language configured, they can be configured by going to settings or by selecting the “Configure languages” item when setting the language.

### Source builds

The “Configure languages” list is derived from the supported locales list in the codebase. If you need an extra content-only locale (for example `en-AU`), add it to `packages/commons/src/lib/i18n.ts` with `contentOnly: true` and restart the app.
