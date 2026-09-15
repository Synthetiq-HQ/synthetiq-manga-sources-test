# Experimental audiobook prototype report

This repository contains five experimental Books audio modules. They are indexed here for testing only; they are not part of the production source repository and are not a release.

## Modules

| Module | Public route used | Adapter shape |
| --- | --- | --- |
| Goldenaudiobooks | WordPress REST posts plus public HTML audio elements | direct MP3 tracks |
| Hot Audiobooks | WordPress REST posts plus public HTML audio elements | direct MP3 tracks |
| AudioAZ | public search/archive pages | direct `archive.org` audio only |
| Audiobooks For Your Soul | WordPress product catalogue plus public page playlist | `pagev2` player extraction |
| AudioBB | WordPress REST posts plus public HTML links | direct MP3/M4A/M4B/MP4/Opus files |

## Safety boundaries

- HTTPS and explicit host allowlists are enforced for catalogue pages, covers, and media.
- No credentials, cookies, private endpoints, token extraction, decryption, anti-bot bypass, or bulk mirroring are used.
- AudioAZ tokenized service URLs are rejected; only direct public `archive.org` media is accepted.
- AudioBB download-page URLs are ignored; only direct audio-file links are returned.
- Audiobooks For Your Soul is allowed to use the ordinary `pagev2` browser bridge, but the module rejects anything that is not an HTTPS resource on its declared CDN.
- `contentRating` remains `unknown`; a later release review must verify rights, safety, and source stability before indexing any module.

## Verification

The prototype fixture suite passes all six tests:

```text
node --test tests/audio-prototypes.test.mjs
6 passed, 0 failed
```

Bounded live probes also pass for four sources:

- Goldenaudiobooks: search/details/chapters returned 34 tracks; first track was MP3 on `ipaudio.club`.
- Hot Audiobooks: search/details/chapters returned 5 tracks; first track was MP3 on `ipaudio.club`.
- AudioAZ: the 1984 archive page returned one direct MP3 on `archive.org`.
- AudioBB: The Terran Accord returned one direct M4B on `uploady.io`.

Audiobooks For Your Soul returned its live catalogue and chapter playlist, but its player’s public security endpoint returned HTTP 403 in the real-browser check. The module therefore fails closed for audio extraction until the site exposes a permitted public media URL. This is a source limitation, not something the module should bypass.

The broader repository suite still has three pre-existing hash failures in Ichi the Witch, NovelFrance, and NovelNeko Light. Those failures are outside this prototype and were not changed.
