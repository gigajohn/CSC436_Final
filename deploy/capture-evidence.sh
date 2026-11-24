#!/usr/bin/env bash
# ==============================================================================
# Script to capture live evidence for D1 (DNS/TTL), D2 (HTTPS/CAA), and D3 (Staging vs Prod)
# Outputs raw transcripts to docs/evidence/d1-d2-d3-live-deployment-evidence.txt
# ==============================================================================

set -uo pipefail

OUT_FILE="docs/evidence/d1-d2-d3-live-deployment-evidence.txt"
mkdir -p docs/evidence

echo "================================================================================" > "$OUT_FILE"
echo " StudySync Public Deployment Evidence Dossier (Requirements D1, D2, D3)" >> "$OUT_FILE"
echo " Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$OUT_FILE"
echo " Domains: studysync.lathropprojects.net (Prod), staging.studysync.lathropprojects.net (Staging)" >> "$OUT_FILE"
echo "================================================================================\n" >> "$OUT_FILE"

echo "### SECTION 1: Requirement D1 — Authoritative DNS Trace & TTL Verification" >> "$OUT_FILE"
echo "$ dig +trace studysync.lathropprojects.net" >> "$OUT_FILE"
dig +trace studysync.lathropprojects.net >> "$OUT_FILE" 2>&1 || true
echo -e "\nTTL Rationale: 3600 seconds (1 hour) is the minimum TTL permitted by the authoritative DNS provider (Contabo). This represents the tightest cache expiration window allowed by the infrastructure, ensuring responsive failover during server redeployments while respecting upstream resolver rate limits.\n" >> "$OUT_FILE"

echo "--------------------------------------------------------------------------------" >> "$OUT_FILE"
echo "### SECTION 2: Requirement D2 — CAA Record Enforcement" >> "$OUT_FILE"
echo "$ dig CAA lathropprojects.net" >> "$OUT_FILE"
dig CAA lathropprojects.net >> "$OUT_FILE" 2>&1 || true
echo "$ dig @ns1.contabo.net CAA lathropprojects.net" >> "$OUT_FILE"
dig @ns1.contabo.net CAA lathropprojects.net >> "$OUT_FILE" 2>&1 || true
echo -e "\n" >> "$OUT_FILE"

echo "--------------------------------------------------------------------------------" >> "$OUT_FILE"
echo "### SECTION 3: Requirement D2 — Mandatory HTTP to HTTPS 308/301 Redirect" >> "$OUT_FILE"
echo "$ curl -I http://studysync.lathropprojects.net" >> "$OUT_FILE"
curl -I http://studysync.lathropprojects.net >> "$OUT_FILE" 2>&1 || true
echo -e "\n" >> "$OUT_FILE"

echo "--------------------------------------------------------------------------------" >> "$OUT_FILE"
echo "### SECTION 4: Requirement D2 — TLS Certificate Chain Inspection" >> "$OUT_FILE"
echo "$ openssl s_client -connect studysync.lathropprojects.net:443 -servername studysync.lathropprojects.net < /dev/null" >> "$OUT_FILE"
openssl s_client -connect studysync.lathropprojects.net:443 -servername studysync.lathropprojects.net < /dev/null 2>&1 | grep -E "depth=|Certificate chain|issuer|subject|Verify return code" >> "$OUT_FILE" || true
echo -e "\n" >> "$OUT_FILE"

echo "--------------------------------------------------------------------------------" >> "$OUT_FILE"
echo "### SECTION 5: Requirement D3 — Staging vs Production Separation" >> "$OUT_FILE"
echo "Production Endpoint Health Check:" >> "$OUT_FILE"
echo "$ curl -i https://studysync.lathropprojects.net/healthz" >> "$OUT_FILE"
curl -i https://studysync.lathropprojects.net/healthz >> "$OUT_FILE" 2>&1 || true
echo -e "\n" >> "$OUT_FILE"

echo "Staging Endpoint Health Check (with X-StudySync-Environment: staging):" >> "$OUT_FILE"
echo "$ curl -i https://staging.studysync.lathropprojects.net/healthz" >> "$OUT_FILE"
curl -i https://staging.studysync.lathropprojects.net/healthz >> "$OUT_FILE" 2>&1 || true
echo -e "\n" >> "$OUT_FILE"

echo "================================================================================" >> "$OUT_FILE"
echo " Evidence collection completed. Saved to $OUT_FILE"
cat "$OUT_FILE"

