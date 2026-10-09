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

**Synthetiq Manga 0.1.2** (`books-owned-pi-qa-v1`), minimum Books **2.5.3**.
This is a staging candidate using an isolated, owner-approved installation key.
It is not production-certified and does not replace or migrate SynManga libraries.
Unapproved devices cannot access the private staging catalogue or media.

0.1.2 corrects the native installer's required universal-link metadata. The
module script and identities are unchanged. The validator now checks the native
manifest contract, not only script handlers and hashes.

Add this repository in Books, explicitly install the candidate, and open its
Test Connection settings to share the public installation key for temporary
approval. Never share private keys, account sessions or grants. Language/group
selection appears only on titles with multiple editions. Incomplete translations
remain incomplete and translated progress is local-only in this testing pass.

AudioAZ remains in the production catalogue. Cleaning it out of this test index
does not uninstall existing copies or delete their libraries/downloads.
