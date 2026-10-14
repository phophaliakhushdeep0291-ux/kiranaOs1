# Multilingual assistant — 2026-10-13

The assistant accepts a validated language tag independently of the English/Hindi interface. The panel and floating microphone share a session-scoped preference, defaulting to Automatic. Users may enter any language supported by the configured model, including mixed or romanized text. The preference resets on logout; changing it never changes a stored action plan.

## Response path

- The action model receives the original request. Automatic/non-English language preferences receive the full permitted tool set so English keyword routing cannot hide a trade capability.
- Reads and clarifications are still composed from approved tools and server-written templates. Arbitrary agent prose is not displayed.
- English/Hindi use reviewed copy without a translation call when selected explicitly.
- Other languages translate only static English templates. Shop names, product names, quantities, prices, dates and other result values are inserted after translation and are never sent to the translation model as template content. Automatic mode additionally uses the current message and two recent user messages only to select the language.
- The translation response must have a valid language, the expected number of strings, unchanged placeholders/numbers/paths/currency symbols, and bounded lengths. Failure leaves the English reply visible with an explicit fallback notice. Machine translations expose the original English in a disclosure.
- Translation has no tools, cannot create or edit plans, and shares the existing turn deadline with an eight-second maximum. Explicit-language static template translations have a bounded, one-hour process cache; translations based on automatic user-language samples are never shared in that cache.
- Translation validation protects structure and data, not semantic perfection. A mistranslated label or negation remains possible; native-speaker/provider evaluation is still required.

## Voice and confirmations

Automatic audio no longer has a Hindi/English-biased transcription prompt. A selected two-letter language is forwarded to the existing transcription provider. Language metadata works before or after the audio in multipart uploads without stripping trailing audio bytes. Valid three-letter preferences use automatic transcription when the current provider interface only accepts two-letter hints.

The floating microphone uses cloud transcription for Automatic, or the requested locale with browser recognition when chosen explicitly. The main assistant continues using cloud transcription. Read-aloud selects an installed matching voice; if unavailable, it reports that fact instead of speaking with the wrong language's voice. Messages and inputs use automatic text direction.

Existing English/Hindi/Hinglish confirmation phrases remain. Exact additional confirmation/cancellation phrases are accepted only for the pending response's language (Arabic, Urdu, Bangla, Marathi, Gujarati, Tamil, Telugu, Spanish, French, German, Portuguese, Chinese and Japanese). Compound corrections and questions do not approve a plan. Other languages use the visible confirmation buttons. Server role, tenant, plan and owner-PIN checks remain authoritative.

## Limits

This is multilingual conversation and voice infrastructure, not a translated whole application or guaranteed support for every dialect. Menus, examples and confirmation controls remain English/Hindi; action summaries keep their canonical wording. Domain-specific edits still have the existing tool coverage limits. Offline billing is unaffected, but model inference and cloud transcription need connectivity and a configured provider. Neither this patch nor scripted tests prove live microphone, accent, translation or model-intent accuracy.

The existing transcription interface was checked against [OpenAI's transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) and [speech-to-text guidance](https://developers.openai.com/api/docs/guides/speech-to-text). No provider/model/key migration was made.

## Evidence

- Frontend production gate: 3,567 tests passed, one existing skip; typecheck, translations, build, bundle/offline checks passed.
- Backend complete AI-safety suite and production checks passed.
- Scripted end-to-end agent clarification cases: Arabic, Tamil, Bangla, Gujarati, Marathi, Urdu, Telugu, Spanish, French, Chinese and Japanese.
- Regression coverage: locale validation, factual-value preservation including exact large paise values, static-template cache, timeout/invalid translation fallback, no translator tool access, whole-utterance confirmations, voice matching and audio-language forwarding.
- Browser with a synthetic session and scripted provider: Automatic Arabic report, identical original English amounts, Tamil clarification, explicit French fallback, language controls, RTL date/currency isolation and Arabic confirmation reaching the owner-PIN screen without executing. These checks use the real components and server renderer, without live shop data.
