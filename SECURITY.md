# Security

Local mode is for cooperative code you are willing to execute under your current OS user. It is not a sandbox. Read [the threat model](docs/threat-model.md) before running a third-party candidate.

Do not include secrets, raw environment values, provider prompts or private customer data in public issues. Use the repository owner's private security contact/channel to report approval bypass, false acceptance, stale evidence, command injection or executor escapes. This repository does not currently advertise a dedicated private disclosure address.

Protected CI release decisions are unavailable. A local ACCEPT is explicitly a demonstration. Hashes do not prove approval or authorship. Never place release-authority secrets or model credentials in candidate-controlled processes.
