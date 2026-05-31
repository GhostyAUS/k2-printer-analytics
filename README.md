# K2 Printer Analytics

Full-stack analytics platform for Creality K2 printers running Klipper/Moonraker. Live monitoring, cost tracking, filament management, and file browsing.

## Quick Install

One-command install on any fresh Linux system (Ubuntu, Debian, CentOS, Rocky, Arch, etc.):

```bash
curl -fsSL https://raw.githubusercontent.com/GhostyAUS/k2-printer-analytics/main/install/master.sh | sudo bash
```

Or clone and run:

```bash
git clone https://github.com/GhostyAUS/k2-printer-analytics.git
cd k2-printer-analytics
sudo ./install/master.sh --moonraker-host 192.168.1.146
```

### Install Options

| Flag | Default | Description |
|------|---------|-------------|
| `--moonraker-host` | `192.168.1.146` | Moonraker IP address |
| `--moonraker-port` | `7125` | Moonraker port |
| `--meross-email` | _(empty)_ | Meross smart plug email |
| `--meross-password` | _(empty)_ | Meross smart plug password |
| `--meross-device` | `Printer` | Meross device name |
| `--electricity-rate` | `0.49` | Cost per kWh |
| `--currency` | `AUD` | Currency code |
| `--timezone` | `Australia/Perth` | Timezone |
| `--app-port` | `3000` | Frontend port |
| `--api-port` | `8000` | Backend API port |
| `--with-npm` | _(off)_ | Install Nginx Proxy Manager |
| `--self-signed-cert` | _(off)_ | Generate self-signed TLS cert |
| `--cert-domain` | `k2-analytics.local` | Domain for TLS cert |
| `--install-dir` | `/opt/k2-analytics` | Installation directory |
| `--skip-prerequisites` | _(off)_ | Skip Docker/git install |
| `--skip-deploy` | _(off)_ | Config only, don't start containers |
| `--dry-run` | _(off)_ | Show config and exit |

All options can also be set via environment variables (see `install/lib/defaults.sh`).

### Examples

```bash
# Full install with Meross power monitoring
sudo ./install/master.sh --moonraker-host 10.0.0.50 --meross-email you@email.com --meross-password secret

# Install with NPM and self-signed cert for local HTTPS
sudo ./install/master.sh --moonraker-host 10.0.0.50 --with-npm --self-signed-cert --cert-domain k2.local

# Just see what config would be generated
./install/master.sh --moonraker-host 10.0.0.50 --dry-run

# Skip Docker install (already installed) — just configure and deploy
sudo ./install/master.sh --skip-prerequisites --moonraker-host 10.0.0.50
```

## Features

- **Dashboard** — Live print progress, power usage, CFS slot status, maintenance tracking
- **Print Jobs** — Paginated history with sorting, filtering, and cost breakdowns
- **Analytics** — Monthly cost trends, slicer accuracy (±h:mm:ss), CSV export
- **Filament Library** — Track inventory, cost/kg, remaining weight; SpoolmanDB picker; bulk add; CFS slot grouping (T1A–D, T2A–D)
- **CFS Units** — Live Colour Fabric Station data from Moonraker
- **Files** — Browse gcode files on the printer with metadata previews and thumbnails
- **Compare** — Side-by-side comparison of any two print jobs
- **Camera** — Live stream viewer (requires camera module enabled on printer)
- **Reports** — Daily/weekly/monthly reports with cost, filament, and print hour breakdowns
- **System** — Moonraker system info, power readings, Meross smart plug control
- **Settings** — Configure Moonraker connection, Meross credentials, power rates, notifications
- **Auth** — JWT login with setup wizard, admin/user roles
- **Grafana Dashboards** — 7 pre-built dashboards (Print Operations, Power & Energy, Filament & CFS, Cost Analytics, Slicer Accuracy, System Health, Moonraker Live)
- **Prometheus Metrics** — Backend `/metrics` endpoint for request rate, latency, and error tracking

## Manual Setup (Without Installer)

```bash
cp .env.example .env   # Edit with your values
docker compose up -d --build
```

Then visit `http://localhost:3000/setup` for the first-run wizard.

## Architecture

- **Backend**: FastAPI (Python) with PostgreSQL, async Moonraker polling, Meross power monitoring, Prometheus metrics
- **Frontend**: React + Vite + TypeScript with TailwindCSS, route-based lazy loading
- **Monitoring**: Grafana dashboards, Prometheus scraping, 7 pre-built analytics dashboards
- **Deployment**: Docker Compose with PostgreSQL, backend, frontend, Prometheus

## License

MIT