# ADR 0006: Versioned v1 pack loader layout

- **Date:** 2026-07-23
- **Status:** Proposed
- **Related:** ADR 0003, ADR 0004, issue #3

## Context

`lore validate` needs to turn an author-selected filesystem location into the pure
`PackInput` consumed by `@lorelum/format`. ADR 0003 defines data semantics but not
which files a transport is allowed to discover. Implicit directory traversal would
make validation depend on incidental repository content and makes safe diagnostics
harder for agents and CI.

## Decision

The v1 input is an explicit pack directory. A relative argument is resolved once by
the CLI at invocation time; the loader never searches parent directories, consults
the working directory again, follows configuration, or accesses the network.

The only v1 inputs are:

- `<pack>/pack.yaml`, required, a standalone YAML object for `Pack` metadata.
- `<pack>/decisions.yaml`, optional, a standalone YAML array of Decision Nodes.
- `<pack>/practices/*.md`, optional, direct children only and non-recursive. Each
  Markdown file supplies Practice frontmatter and its remaining Markdown body.

Only regular files in those locations are read. Symbolic links, directories where a
file is required, and special files are rejected. Other files and directories are
outside the v1 validation input and are ignored, allowing future templates or assets
without making them part of this contract. Candidate input names are resolved beneath
the explicit root; traversal names are rejected. The loader reads at most 128 input
files, with limits of 64 KiB for `pack.yaml`, 256 KiB for `decisions.yaml`, 512 KiB
per Practice, and 4 MiB of Practice content in total.

The loader is a filesystem port injected into a neutral application boundary. It
only parses the documented files and constructs `PackInput`; `@lorelum/format`
remains the sole owner of schema and semantic validation. Loader diagnostics expose
only stable error codes and generic messages, never absolute paths or file content.

`lore validate` emits a success envelope containing the full `ValidationReport`
after a successful load. A valid report exits `0`; a report containing errors exits
`1`, unless the local `--lenient` option changes only that exit code to `0`. Usage,
path, read, parse, and unexpected failures emit failure envelopes and exit `2`.

## Consequences

This yields reproducible author and CI validation, preserves a reusable loader port
for a future MCP adapter, and prevents CLI-specific validation logic from leaking
into the format package. A recursive Practice hierarchy, assets as validation input,
or a new layout version require a new decision rather than silently changing which
files are interpreted.

## Domain Command Template

Future domain commands decode arguments and write protocol envelopes only in the CLI
adapter. They call an injected application port that owns filesystem, clock, or
network access; the port delegates pack schema and validation semantics to
`@lorelum/format` and retrieval semantics to `@lorelum/engine`. An MCP adapter may
call that same neutral port, but must never import `@lorelum/cli`. Each command adds
its input contract, output schema, error codes, and exit codes to the CLI registry
before registering its Commander handler.
