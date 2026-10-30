const collator = new Intl.Collator('cs', { sensitivity: 'base', numeric: true });

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').trim();
}

function number(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function percentChange(current, previous) {
  const a = number(current), b = number(previous);
  return a === null || b === null || b <= 0 ? null : (a - b) / b * 100;
}

function searchSummary(projects) {
  const groups = new Map();
  for (const project of projects) {
    const measurement = project.searchConsole;
    const current = measurement?.current;
    if (!measurement?.property || !measurement.periodStart || !measurement.periodEnd || number(current?.clicks) === null || number(current?.impressions) === null) continue;
    const key = [measurement.periodStart, measurement.periodEnd, measurement.previousPeriodStart, measurement.previousPeriodEnd, measurement.dataState, measurement.isHistorical, measurement.searchType ?? 'web'].join('|');
    let group = groups.get(key);
    if (!group) {
      group = { periodStart: measurement.periodStart, periodEnd: measurement.periodEnd, previousPeriodStart: measurement.previousPeriodStart, previousPeriodEnd: measurement.previousPeriodEnd, dataState: measurement.dataState, isHistorical: measurement.isHistorical, searchType: measurement.searchType ?? 'web', clicks: 0, impressions: 0, previousClicks: 0, previousImpressions: 0, previousComplete: true, projectCount: 0, properties: [] };
      groups.set(key, group);
    }
    // A domain property can be linked from multiple local folders. Count it once.
    const propertyKey = `${measurement.property}|${measurement.filterKey ?? ''}`;
    if (group.properties.includes(propertyKey)) continue;
    group.properties.push(propertyKey);
    group.projectCount += 1;
    group.clicks += number(current.clicks);
    group.impressions += number(current.impressions);
    if (number(measurement.previous?.clicks) !== null && number(measurement.previous?.impressions) !== null && measurement.comparablePeriods) {
      group.previousClicks += number(measurement.previous.clicks);
      group.previousImpressions += number(measurement.previous.impressions);
    } else group.previousComplete = false;
  }
  return [...groups.values()].map(group => ({ ...group,
    ctr: group.impressions > 0 ? group.clicks / group.impressions : null,
    clicksPercent: group.previousComplete ? percentChange(group.clicks, group.previousClicks) : null,
    impressionsPercent: group.previousComplete ? percentChange(group.impressions, group.previousImpressions) : null,
    previousClicks: group.previousComplete ? group.previousClicks : null,
    previousImpressions: group.previousComplete ? group.previousImpressions : null
  }));
}

export function trafficLabel(metric) {
  const key = typeof metric === 'object' ? metric?.metric ?? metric?.unit : metric;
  const labels = { sessions: 'Návštěvy / relace', session: 'Návštěvy / relace', users: 'Uživatelé', unique_users: 'Unikátní uživatelé', totalUsers: 'Uživatelé', activeUsers: 'Aktivní uživatelé', active_users: 'Aktivní uživatelé', visitors: 'Návštěvníci dle zdroje', pageviews: 'Zobrazení stránek', page_views: 'Zobrazení stránek', landing_page_views: 'Zobrazení landing page', clicks: 'Kliknutí' };
  return labels[key] ?? 'Návštěvnost dle zdroje';
}

export function formatNumber(value, maxDigits = 0) {
  const n = number(value);
  return n === null ? '—' : new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: Math.max(0, Math.min(8, Number(maxDigits) || 0)) }).format(n);
}

export function formatMoney(value, currency = 'CZK') {
  const n = number(value);
  if (n === null) return '—';
  const code = String(currency || 'CZK').toUpperCase();
  try { return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: code, maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n); }
  catch { return `${formatNumber(n, 2)} ${code}`; }
}

export function formatDate(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (match) {
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) return '—';
    return `${match[3]}.${match[2]}.${match[1]}`;
  }
  const date = new Date(value);
  if (!Number.isFinite(+date)) return '—';
  const parts = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(date);
  return `${parts.find(p => p.type === 'day').value}.${parts.find(p => p.type === 'month').value}.${parts.find(p => p.type === 'year').value}`;
}

export function periodLabel(metric) {
  if (!metric || (!metric.periodStart && !metric.periodEnd)) return 'Období neuvedeno';
  if (metric.periodStart === metric.periodEnd) return formatDate(metric.periodStart);
  if (!metric.periodStart) return `Do ${formatDate(metric.periodEnd)}`;
  if (!metric.periodEnd) return `Od ${formatDate(metric.periodStart)}`;
  return `${formatDate(metric.periodStart)} – ${formatDate(metric.periodEnd)}`;
}

export function complexityLabel(score) {
  return ({ 1: 'Nízká', 2: 'Mírná', 3: 'Střední', 4: 'Vysoká', 5: 'Velmi vysoká' })[score] ?? 'Bez hodnocení';
}

function matchesComplexity(project, value) {
  if (!value || value === 'all') return true;
  const score = number(project.complexity?.score);
  if (score === null) return value === 'unknown';
  if (value === 'high') return score >= 4;
  if (value === 'medium') return score === 3;
  if (value === 'low') return score <= 2;
  if (/^[1-5]\+$/.test(String(value))) return score >= Number(String(value)[0]);
  return score === Number(value);
}

export function filterProjects(projects, { query = '', category = 'all', complexity = 'all', status = 'all', sort = 'priority' } = {}) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const result = (projects ?? []).filter(project => {
    if (category !== 'all' && project.category !== category) return false;
    if (status !== 'all' && project.status !== status) return false;
    if (!matchesComplexity(project, complexity)) return false;
    const text = normalize([project.id, project.name, project.folder, project.kind, project.summary, project.description, ...(project.stack ?? []), ...(project.features ?? []).flatMap(f => [f.name, f.description]), ...(project.subprojects ?? []).map(s => s.name)].join(' '));
    return terms.every(term => text.includes(term));
  });
  const score = project => number(project.complexity?.score) ?? -1;
  const byName = (a, b) => collator.compare(a.name ?? a.folder, b.name ?? b.folder);
  const metric = (p, key) => number(p.metrics?.[key]?.value) ?? -1;
  result.sort((a, b) => {
    if (sort === 'name' || sort === 'alphabetical') return byName(a, b);
    if (sort === 'features') return (b.features?.length ?? 0) - (a.features?.length ?? 0) || byName(a, b);
    if (sort === 'source' || sort === 'size') return (b.sourceFiles ?? 0) - (a.sourceFiles ?? 0) || byName(a, b);
    if (sort === 'search') return (number(b.searchConsole?.current?.clicks) ?? -1) - (number(a.searchConsole?.current?.clicks) ?? -1) || byName(a, b);
    if (sort === 'traffic') return collator.compare(a.metrics?.visitors?.metric ?? 'zz', b.metrics?.visitors?.metric ?? 'zz') || metric(b, 'visitors') - metric(a, 'visitors') || byName(a, b);
    if (sort === 'revenue') return collator.compare(a.metrics?.revenue?.currency ?? 'zz', b.metrics?.revenue?.currency ?? 'zz') || metric(b, 'revenue') - metric(a, 'revenue') || byName(a, b);
    return score(b) - score(a) || byName(a, b);
  });
  return result;
}

function aggregate(metrics, keyOf) {
  const groups = new Map();
  for (const { project, metric } of metrics) {
    const value = number(metric?.value);
    if (value === null) continue;
    const completePeriod = Boolean(metric.periodStart && metric.periodEnd);
    const key = `${keyOf(metric)}|${metric.periodStart ?? ''}|${metric.periodEnd ?? ''}|${completePeriod ? '' : project.id}`;
    const previous = groups.get(key);
    if (previous) { previous.value += value; previous.projectCount += 1; }
    else groups.set(key, { metric: metric.metric, currency: metric.currency, value, periodStart: metric.periodStart ?? null, periodEnd: metric.periodEnd ?? null, projectCount: 1 });
  }
  return [...groups.values()];
}

export function portfolioStats(projects = []) {
  const traffic = projects.filter(p => number(p.metrics?.visitors?.value) !== null).map(project => ({ project, metric: project.metrics.visitors }));
  const revenue = projects.filter(p => number(p.metrics?.revenue?.value) !== null && /^[A-Z]{3}$/.test(p.metrics?.revenue?.currency ?? '')).map(project => ({ project, metric: project.metrics.revenue }));
  const trafficGroups = aggregate(traffic, m => m.metric ?? 'unknown');
  const currencyTotals = aggregate(revenue, m => m.currency ?? 'unknown').map(({ currency, value, periodStart, periodEnd, projectCount }) => ({ currency, value, periodStart, periodEnd, projectCount }));
  const comparableTotal = names => {
    const groups = trafficGroups.filter(g => names.includes(g.metric));
    return groups.length === 1 && groups[0].periodStart && groups[0].periodEnd ? groups[0].value : null;
  };
  const scores = projects.filter(p => p.status !== 'empty').map(p => number(p.complexity?.score)).filter(n => n !== null);
  const searchGroups = searchSummary(projects);
  const singleSearch = searchGroups.length === 1 ? searchGroups[0] : null;
  return {
    total: projects.length,
    featureCount: projects.reduce((n, p) => n + (p.features?.length ?? 0), 0),
    sourceFiles: projects.reduce((n, p) => n + (number(p.sourceFiles) ?? 0), 0),
    averageComplexity: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    trafficTracked: traffic.length,
    revenueTracked: revenue.length,
    searchTracked: projects.filter(p => number(p.searchConsole?.current?.clicks) !== null).length,
    searchClicks: singleSearch?.clicks ?? null,
    searchImpressions: singleSearch?.impressions ?? null,
    searchGrowth: singleSearch?.clicksPercent ?? null,
    searchGroups,
    knownSessions: comparableTotal(['sessions']),
    knownUsers: comparableTotal(['users', 'unique_users', 'totalUsers']),
    currencyTotals,
    trafficGroups
  };
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
