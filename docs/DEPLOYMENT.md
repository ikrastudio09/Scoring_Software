# Deployment

Target: one Linux VM (Ubuntu 22.04/24.04, 2 vCPU, 2–4 GB RAM) running nginx → Node.js → MongoDB.
Measured load (see [TESTING.md](TESTING.md)) shows this is ample for 500 concurrent viewers.

## 1. Local development

Prerequisites: Node.js **20.18+**, MongoDB 7/8 running locally, Git.

```bash
npm install
cp server/.env.example server/.env        # set NODE_ENV=development, ADMIN_PASSWORD
npm run seed -- --reset --simulate 20 --live   # sample tournament, 20 results, 1 live match
npm run dev                                # API + sockets on :4000
npm run dev:admin                          # http://localhost:5174/admin/
npm run dev:viewer                         # http://localhost:5173/
npm run dev:led                            # http://localhost:5175/led/
```

The Vite dev servers proxy `/api` and `/socket.io` to `:4000`.

## 2. Server setup (production)

```bash
# Node 20 LTS (or 22), MongoDB 8, nginx, certbot
sudo apt install -y nginx certbot python3-certbot-nginx
# MongoDB: follow https://www.mongodb.com/docs/manual/administration/install-on-linux/
sudo systemctl enable --now mongod

sudo useradd -r -m -d /opt/cricket cricket
sudo -u cricket git clone <repo> /opt/cricket && cd /opt/cricket
sudo -u cricket npm ci
sudo -u cricket npm run build          # builds admin, viewer, led into apps/*/dist
sudo -u cricket cp server/.env.example server/.env && sudo -u cricket nano server/.env
```

Required `.env` values in production: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`
(≥ 32 random chars — the server refuses to start otherwise), `ADMIN_USERNAME`/`ADMIN_PASSWORD`
for the first boot. All variables are documented in `server/.env.example`.

### Database security
MongoDB must listen on `127.0.0.1` only (default `bindIp`). If MongoDB runs on another host,
enable authentication, create a user with `readWrite` on the `cricket` database only, and use
`mongodb://user:pass@host:27017/cricket?authSource=cricket` with TLS. Never expose 27017 publicly.

### Load the tournament
```bash
cd server
npm run import -- ../data/my-tournament.json   # see data/tournament.example.json
npm run create-user -- scorer1 scorer          # one account per scorer
```

## 3. Process manager

pm2 (recommended):
```bash
sudo npm i -g pm2
sudo mkdir -p /var/log/cricket && sudo chown cricket /var/log/cricket
sudo -u cricket pm2 start infrastructure/ecosystem.config.cjs
sudo -u cricket pm2 save && sudo pm2 startup systemd -u cricket --hp /opt/cricket
```
or systemd: `infrastructure/cricket.service`.

**Run exactly one instance.** Commands for a match are serialised in-process; the unique
`(match, seq)` index makes a second writer fail safely, but one instance is the supported setup
(and is far more than the load needs).

On every start the server: connects to MongoDB, syncs indexes, creates the bootstrap admin if
there are no users, and **reconciles match documents against the event log** (repairs anything a
crash interrupted). Match state itself is always rebuilt from the event log on first access.

## 4. HTTPS, domain and WebSockets

1. Point an `A` record (e.g. `scores.example.com`) at the server.
2. `sudo cp infrastructure/nginx.conf /etc/nginx/sites-available/cricket`, replace the domain,
   `ln -s` into `sites-enabled`, `sudo nginx -t && sudo systemctl reload nginx`.
3. `sudo certbot --nginx -d scores.example.com` (auto-renews).

The config upgrades `/socket.io/` to WebSockets with 120 s timeouts and sets `X-Forwarded-*`.
`TRUST_PROXY=1` makes rate limiting use the real client IP.

URLs: viewer `https://scores.example.com/`, scorer `…/admin/`, LED `…/led/` (or `…/led/?match=<id>`).

## 5. Frontend deployment

Express serves the three built apps (`SERVE_STATIC=true`), with immutable caching for hashed
assets. To host them elsewhere (CDN), deploy `apps/*/dist` and set `CORS_ORIGINS` to their
origins; build the viewer with `VITE_API_URL=https://api.example.com`.

## 6. Logs and monitoring

- Logs: JSON lines (pino) — `pm2 logs cricket` or `/var/log/cricket/*.log`. Every scoring command
  is logged with match, seq, type, label, user and latency (`"msg":"scoring event"`). Failed logins,
  4xx/5xx and errors (with stack traces, server-side only) are logged too. Use `pm2 install
  pm2-logrotate` for rotation.
- Health: `GET /api/health` (200 / 503) — point UptimeRobot/BetterStack at it.
- Metrics: admin console → **System**, or `GET /api/admin/metrics`.
- Integrity: `npm run verify:matches` (read-only) replays every match and compares it with stored
  data; `--repair` resyncs.

## 7. Backups and recovery

- `npm run backup` → `mongodump --gzip` into `BACKUP_DIR` (falls back to a JSON export when
  mongodump is not installed); keeps the newest `BACKUP_KEEP`.
- Schedule `infrastructure/backup-cron.sh` every 15 minutes during the tournament and copy
  off-site (rclone example inside).
- Restore: `mongorestore --gzip --drop --uri="$MONGODB_URI" /var/backups/cricket/backup-<ts>/`,
  then restart the server (it reconciles on boot) and run `npm run stats:rebuild`.
- What matters is the `matchevents` collection (+ `matches`, `teams`, `players`, `tournaments`,
  `users`). Everything else is derived and can be rebuilt.

Data-safety properties: each scoring event is acknowledged only after MongoDB's journal write
(`j: true`); events are append-only; undo appends an `UNDO` event instead of deleting.

## 8. Android app

See [ANDROID.md](ANDROID.md).

## 9. Cloning for another tournament

1. Clone the repository; new database (`MONGODB_URI`), new `.env`.
2. Write `data/<tournament>.json` (tournament info, branding, rules, points, teams with players,
   fixtures) and `npm run import -- …`.
3. Optional: logo URL and colours (also editable later in admin → Settings).
4. Android: change `appId`/`appName` in `apps/viewer/capacitor.config.json`, icons in
   `apps/viewer/assets/`, and `VITE_API_URL`.
5. Deploy as above.
