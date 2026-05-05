#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
die()  { echo -e "${RED}❌ $*${NC}"; exit 1; }

echo ""
echo "  MINERVA HRIS — Setup"
echo "────────────────────────────────────"
echo ""

# ─── Prerequisites ───────────────────────────────────────────────────────────
command -v node  >/dev/null 2>&1 || die "Node.js not found. Install from https://nodejs.org"
command -v npm   >/dev/null 2>&1 || die "npm not found"
command -v mysql >/dev/null 2>&1 || die "mysql CLI not found. Install MySQL client."

NODE_VER=$(node -v)
ok "Node $NODE_VER"

# ─── .env setup ──────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env created from .env.example — fill it in now"
  echo ""

  read -rp "DB host     [127.0.0.1]: " DB_HOST;      DB_HOST="${DB_HOST:-127.0.0.1}"
  read -rp "DB port     [3306]:      " DB_PORT;      DB_PORT="${DB_PORT:-3306}"
  read -rp "DB user:                 " DB_USER
  read -rsp "DB password:            " DB_PASSWORD;  echo ""
  read -rp "DB name     [minerva_hris_db]: " DB_NAME; DB_NAME="${DB_NAME:-minerva_hris_db}"
  read -rp "Server port [3000]:      " PORT;         PORT="${PORT:-3000}"

  # JWT secret — auto-generate if user skips
  read -rp "JWT secret  [auto-generate]: " JWT_SECRET
  if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
    ok "JWT secret generated"
  fi

  read -rp "Device IP (UTH):         " DEVICE_IP_UTH
  read -rp "Device IP (SSH):         " DEVICE_IP_SSH
  read -rp "Device serial (UTH):     " DEVICE_SERIAL_UTH
  read -rp "Device serial (SSH):     " DEVICE_SERIAL_SSH
  read -rp "Device port [4370]:      " DEVICE_PORT;  DEVICE_PORT="${DEVICE_PORT:-4370}"

  # Write values into .env
  sed -i "s|^DB_HOST=.*|DB_HOST=${DB_HOST}|"                   .env
  sed -i "s|^DB_PORT=.*|DB_PORT=${DB_PORT}|"                   .env
  sed -i "s|^DB_USER=.*|DB_USER=${DB_USER}|"                   .env
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|"       .env
  sed -i "s|^DB_NAME=.*|DB_NAME=${DB_NAME}|"                   .env
  sed -i "s|^PORT=.*|PORT=${PORT}|"                             .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|"         .env
  sed -i "s|^DEVICE_IP_UTH=.*|DEVICE_IP_UTH=${DEVICE_IP_UTH}|"         .env
  sed -i "s|^DEVICE_IP_SSH=.*|DEVICE_IP_SSH=${DEVICE_IP_SSH}|"         .env
  sed -i "s|^DEVICE_PORT=.*|DEVICE_PORT=${DEVICE_PORT}|"       .env
  sed -i "s|^DEVICE_SERIAL_UTH=.*|DEVICE_SERIAL_UTH=${DEVICE_SERIAL_UTH}|" .env
  sed -i "s|^DEVICE_SERIAL_SSH=.*|DEVICE_SERIAL_SSH=${DEVICE_SERIAL_SSH}|" .env

  ok ".env written"
else
  ok ".env already exists — skipping"
fi

# Load .env into shell
set -a
# shellcheck disable=SC1091
source .env
set +a

# ─── npm install ─────────────────────────────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
npm install --silent
ok "npm install done"

# ─── Create database if missing ───────────────────────────────────────────────
echo ""
echo "🗄️  Checking database..."

MYSQL_CMD="mysql -h${DB_HOST} -P${DB_PORT} -u${DB_USER} -p${DB_PASSWORD} --silent"

# Create DB if it doesn't exist
$MYSQL_CMD -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" \
  || die "Could not connect to MySQL. Check credentials in .env"
ok "Database '${DB_NAME}' ready"

# ─── Migrations ──────────────────────────────────────────────────────────────
echo ""
echo "🔧 Applying migrations..."

MYSQL_DB="$MYSQL_CMD ${DB_NAME}"

run_migration() {
  local file="$1"
  local label="$2"
  echo -n "   $label ... "
  $MYSQL_DB < "$file" && echo -e "${GREEN}done${NC}" || die "Failed: $file"
}

run_migration "migrations/001_init.sql"    "001_init     (base DDL, 39 tables)"
run_migration "migrations/002_patches.sql" "002_patches  (all schema patches)"

ok "Migrations 001-002 applied"

# ─── Bootstrap companies + super_admin ───────────────────────────────────────
# Must run BEFORE 003 because 003 seeds tbl_punch_config/tbl_rate_config
# via INSERT...SELECT FROM tbl_company — companies must exist first.
echo ""
echo "👤 Seeding companies and creating super admin..."
node scripts/bootstrap-user.js

# ─── Migration 003 — runs after companies are seeded ─────────────────────────
echo ""
echo "🔧 Applying migration 003 (config seed + legacy table drop)..."
run_migration "migrations/003_seed_and_finalize.sql" "003_finalize (seed configs, drop tbl_computation_rules)"

ok "All migrations applied"

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────"
ok "Setup complete!"
echo ""
echo "  Start server:  npm run dev"
echo "  Production:    npm start   (or pm2 start src/server.js)"
echo ""
