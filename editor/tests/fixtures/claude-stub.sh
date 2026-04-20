#!/usr/bin/env bash
# Deterministic stub for the `claude` CLI used by /api/chat tests.
# Emits an output that ends with a <final>…</final> block matching the
# chat-system contract, so the sidecar's parser has a predictable target.
cat <<EOF
I read the prompt and decided to propose a mutation.
Also did some thinking here that the parser should discard.

<final>
{ "reply": "stub ack", "mutations": [{ "op": "seekTo", "sec": 12.5 }] }
</final>
EOF
