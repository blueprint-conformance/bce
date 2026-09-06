# Attested historical implementation bytes

This directory preserves the exact public verifier/controller bytes named by an
immutable study protocol after the active implementation moves forward.

Files are stored beneath `by-git-commit/<40-hex-commit>/` at their original
repository-relative paths. Verification accepts a stored file only when its
SHA-256 digest equals the digest frozen in the sealed protocol. The Git commit
remains the provenance locator; these content-addressed copies make offline and
shallow-clone replay independent of retained Git history.

These files are evidence artifacts, not executable fallbacks. Active study runs
always use the current, separately frozen implementation.
