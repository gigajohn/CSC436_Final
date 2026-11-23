# StudySync Cloud Cost & Scaling Analysis (Requirement D11)

This document provides our comprehensive cloud infrastructure cost model, capacity planning arithmetic, and cost control mechanisms across 1× (baseline), 10×, and 100× traffic tiers.

---

## 1. Traffic & Workload Assumptions

| Metric | 1× Baseline (1,000 MAU) | 10× Growth (10,000 MAU) | 100× Peak Campus (100,000 MAU) |
|---|---|---|---|
| **Active Users (MAU)** | 1,000 students / faculty | 10,000 users | 100,000 users across university system |
| **Daily API Requests** | 50,000 requests/day | 500,000 requests/day | 5,000,000 requests/day |
| **Monthly API Requests** | 1,500,000 requests/mo | 15,000,000 requests/mo | 150,000,000 requests/mo |
| **Average Request Payload** | 12 KB (JSON + diffs) | 12 KB | 12 KB |
| **Egress Bandwidth** | ~35 GB / month | ~350 GB / month | ~3.5 TB / month |
| **Database Storage** | 10 GB (Relational + Audit) | 50 GB | 350 GB |
| **Third-Party Code Analysis**| 15,000 runs / month | 150,000 runs / month | 1,500,000 runs / month (with 80% cache hit) |

---

## 2. Unit Pricing & Service Catalog

Pricing is based on current cloud standard rates (AWS / GCP / Cloudflare / Managed Redis):
1. **Container Compute (AWS Fargate / GCP Cloud Run)**:
   - vCPU: \$0.04048 per vCPU-hour
   - Memory: \$0.004445 per GB-hour
   - Baseline container: 0.5 vCPU, 1 GB RAM = \$0.0247 / hour (\$17.80 / month per instance)
2. **Managed Relational Database (PostgreSQL)**:
   - AWS RDS db.t4g.micro: 2 vCPU, 1 GB RAM = \$12.41 / month (Free tier eligible for first 12 months)
   - AWS RDS db.m6g.large (Multi-AZ): \$180.00 / month
   - Storage: gp3 SSD at \$0.115 per GB-month
3. **In-Memory Cache (Managed Redis / ElastiCache)**:
   - cache.t4g.micro: \$11.50 / month
   - cache.m6g.large: \$98.00 / month
4. **CDN & Edge Egress (Cloudflare)**:
   - Free / Pro tier: Unlimited static ingress/egress for standard web assets
   - Cloudflare Pro: \$20.00 / month
   - Cloudflare Business / Enterprise: \$200.00 / month
5. **Third-Party Static Analysis API**:
   - Free tier: First 2,000 scans free
   - Tiered usage: \$0.002 per scan thereafter

---

## 3. Monthly Cost Arithmetic & Projections Table

| Infrastructure Component | 1× Baseline (1k MAU) | 10× Scale (10k MAU) | 100× Scale (100k MAU) | Arithmetic & Sizing Justification |
|---|---|---|---|---|
| **App Compute (Backend)** | **\$17.80** (1 × 0.5 vCPU instance) | **\$53.40** (3 × 0.5 vCPU instances, autoscale) | **\$356.00** (20 × 0.5 vCPU instances, autoscale) | 1×: 1.5M reqs / 30 days = ~0.6 req/s avg, 15 req/s peak. Handled easily by 1 instance.<br>10×: 6 req/s avg, 150 req/s peak -> 3 instances.<br>100×: 60 req/s avg, 1,500 req/s peak -> 20 instances. |
| **Frontend Static Hosting** | **\$0.00** (Cloudflare Pages / S3) | **\$0.00** (Cloudflare Pages / S3) | **\$15.00** (S3 origin storage & request ops) | Static React bundle built and hosted via CDN edge. Storage < 100MB. |
| **Relational DB (PostgreSQL)** | **\$13.56** (db.t4g.micro + 10GB gp3) | **\$48.16** (db.t4g.small + 50GB gp3 + backups) | **\$220.25** (db.m6g.large Multi-AZ + 350GB gp3) | 1×: \$12.41 compute + (10 GB × \$0.115) = \$13.56<br>10×: \$42.41 compute + (50 GB × \$0.115) = \$48.16<br>100×: \$180 compute + (350 GB × \$0.115) = \$220.25 |
| **Cache (Redis State Store)** | **\$11.50** (cache.t4g.micro) | **\$23.00** (cache.t4g.small) | **\$98.00** (cache.m6g.large cluster) | Stores sliding-window rate limit counters and OIDC PKCE transaction state (10-minute TTL). |
| **CDN & DNS (Cloudflare)** | **\$0.00** (Cloudflare Free Tier) | **\$20.00** (Cloudflare Pro Plan) | **\$200.00** (Cloudflare Business Plan) | 1×: Free tier covers DNS, SSL renewal, standard CDN.<br>10×: Pro plan adds advanced WAF & image optimization.<br>100×: Business plan adds custom 100% SLA & rate limit rules. |
| **Third-Party API Scans** | **\$26.00** (13,000 billable scans) | **\$60.00** (30,000 scans after 80% cache hit) | **\$600.00** (300,000 scans after 80% cache hit) | 1×: (15k - 2k free) × \$0.002 = \$26.00.<br>10×: 150k scans with 80% cached in Redis = 30k billable × \$0.002 = \$60.00.<br>100×: 1.5M scans with 80% cached = 300k billable × \$0.002 = \$600.00. |
| **Observability (OTel Logs/Metrics)** | **\$0.00** (Free tier / Self-hosted Prometheus) | **\$15.00** (Managed Grafana Cloud) | **\$85.00** (Datadog / Grafana Cloud Pro) | Log volume: 1×: ~1.5 GB/mo; 10×: ~15 GB/mo; 100×: ~150 GB/mo. |
| **TOTAL ESTIMATED MONTHLY COST** | **\$68.86 / month** | **\$219.56 / month** | **\$1,574.25 / month** | **Cost per active user: \$0.068 (1×) -> \$0.021 (10×) -> \$0.015 (100×)** |

---

## 4. Cost Efficiency & Economy of Scale Analysis

1. **Sub-linear Cost Growth**:
   While traffic increases by **100×** (from 1,000 to 100,000 users), total monthly infrastructure costs only increase by **22.8×** (from \$68.86 to \$1,574.25).
2. **Cost Per User Declines by 78%**:
   - At 1×: **\$0.068** per user/month.
   - At 100×: **\$0.015** per user/month.
   This efficiency is driven by Redis caching for third-party analysis (80% cache hit rate eliminates 1.2 million unnecessary third-party API invocations), CDN edge caching of static assets, and horizontal container auto-scaling.

---

## 5. Cost Control & Budget Alerts (Requirement D11)

To strictly enforce financial boundaries and prevent runaway billing:
1. **Cloud Budget Alert Configuration**:
   - **Monthly Budget Target**: \$100.00 (covers 1× baseline comfortably).
   - **Alert Threshold 1 (Warning)**: Fired at **75%** (\$75.00 actual or forecasted spend) notifying the on-call engineer via Slack/Email.
   - **Alert Threshold 2 (Critical)**: Fired at **90%** (\$90.00 spend).
   - **Hard Cap Action**: Automatically scales down non-essential background worker pods and tightens rate limiter sliding windows from 60 req/min to 20 req/min to protect budget.
2. **Zero-Cost Free Tier Mode**:
   StudySync is architected to run 100% on free tiers during development and initial deployment:
   - In-process PostgreSQL (PGlite) + local volume: \$0.00
   - In-memory rate limiter + cache: \$0.00
   - Cloudflare CDN + DNS free tier: \$0.00
   - Self-hosted OpenTelemetry Prometheus endpoint: \$0.00

