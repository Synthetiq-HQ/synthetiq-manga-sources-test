# Synthetiq Test Manga Sources

This is the public staging catalogue for Synthetiq Books modules. It follows the same index, manifest, and module layout as the [production source repository](https://github.com/Synthetiq-HQ/synthetiq-manga-sources), but it contains only modules that are actively being tested.

## Workflow

1. Add a candidate module and its deterministic fixtures here.
2. Run the local and GitHub Actions checks.
3. Add this repository’s `index.json` URL to a development build of Synthetiq Books and test the module.
4. After approval, promote the exact tested module to the production repository with its final release metadata.
5. Remove the promoted module directory and its catalogue entry from this repository in the same follow-up change.

The overlap check fails if a module is present in both catalogues. That keeps this repository limited to testing candidates and prevents a promoted module from being served twice.

## Current candidates

- Goldenaudiobooks
- Hot Audiobooks
- AudioAZ
- Audiobooks For Your Soul
- AudioBB

All five are experimental audio modules with `contentRating: unknown`. They remain beta and require a separate rights, safety, and stability review before promotion.
