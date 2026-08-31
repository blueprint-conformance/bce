# Trademark Policy

This document describes the policy for use of the trademarks associated with
**bce, the blueprint conformance engine**.

## The marks

The following marks (the "Marks") are owned by **Odin Labs**:

- the word mark **"bce"**, as used to identify the blueprint conformance engine
  and its published specification and schemas;
- the tagline **"Blueprints with Teeth"**;
- any logos published in this repository or on the project website.

Odin Labs asserts unregistered (use-based) trademark rights in the marks
listed above and may seek registration for marks covering its broader product
line. Commercial offerings built on those marks (paid certification and
training) are disclosed in [GOVERNANCE.md](GOVERNANCE.md) — the engine and the
specification themselves are and remain Apache-2.0.

## What the code license does — and does not — grant

The software in this repository is licensed under the
[Apache License, Version 2.0](LICENSE). **Section 6 of that license expressly
withholds trademark rights**:

> "This License does not grant permission to use the trade names, trademarks,
> service marks, or product names of the Licensor, except as required for
> reasonable and customary use in describing the origin of the Work and
> reproducing the content of the NOTICE file."

In other words: the copyright and patent grants in the Apache-2.0 license are
independent of, and do not extend to, the Marks. You receive broad rights to
use, modify, and redistribute the *code*; you receive only the narrow,
"reasonable and customary" descriptive right with respect to the *Marks*
(plus the obligation to reproduce the NOTICE file under Section 4(d)). This
two-layer structure — permissive code license, separately-policed marks — is
the same pattern used by CNCF projects, and this policy follows the CNCF
model.

## Uses that are always allowed (no permission needed)

**Nominative fair use.** You may use the word "bce" truthfully to refer to
this project, including:

- stating that your software uses, integrates with, imports, is tested
  against, or is compatible with bce;
- writing articles, tutorials, books, talks, benchmarks, or reviews about
  bce, including critical ones;
- linking to this repository or the project website;
- packaging unmodified releases of bce for a software distribution, provided
  the package accurately identifies its upstream origin;
- using "bce" in a dependency name context (e.g. lockfiles, manifests) where
  the string identifies the actual upstream package.

Plain-text descriptive uses like "powered by bce" or "bce-compatible" are
fine **as long as** they are accurate and do not suggest sponsorship or
endorsement (see below).

## Uses that require permission

Written permission from Odin Labs is required to:

- use "bce", "Blueprints with Teeth", or a confusingly similar mark in the
  name of your own software product, fork, service, company, domain name,
  social media handle, or event;
- use the Marks in a way that states or implies that Odin Labs sponsors,
  endorses, or is affiliated with your product or service;
- use any project logo other than in unmodified form to refer to this
  project;
- offer certification, training, or compliance attestation *under the Marks*
  (e.g. "bce Certified"). Anyone may verify anything against the Apache-2.0
  specification and schemas; branding an attestation program with the Marks
  requires a license.

## Forks

The Apache-2.0 license fully permits forking the code. If you distribute a
modified version:

- you may state, truthfully, that your work is "a fork of bce" or "based on
  bce" (nominative use);
- you may **not** call the modified distribution itself "bce" or use the
  tagline for it, in ways that could cause users to believe they are getting
  the upstream project or that the fork is official. Pick a distinct name for
  a public fork, and keep the attribution and NOTICE requirements of the
  Apache-2.0 license intact.

## Specification and conformance vocabulary

The published blueprint format (apiVersion `blueprint-conformance/v1alpha1`)
is Apache-2.0-licensed data and may be implemented by anyone. Describing an
independent implementation as "implements the bce v1alpha1 blueprint format"
is nominative fair use and welcome. Naming an independent implementation
"bce" or marketing it under the tagline is not.

## Questions and permission requests

Open an issue in this repository or contact the maintainer (see
GOVERNANCE.md). Good-faith community use is the point of this policy; it
exists to prevent user confusion, not to restrict honest speech about the
project.

## Changes

Odin Labs may update this policy; changes apply prospectively and will be
made in the open, in this file's git history.
