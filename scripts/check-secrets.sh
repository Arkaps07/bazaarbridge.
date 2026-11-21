#!/usr/bin/env bash
# v7.1/v7.2: AVNS_ + credential-URI patterns added; exact-string
# allowlist for the two SAMPLE demo passwords and process.env references.
set -uo pipefail

# 1) Secret FILES must never be tracked. (.env.example is fine: ^\.env$ only matches exact name.)
if git ls-files 2>/dev/null | grep -Ei '\.(pem|key|cert|crt|p12|pfx)$|^\.env$|^certs/|^secrets/'; then
  echo "SECRET FILE TRACKED - abort"
  exit 1
fi

# 2) Inline secrets. Catches private keys, Aiven AVNS_ passwords, scheme://user:pass@, and password literals.
PATTERNS="BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AVNS_[A-Za-z0-9_-]{8,}|[a-z][a-z0-9+.-]*://[^/[:space:]@:]+:[^@[:space:]]+@|password[[:space:]]*[:=][[:space:]]*[\"']?[^[:space:]\"']{8,}"

# Allowlist: strip these EXACT literals, then re-test the residue.
ALLOW="Demo@1234|Admin@1234|process\.env\.[A-Za-z_][A-Za-z0-9_]*"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hits=$(git grep -nIE "$PATTERNS" -- \
    ':!*.example' ':!docs/*' ':!scripts/check-secrets.sh' ':!README.md' \
    | sed -E "s/($ALLOW)//g" \
    | grep -E "$PATTERNS" || true)
else
  hits=$(grep -rnIE "$PATTERNS" backend src server.ts 2>/dev/null \
    | sed -E "s/($ALLOW)//g" \
    | grep -E "$PATTERNS" || true)
fi

if [ -n "$hits" ]; then
  echo "$hits"
  echo "POSSIBLE INLINE SECRET - abort"
  exit 1
fi

echo "secret scan clean"
