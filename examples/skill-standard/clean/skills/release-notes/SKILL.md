---
name: release-notes
description: Turn a range of merged commits into release notes a reader outside the team can act on — what changed, who it affects, what they have to do. Use when cutting a tag, when a changelog entry has to go out with a version bump, or when a draft lists commit subjects instead of consequences.
license: Apache-2.0
---

# release-notes — consequences, not commit subjects

A commit subject describes what an author did. A release note describes what a reader now has to
do differently. They are rarely the same sentence, and copying the first into the second is the
single most common way release notes become unread.

## The procedure

1. Take the commit range. Group by consequence, never by author or by directory.
2. For each group, write the reader-facing sentence first: what is different for someone who
   upgrades. Then, and only then, link the commits that produced it.
3. Separate the groups that demand action (a migration, a renamed flag, a dropped default) from
   the ones that do not. A reader scanning for work should find it in the first section.
4. Anything you cannot write a consequence sentence for is either internal — say so in one line —
   or not understood yet, which is a question for the author, not a guess.

## The failure this exists to prevent

Notes that are a rendered `git log`. They are technically complete and practically useless: the
reader has to reconstruct the consequence themselves, so most do not, and the one breaking change
in the list gets discovered in production instead.
