#!/usr/bin/env bash
# ==============================================================================
# StudySync AlmaLinux VPS Deployment Script (Requirements D1, D2, D3, D4, D5)
# Automates provisioning on AlmaLinux with Caddy reverse proxy, Docker, Let's Encrypt TLS,
# and isolated Staging vs Production environments.
# ==============================================================================

set -euo pipefail

echo "=================================================================="
echo " Starting StudySync Deployment on AlmaLinux VPS                  "
echo " Target Domains: studysync.lathropprojects.net (Production)       "
echo "                 staging.studysync.lathropprojects.net (Staging)  "
echo "=================================================================="

# 1. Update and install prerequisites
echo "\n[1/6] Installing system prerequisites and Caddy on AlmaLinux..."
dnf install -y epel-release 'dnf-command(copr)' curl git bind-utils

# Enable Caddy COPR repository and install Caddy
if ! command -v caddy &> /dev/null; then
  echo "Installing Caddy web server..."
  dnf copr enable -y @caddy/caddy
  dnf install -y caddy
fi

# 2. Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "\n[2/6] Installing Docker engine..."
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
else
  echo "\n[2/6] Docker already installed: $(docker --version)"
fi

# 3. Configure firewalld
echo "\n[3/6] Opening HTTP (80) and HTTPS (443) ports in firewalld..."
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http || true
  firewall-cmd --permanent --add-service=https || true
  firewall-cmd --reload
  echo "✓ Firewall updated successfully."
else
  echo "firewalld is not active; skipping."
fi

# 4. Deploy Production stack (:3001, :4001)
echo "\n[4/6] Building and launching Production environment containers..."
docker compose -f deploy/docker-compose.prod.yml up --build -d

# 5. Deploy Staging stack (:3002, :4002)
echo "\n[5/6] Building and launching Staging environment containers..."
docker compose -f deploy/docker-compose.staging.yml up --build -d

# 6. Configure and restart Caddy
echo "\n[6/6] Applying Caddy reverse proxy configuration..."
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl restart caddy

echo "\n=================================================================="
echo " StudySync Deployment Complete!                                   "
echo " Production URL: https://studysync.lathropprojects.net            "
echo " Staging URL:    https://staging.studysync.lathropprojects.net    "
echo "=================================================================="

