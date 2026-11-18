# Hosting architecture and running cost — MPL Season 21

Prepared 3 November 2026. Prices were looked up on that date (sources at the end); cloud prices
change, so every number is also given as a formula you can re-run with current prices.

## 1. Summary

**Recommendation: one small ARM (Graviton) VM in Mumbai, running everything (nginx, Node.js,
MongoDB), with Cloudflare's free plan in front, daily backups off the machine, and automatic
recovery.** Measured load shows a single small VM is far from its limits at the expected 200–500
concurrent viewers.

| Option (Mumbai unless noted) | RAM / vCPU | ≈ USD / month before tax | ≈ with 18 % GST | Verdict |
|---|---|---|---|---|
| **AWS EC2 t4g.small** + 20 GB gp3 + public IPv4 | 2 GB / 2 | **$13.9** | **$16.4** | **Recommended if you stay on EC2** (current deployment) |
| **AWS Lightsail 2 GB plan** ($12, IPv4 and 1.5 TB transfer included) | 2 GB / 2 | **$12.3** | **$14.5** | **Cheapest reliable AWS option**; simplest bill |
| AWS EC2 t4g.micro | 1 GB / 2 | $9.9 | $11.6 | Possible but tight on RAM (MongoDB + Node + build); not recommended for match days |
| AWS EC2 t4g.medium | 4 GB / 2 | $22.1 | $26.1 | Only if load grows several times (see §7) |
| DigitalOcean Basic 2 GB (Bangalore) | 2 GB / 1 | ~$12 (+ backups) | — | Comparable; verify the Bangalore price |
| Hetzner Cloud (Singapore) | 2–4 GB | ~€6–9 | — | Cheap, but no India region (+60–90 ms) and 2026 price changes |
| Oracle Cloud Always Free (Hyderabad / Mumbai) | up to 12–24 GB | $0 | $0 | Not reliable enough as the only server (capacity, idle reclamation) |

**Expected total for the tournament window** (two months running, EC2 t4g.small): **≈ $33**
including GST; Lightsail ≈ $29. Data transfer stays inside the free / included allowances (§4.3).
Running all year: ≈ $174 (Lightsail) – $197 (EC2) — see §6 for running only around the tournament.

## 2. Architecture

```
 Phones (web + Android app), laptops, LED screen
        │  HTTPS + WebSocket
        ▼
 Cloudflare (free plan) — DNS, TLS, DDoS protection, caches hashed static files
        │  HTTPS (origin certificate)
        ▼
 ┌──────────────────────── one VM (Ubuntu 24.04, arm64) ─────────────────────────┐
 │ nginx  — TLS, gzip, static files, WebSocket upgrade                            │
 │   └─► Node.js 20 (PM2, ONE process) — Express API + Socket.IO + scoring engine │
 │          └─► MongoDB 8 (localhost only) — event log (source of truth) + data   │
 │ cron: mongodump every 2 h on match days → local + S3                           │
 └────────────────────────────────────────────────────────────────────────────────┘
        │ backups                       │ snapshots
        ▼                               ▼
 S3 (or any object storage)      EBS / Lightsail snapshots (daily)
```

Why one process on one VM: the application keeps each match's state in memory and serialises
scoring per match; Socket.IO fans out from that process. This is the design that was load-tested
(§3) and it removes whole classes of cost and failure (no Redis, no load balancer, no managed
database, no cross-machine traffic). Everything that matters is recoverable from the MongoDB event
log, which is backed up off the machine.

Nothing in the stack is x86-specific (bcryptjs is pure JavaScript; MongoDB 8 and Node 20 ship arm64
builds for Ubuntu), so the cheaper Graviton (t4g) instances work unchanged.

## 3. Workload and measured resource use

### 3.1 Expected workload (from the brief)

| Item | Value |
|---|---|
| Matches | ≈ 80 (Men's, Ladies, Kids; only one live at a time) |
| Match length | 8–10 overs a side, ≈ 1.5 h including the break |
| Registered / total users | ≈ 4 000 |
| Peak concurrent viewers | 200–500 |
| Scoring events per match | ≈ 170 (≈ 135 deliveries incl. extras + bowler / batter / innings events) |

### 3.2 Measured on this code base (`npm run load`, docs/TESTING.md)

One live match, **500 viewer sockets + LED**, a ball every **2 s** (about 15× faster than a real
match), plus public API traffic:

| Measurement | Result |
|---|---|
| Node.js CPU | **7 % of one core** |
| Node.js memory | **121 MB** |
| Ball delivered to every viewer | 500 / 500 viewers received 60 / 60 balls; p95 34 ms |
| Reconnect storm (all 500 at once) | recovered in 0.49 s |
| Message size per ball | 2.2 KB measured (≈ 2.5 KB with the Phase 4 additions) |
| Stress (≈ 2 000 API requests/s, 80× realistic) | 155 % CPU, 215 MB, still no errors |

The measurement ran on a laptop with the load generator on the same machine, so a server does
better. Real matches produce one ball every 25–40 s, so steady CPU on match days is a few percent.

## 4. Sizing

### 4.1 Memory (the deciding resource)

| Component | Typical | Notes |
|---|---|---|
| Ubuntu + SSM / CloudWatch agents | 300–400 MB | |
| MongoDB 8 | 300–500 MB | set `storage.wiredTiger.engineConfig.cacheSizeGB: 0.25` — the whole season's data is tens of MB |
| Node.js (API + sockets + caches) | 120–250 MB | measured 121 MB at 500 viewers |
| nginx | 20 MB | |
| **Total** | **≈ 0.8–1.2 GB** | → **2 GB RAM** leaves comfortable headroom; add a 2 GB swap file as a safety net |

`npm run build` (Vite) needs ~1 GB extra: build on your laptop or CI and copy `apps/*/dist`, or
build on the server with the swap file in place (slower, but works on 2 GB).

### 4.2 CPU

t4g instances are burstable: t4g.small earns credits while below its baseline (20 % of each of its
2 vCPUs) and spends them during bursts. Steady load here is a few percent of one vCPU, so credits
accumulate between matches and cover bursts (reconnect storms, statistics rebuilds, qualification
calculations). Keep the instance in **"standard" credit mode** so it can never generate a
surprise surplus-credit bill.

### 4.3 Network (data transfer out)

Formula per match:

```
socket MB ≈ events × message KB × average concurrent viewers ÷ 1024
page MB   ≈ average concurrent viewers × MB per viewer per match (first load + scorecard refreshes)
```

| Input | Expected | Peak |
|---|---|---|
| events per match | 170 | 170 |
| message size | 2.5 KB | 2.5 KB |
| average concurrent viewers | 250 | 500 |
| page + API per viewer per match | 0.3 MB (app 0.22 MB first load, gzip; cached afterwards) | 0.3 MB |
| **per match** | 104 MB + 75 MB ≈ **0.18 GB** | 207 MB + 150 MB ≈ **0.35 GB** |
| **80 matches** | **≈ 14 GB** | **≈ 28 GB** |
| browsing between matches (4 000 users × 20 visits × 0.1 MB) | ≈ 8 GB | ≈ 8 GB |
| **tournament total** | **≈ 22 GB** | **≈ 36 GB** |

(The Android app carries its own copy of the web app, so it only downloads data.)

That is **well inside** AWS's free monthly data-transfer-out allowance (100 GB/month, verify on
your bill) and a small fraction of Lightsail's 1.5 TB (Mumbai halves the usual allowance). With
Cloudflare caching the hashed static files, origin traffic is lower still. **Expected data-transfer
cost: $0.**

### 4.4 Disk

| Use | Size |
|---|---|
| Ubuntu | 4–5 GB |
| Application + node_modules + builds | < 1 GB |
| MongoDB data for a season (events, stats, history) | < 0.5 GB |
| Logs (rotated) + 60 days of local dumps | < 1 GB |
| **Allocate** | **20 GB gp3** (Lightsail plans include 60 GB) |

## 5. Cost worksheet (use with any provider)

```
monthly = compute/hour × hours running
        + disk GB × price/GB-month
        + public IPv4/hour × hours            (AWS EC2; included in Lightsail, DigitalOcean, Hetzner)
        + snapshot GB × price/GB-month
        + max(0, data out GB − free allowance) × price/GB
        + monitoring / alarms
then    × 1.18 GST (AWS bills Indian accounts through AISPL in INR with 18 % GST)
then    × your ₹ / $ rate
```

### 5.1 AWS EC2, Mumbai (ap-south-1), on-demand, 730 h

| Item | Rate | t4g.micro | **t4g.small** | t4g.medium |
|---|---|---|---|---|
| Instance | $0.0056 / $0.0112 / $0.0224 per h | $4.09 | **$8.18** | $16.35 |
| gp3 20 GB | $0.0912 / GB-month | $1.82 | **$1.82** | $1.82 |
| Public IPv4 | $0.005 / h | $3.65 | **$3.65** | $3.65 |
| Snapshots (≈ 3 GB incremental) | ≈ $0.05 / GB-month (verify) | $0.15 | **$0.15** | $0.15 |
| S3 backups (< 1 GB) | — | < $0.05 | **< $0.05** | < $0.05 |
| Data out (≈ 22–36 GB) | first 100 GB/month free (verify) | $0 | **$0** | $0 |
| CloudWatch auto-recover alarm | $0.10 / alarm-month (free tier may cover it) | $0.10 | **$0.10** | $0.10 |
| **Total** | | **$9.9** | **$13.9** | **$22.1** |
| **With 18 % GST** | | $11.6 | **$16.4** | $26.1 |

Notes: t3a.small (x86) is $0.0123/h, t3.small $0.0224/h — the Graviton t4g.small is the cheapest
2 GB choice. A 1-year Compute Savings Plan or reserved instance lowers the instance line further if
the server will run all year (check the current discount in the AWS console before committing).

### 5.2 AWS Lightsail, Mumbai

| Plan | Price | Includes | Monthly with snapshots | With GST |
|---|---|---|---|---|
| 1 GB / 2 vCPU | $7 | public IPv4, SSD, transfer (halved in Mumbai) | ≈ $7.3 | ≈ $8.6 |
| **2 GB / 2 vCPU / 60 GB** | **$12** | public IPv4, 1.5 TB transfer in Mumbai | **≈ $12.3** | **≈ $14.5** |
| 4 GB | $24 | | ≈ $24.3 | ≈ $28.7 |

Lightsail is the same AWS hardware with a bundled price: fewer moving parts, a flat bill, and
snapshots and a static IP in the console. Trade-off: fewer knobs (no Savings Plans, simpler
monitoring), and moving from your current EC2 server means a one-off migration (§8.4).

### 5.3 Other providers (for comparison)

| Provider | Typical 2 GB plan | Pros | Cons |
|---|---|---|---|
| DigitalOcean (Bangalore) | Basic 2 GB ≈ $12, 2 TB transfer | India region, simple, per-second billing | backups +20 %; Bangalore price to verify; 1 vCPU |
| Hetzner Cloud (Singapore) | ≈ €6–9 after the 2026 price change | cheapest per GB of RAM | no India region (+60–90 ms to scorers and LED); smaller traffic allowance in Singapore |
| Oracle Cloud Always Free | $0 (Ampere A1, reportedly reduced to 2 OCPU / 12 GB from June 2026) | free, generous | Indian regions are single availability domain with scarce A1 capacity; Always Free instances can be reclaimed when idle; acceptable for a **staging** or **standby** copy, not as the only match-day server |

## 6. Reducing cost further (without hurting reliability)

1. **Run it around the tournament only.** Keep it on from about two weeks before the first match
   to two weeks after the final. Between seasons either downsize to t4g.micro / the $7 Lightsail
   plan (results and history stay online), or take a final backup + snapshot and stop it.
   Note that a stopped EC2 instance still pays for its disk and any Elastic IP (≈ $5.5/month).
2. **Graviton (t4g) over x86** — same work, about half the price of t3.small.
3. **gp3, not gp2**, and 20 GB rather than the default larger volumes.
4. **Cloudflare free plan** in front: free TLS, DDoS protection, caching of static files (less
   origin traffic and CPU). WebSockets work on the free plan with the record proxied. Cloudflare
   occasionally restarts connections; the apps already reconnect and resync on their own.
5. **Standard CPU-credit mode** on t4g, so a runaway process can never create a surplus bill.
6. **AWS Budgets alert** at e.g. $20/month (budget alerts are free for the first budgets).
7. **Build off the server** (laptop or CI), so a smaller instance is never needed just for builds.
8. **Don't buy** what the measurements show isn't needed: load balancer (≈ $16+/month on its own),
   NAT gateway, managed MongoDB (Atlas) or RDS, Redis, Kubernetes, multiple instances. Each adds
   cost and moving parts without improving match-day reliability at this scale.

## 7. When to size up

Move to the next size (t4g.medium / Lightsail 4 GB) only if, on match days:

- memory used stays above ≈ 75 % (`free -m`; Node RSS in `/api/admin/metrics`), or
- the CPU credit balance keeps falling across a match day (CloudWatch `CPUCreditBalance`), or
- concurrent viewers regularly exceed ≈ 2 000 (an extrapolation from the measured 500 — run
  `npm run load -- --viewers 2000` against a staging copy before relying on it).

Resizing an EC2 instance takes a few minutes (stop → change type → start); do it the day before
a match day, not during one.

## 8. Reliability plan (single VM, done properly)

### 8.1 What is already built into the application
- Every ball is committed to MongoDB's journal before it is acknowledged; the match state is
  rebuilt from that log after any restart (tested: crash, restart, cache loss).
- The scorer's app keeps unconfirmed actions and retries them with the same id; nothing is
  scored twice.
- Viewers, the Android app and the LED reconnect and resync automatically.
- PM2 restarts the Node process if it exits; the one-live-match lock repairs itself at startup.

### 8.2 Add on the server (one-time setup, ≈ $0–0.30/month)
| Measure | How | Cost |
|---|---|---|
| Backups off the machine | `npm run backup -w server` from cron **every 2 h on match days**, daily otherwise; copy to S3 (or any object storage) | < $0.05 |
| Disk snapshots | AWS Data Lifecycle Manager: daily, keep 7 (Lightsail: automatic snapshots) | ≈ $0.15 |
| Automatic recovery from host failure | CloudWatch alarm on `StatusCheckFailed_System` with the **recover** action (Lightsail recovers automatically) | ≈ $0.10 |
| Uptime alerting | a free external monitor (e.g. UptimeRobot) on `https://<domain>/api/health` → SMS / email | $0 |
| Swap file | 2 GB `/swapfile` | $0 |
| Log rotation | pm2-logrotate or logrotate for `/var/log/cricket` | $0 |
| Security | SSH key only, security group open on 80/443 (and 22 from your IP), MongoDB bound to 127.0.0.1, automatic security updates | $0 |

### 8.3 Recovery targets with this plan
- **Data loss (RPO):** at most 2 h on match days from backups; in practice none, because the
  disk itself survives instance failures and snapshots are daily.
- **Downtime (RTO):** host failure → automatic recovery in minutes; lost disk → new instance from
  the latest snapshot or a fresh VM + `mongorestore` in ≈ 15–20 min (keep Cloudflare DNS TTL low
  so the new IP is picked up quickly).

### 8.4 Match-day checklist
- The day before: `npm run verify:matches -w server`, a manual backup, check free memory and disk,
  confirm the latest snapshot exists, check the CPU credit balance.
- One hour before: `/api/health` is `ok`, the LED screen is connected, the scorer has logged in
  on the match device.
- After the last match of the day: confirm the results, then take a backup.

## 9. Assumptions to revisit
- Viewer numbers (200–500 concurrent, 4 000 users) are the brief's estimates; actual numbers can
  be read from `/api/admin/metrics` after the first match day.
- Message size will change slightly with future features; re-measure with `npm run load`.
- All prices: USD, on-demand, Mumbai, before tax, looked up on 3 Nov 2026 from the sources below
  — several come from third-party price trackers; confirm in the AWS Pricing Calculator / provider
  consoles before committing. Exchange rate: use your bank's rate.

## Sources (looked up 3 Nov 2026)
- EC2 t4g / t3 / t3a hourly prices and gp3 price in ap-south-1: [aws-pricing.com — ap-south-1](https://aws-pricing.com/ap-south-1.html), [Cloudoptimo — t4g.small](https://costcalc.cloudoptimo.com/aws-pricing-calculator/ec2/t4g.small), [Sparecores — t4g.small](https://sparecores.com/server/aws/t4g.small)
- Public IPv4 charge ($0.005/h, since Feb 2024): [AWS News Blog](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights)
- Mumbai internet data-transfer rate: [Databricks data-transfer pricing (AWS Mumbai)](https://databricks.com/sites/default/files/2024-07/data-transfer-pricing.pdf); INR billing via AISPL with 18 % GST and the 100 GB free tier: [PrecisionTech — AWS pricing in Mumbai](https://precisiontech.in/cloud/amazon-aws-cloud/aws-pricing/aws-pricing-in-mumbai/)
- Lightsail plans and Mumbai's halved transfer allowance: [AWS Lightsail data transfer FAQ](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-data-transfer-allowance.html), [AWS Lightsail pricing](https://aws.amazon.com/lightsail/pricing), [Cloudburn — Lightsail pricing 2026](https://cloudburn.io/blog/amazon-lightsail-pricing)
- DigitalOcean 2 GB plan: [TemperStack — DigitalOcean plans](https://www.temperstack.com/plans/digitalocean/), [Cloud Mercato — DigitalOcean 2 GB](https://pcr.cloud-mercato.com/providers/digitalocean/flavors/2gb)
- Hetzner 2026 price adjustment and Singapore: [Hetzner — price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [Hetzner Cloud — what's new](https://docs.hetzner.cloud/whats-new)
- Oracle Always Free limits and Indian regions: [Oracle — Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm), [DEV — Oracle Cloud from India](https://dev.to/ashish-codejourney/getting-a-free-oracle-cloud-vps-from-india-the-full-guide-and-the-rupay-wall-nobody-warns-you-4p5o)
- Cloudflare WebSockets on all plans: [Cloudflare docs — WebSockets](https://developers.cloudflare.com/network/websockets)
