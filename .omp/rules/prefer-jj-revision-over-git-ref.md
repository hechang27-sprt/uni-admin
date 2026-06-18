---
name: prefer-jj-revision-over-git-ref
description: "When the user names a revision like `spm` in a jj repo, treat it as a jj revset first, not a git ref."
condition: "git\\s+rev-parse\\s+--verify\\s+spm"
scope: "tool"
---

This repo has `.jj`. When the user says a named revision like `spm`, assume **jj revset/change/bookmark semantics first** unless they explicitly say Git ref/branch/tag/commit. Do not probe it with `git rev-parse` first. Use `jj` commands such as `jj log -r 'spm|@'`, `jj diff -r 'spm::@'`, or check `.jj/` before choosing the VCS tool.