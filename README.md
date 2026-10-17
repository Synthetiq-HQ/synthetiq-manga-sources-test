# Synthetiq Test Manga Sources

This is the public staging catalogue for Synthetiq Books modules. It follows the same index, manifest, and module layout as the [production source repository](https://github.com/Synthetiq-HQ/synthetiq-manga-sources), but it contains only modules that are actively being tested.

## Workflow

1. Add a candidate module and its deterministic fixtures here, along with
   `tests/<slug>.test.mjs`.
2. Run the local and GitHub Actions checks.
3. Add this repository’s `index.json` URL to a development build of Synthetiq Books and test the module.
4. After approval, promote the exact tested module to the production repository with its final release metadata.
5. Remove the promoted module directory and its catalogue entry from this repository in the same follow-up change.

The overlap check fails if a module is present in both catalogues. That keeps this repository limited to testing candidates and prevents a promoted module from being served twice.

## Current candidates

**Synthetiq Manga 0.1.6** (`books-owned-pi-qa-v1`), minimum Books **2.5.8**.
This is a staging candidate using an isolated, owner-approved installation key.
It is not production-certified and does not replace or migrate SynManga libraries.
Unapproved devices cannot access the private staging catalogue or media.

0.1.6 retries temporary gateway errors even when they return HTML rather than
JSON, respects numeric and HTTP-date Retry-After values, and retains the original
28-second/two-retry operation budget. Successful malformed responses and access
denials are never retried. Source/family/content identities, explicit language
selection and approved hosts are unchanged. Books 2.5.8 bounds whole protected
transfers, validates bytes and retries temporary page failures without changing
public-source downloads. This remains an owner-approved staging candidate, not a
general-access production API. See the dated transfer evidence for completed
physical checks; fixture success alone is not a release certification.

0.1.2 corrects the native installer's required universal-link metadata. The
module script and identities are unchanged. The validator now checks the native
manifest contract, not only script handlers and hashes.

0.1.3 accepts Books' standard Discover feed names and retains stateless archive
pagination. These aliases use the staging catalogue, not popularity rankings or
predicted releases. Books 2.5.5 pins the revised script exactly.

0.1.4 is a metadata-only compatibility update for the expanded staging archive.
The script, family, module and content identities remain unchanged. Books 2.5.6
supports up to 128 explicit editions rather than hiding choices above 64.
Full catalogue delivery and representative native checks are recorded separately;
this is not a guarantee that every archived image has been audited. Catalogue
cards use placeholders where the frozen index has no cover metadata.

0.1.5 is a metadata-only native compatibility update for reviewed staging cover
artwork. Catalogue and details continue using the existing `image` field and
protected staging asset route; the module script, hosts and identities are
unchanged. Catalogue artwork is obtained through MyAnimeList's API, independently
of optional user tracking. Books 2.5.7 revalidates these covers without saving
them as offline chapter media. Unmatched or ambiguous titles keep placeholders.
Provider availability and owner artwork acceptance remain separate test gates.
The initial overlay contains ten reviewed titles, including One Piece, Naruto,
Captain Tsubasa, Jujutsu Kaisen and Demon Slayer; it is not complete artwork for
all 385 archived works. Other titles remain browseable with placeholders.

Add this repository in Books, explicitly install the candidate, and open its
Test Connection settings to share the public installation key for temporary
approval. Never share private keys, account sessions or grants. Language/group
selection appears only on titles with multiple editions. Incomplete translations
remain incomplete and translated progress is local-only in this testing pass.

AudioAZ remains in the production catalogue. Cleaning it out of this test index
does not uninstall existing copies or delete their libraries/downloads.
