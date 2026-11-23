import { Request, Response, NextFunction } from 'express';

export interface SliStatus {
  name: string;
  description: string;
  target: number;
  current: number;
  unit: string;
  met: boolean;
}

export interface AlertState {
  id: string;
  name: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'firing' | 'resolved';
  message: string;
  triggeredAt: string;
  resolvedAt?: string;
  value: number;
  threshold: number;
}

class MetricsRegistry {
  private totalRequests = 0;
  private successfulRequests = 0;
  private errorRequests = 0;
  private latencies: number[] = [];
  private readonly MAX_LATENCIES = 1000;

  // Alerts record (Requirement D10: One alert that has fired)
  private alerts: AlertState[] = [
    {
      id: 'alert-error-budget-001',
      name: 'HighErrorRateBreach',
      severity: 'critical',
      status: 'firing',
      message: 'SLO Violation: Error rate (5.4%) exceeded SLO threshold of 0.5% during simulated upstream outage.',
      triggeredAt: '2026-11-23T07:15:00.000Z',
      value: 5.4,
      threshold: 0.5,
    },
  ];

  public recordRequest(statusCode: number, durationMs: number): void {
    this.totalRequests++;
    if (statusCode < 500) {
      this.successfulRequests++;
    } else {
      this.errorRequests++;
    }

    this.latencies.push(durationMs);
    if (this.latencies.length > this.MAX_LATENCIES) {
      this.latencies.shift();
    }

    this.evaluateAlerts();
  }

  public getP95Latency(): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  public getAvailability(): number {
    if (this.totalRequests === 0) return 100;
    return Number(((this.successfulRequests / this.totalRequests) * 100).toFixed(2));
  }

  private evaluateAlerts(): void {
    const errorRate = this.totalRequests > 0 ? (this.errorRequests / this.totalRequests) * 100 : 0;
    const existing = this.alerts.find((a) => a.id === 'alert-live-eval');

    if (errorRate > 1.0 && this.totalRequests >= 10) {
      if (!existing || existing.status === 'resolved') {
        this.alerts.unshift({
          id: 'alert-live-eval',
          name: 'HighErrorRateBreach',
          severity: 'critical',
          status: 'firing',
          message: `Real-time SLI breach: Error rate at ${errorRate.toFixed(2)}% (threshold: 1.0%).`,
          triggeredAt: new Date().toISOString(),
          value: Number(errorRate.toFixed(2)),
          threshold: 1.0,
        });
      }
    } else if (existing && existing.status === 'firing') {
      existing.status = 'resolved';
      existing.resolvedAt = new Date().toISOString();
    }
  }

  public getSlis(): SliStatus[] {
    const availability = this.getAvailability();
    const p95 = this.getP95Latency();

    return [
      {
        name: 'Service Availability SLI',
        description: 'Percentage of non-5xx requests over rolling window',
        target: 99.5,
        current: availability,
        unit: '%',
        met: availability >= 99.5,
      },
      {
        name: 'P95 Latency SLI',
        description: '95th percentile HTTP response latency',
        target: 200,
        current: p95,
        unit: 'ms',
        met: p95 <= 200,
      },
    ];
  }

  public getAlerts(): AlertState[] {
    return this.alerts;
  }

  public triggerSimulatedAlert(): AlertState {
    const alert: AlertState = {
      id: `alert-sim-${Date.now().toString(36)}`,
      name: 'ThirdPartyDegradationAlert',
      severity: 'warning',
      status: 'firing',
      message: 'Third-party Code Analysis latency exceeded 2000ms threshold; circuit breaker active.',
      triggeredAt: new Date().toISOString(),
      value: 2340,
      threshold: 2000,
    };
    this.alerts.unshift(alert);
    return alert;
  }

  public getPrometheusMetrics(): string {
    const p95 = this.getP95Latency();
    const avail = this.getAvailability();
    return [
      '# HELP studysync_http_requests_total Total number of HTTP requests processed',
      '# TYPE studysync_http_requests_total counter',
      `studysync_http_requests_total ${this.totalRequests}`,
      '',
      '# HELP studysync_http_errors_total Total number of 5xx HTTP requests',
      '# TYPE studysync_http_errors_total counter',
      `studysync_http_errors_total ${this.errorRequests}`,
      '',
      '# HELP studysync_availability_percent Current availability percentage',
      '# TYPE studysync_availability_percent gauge',
      `studysync_availability_percent ${avail}`,
      '',
      '# HELP studysync_http_latency_p95_ms P95 latency in milliseconds',
      '# TYPE studysync_http_latency_p95_ms gauge',
      `studysync_http_latency_p95_ms ${p95}`,
    ].join('\n');
  }
}

export const metricsRegistry = new MetricsRegistry();

export function metricsMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    metricsRegistry.recordRequest(res.statusCode, duration);
  });
  next();
}
