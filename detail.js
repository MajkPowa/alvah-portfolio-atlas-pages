import { esc, formatNumber, formatMoney, formatDate, periodLabel, complexityLabel, trafficLabel } from './model.js';
import {renderSearchCard,hasSearchData,searchGrowthMarkup} from './search-console.js';

const list = value => Array.isArray(value) ? value : [];
const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value));
const known = metric => Boolean(metric && metric.value !== null && metric.value !== undefined && numeric(metric.value));
const period = metric => metric?.periodLabel || periodLabel(metric);
const featureStates = { implemented: ['implemented', 'V kódu'], documented: ['documented', 'Dokumentováno'], uncertain: ['uncertain', 'Neověřeno'] };

function httpUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function coverUrl(value) {
  const source = typeof value === 'object' ? value?.src ?? value?.url : value;
  if (httpUrl(source)) return httpUrl(source);
  return typeof source === 'string' && /^(?:\.?\/)?(?:assets|covers)\/[\w./-]+$/u.test(source) && !source.includes('..') ? source : null;
}

function external(url, label) {
  const safe = httpUrl(typeof url === 'object' ? url?.url ?? url?.href : url);
  return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>` : '';
}

function sourceText(source) {
  if (!source) return '';
  if (typeof source === 'string') return source;
  const path = source.path ?? source.url ?? source.source ?? source.label ?? '';
  const line = Number.isInteger(Number(source.line)) && Number(source.line) > 0 ? `:${source.line}` : '';
  return `${path}${line}`;
}

function sourceMarkup(source) {
  const text = sourceText(source);
  const url = httpUrl(text);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>` : `<code class="source-path">${esc(text || 'Zdroj neuveden')}</code>`;
}

function note(text) {
  const translations = {
    'Application paid status is not a bank statement, provider settlement or proof of net profit.': 'Stav „zaplaceno“ v aplikaci není výpis z banky, vyúčtování poskytovatele plateb ani důkaz čistého zisku.',
    'Provider production/sandbox environment is not consistently stored per document; unknown test records cannot be excluded conclusively.': 'Produkční nebo testovací prostředí poskytovatele není u záznamů jednotně uložené. Neoznačené testovací platby nelze spolehlivě vyloučit.',
    'No visitor or session figure inferred from transactions.': 'Počty transakcí nejsou použité jako návštěvníci ani relace webu.',
    'Gross amounts are kept per explicit currency; no FX conversion or cross-currency sum.': 'Částky zůstávají v doložené měně. Různé měny se nesčítají ani nepřepočítávají odhadovaným kurzem.',
    'Source finance_mark_paid is a staff action; invoice type may be proforma. This is operational payment marking, not independently reconciled revenue.': 'Označení úhrady HAJR provádí obsluha a doklad může být zálohový. Jde o provozní evidenci, nikoliv nezávisle odsouhlasené tržby.',
    'GoPay PAID transition validates amount/currency in source, but current provider environment and settlements were not queried; pickup orders without paid status are excluded.': 'Kód přechodu GoPay PAID kontroluje částku a měnu. Prostředí poskytovatele ani skutečné vypořádání nebylo ověřeno; neuhrazené osobní odběry jsou vyloučené.',
    'Some eligible paid records have no unambiguous paidAt; period amounts therefore have incomplete date coverage.': 'Část označených úhrad nemá jednoznačné datum paidAt, proto součty za období nemají úplné časové pokrytí.'
  };
  const value = String(text ?? '');
  if (translations[value]) return translations[value];
  const match = /^(\d+) app-marked paid records were excluded for missing\/unsupported currency;/.exec(value);
  if (match) return `${match[1]} záznamů označených jako uhrazené bylo vyloučeno kvůli chybějící nebo nepodporované měně. Zobrazený součet pokrývá jen záznamy s doloženou měnou a není celkovým příjmem webu.`;
  return value;
}

function percent(value, unit = '%') {
  if (!numeric(value)) return 'Nezjištěno';
  return `${Number(value) > 0 ? '+' : ''}${formatNumber(value, 2)}${unit === '%' ? ' %' : ` ${unit || ''}`}`;
}

function metricValue(metric, mode) {
  if (!known(metric)) return 'Nezjištěno';
  if (mode === 'money') return /^[A-Z]{3}$/u.test(metric.currency ?? '') ? formatMoney(metric.value, metric.currency) : `${formatNumber(metric.value, 2)} · měna neuvedena`;
  if (mode === 'growth') return percent(metric.value, metric.unit ?? '%');
  return formatNumber(metric.value, 2);
}

function metricBlock(label, metric, mode) {
  return `<div class="detail-kpi"><span class="metric-label">${esc(label)}</span><strong>${esc(metricValue(metric, mode))}</strong><span class="period">${esc(known(metric) ? period(metric) : 'Chybí ověřený údaj za vymezené období')}</span>${known(metric) && metric.source ? `<small class="source-path">${sourceMarkup(metric.source)}</small>` : ''}${known(metric) && (metric.note || metric.caveat || metric.basis) ? `<p class="source-note">${esc(note(metric.note || metric.caveat || metric.basis))}</p>` : ''}</div>`;
}

function featureMarkup(feature) {
  const f = typeof feature === 'string' ? { name: feature } : feature ?? {};
  const [state, label] = featureStates[f.implementation] ?? featureStates.uncertain;
  return `<article class="feature-item"><h4>${esc(f.name ?? f.title ?? 'Funkční oblast')} <span class="implementation ${state}">${label}</span></h4>${f.description ? `<p>${esc(f.description)}</p>` : ''}${f.evidence ? `<div class="source-path">${sourceMarkup(f.evidence)}</div>` : ''}</article>`;
}

function estimateMarkup(value, title) {
  const score = numeric(value?.score) && Number(value.score) >= 1 && Number(value.score) <= 5 ? Number(value.score) : null;
  const reasons = list(value?.reasons);
  return `<div class="complexity-detail"><div class="complexity-number" aria-label="${esc(score === null ? 'Bez hodnocení' : `${score} z pěti`)}">${score === null ? '—' : `${esc(score)}<small>/5</small>`}</div><div><h3>${esc(title)} · ${esc(complexityLabel(score))}</h3>${reasons.length ? `<ul>${reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : '<p class="muted">Ve zdrojích není dostatek podkladů pro poctivý odhad.</p>'}</div></div>`;
}

function operationalMarkup(income) {
  if (!income) return '<p>Provozní evidence úhrad nebyla pro tento projekt ověřena.</p>';
  const currencies = list(income.byCurrency);
  const missingCurrency = Number(income.exclusions?.missingOrUnsupportedCurrency) || 0;
  const missingDate = Number(income.qualityFlags?.eligiblePaidRecordsMissingUsablePaidAt) || 0;
  const missingDateWithCurrency = Number(income.qualityFlags?.paidRecordsExcludedForCurrencyWithoutUsablePaidAt) || 0;
  const partial = income.monetaryCoverageComplete === false || missingCurrency > 0 || missingDate > 0;
  return `<div class="evidence-banner"><strong>${partial ? 'Částečný provozní agregát' : 'Provozní evidence označených úhrad'}</strong><p>Odděleno od ověřených tržeb. Jde o částky u záznamů, které aplikace označuje jako zaplacené, nikoliv o bankovně odsouhlasené příjmy nebo čistý zisk.</p>${missingCurrency ? `<p><strong>${esc(formatNumber(missingCurrency))} označených úhrad je mimo peněžní součet</strong> kvůli chybějící nebo nepodporované měně.${missingDateWithCurrency ? ` U ${esc(formatNumber(missingDateWithCurrency))} z nich navíc není použitelné datum úhrady.` : ''} Údaj proto nepředstavuje celkový výdělek webu.</p>` : ''}${missingDate ? `<p>${esc(formatNumber(missingDate))} dalších záznamů nelze jednoznačně přiřadit k období.</p>` : ''}${income.unknownTestOrProviderEnvironmentVerified === false ? '<p>Neoznačené testovací záznamy nebo sandboxové prostředí nebylo možné s jistotou vyloučit.</p>' : ''}</div>
    ${currencies.length ? currencies.map(currency => `<article class="income-card"><span class="eyebrow">${esc(currency.currency)} · provozní součet</span><div class="income-amount">${esc(formatMoney(currency.value, currency.currency))}</div><p class="income-note">${esc(period(income))} · ${esc(formatNumber(currency.recordCount))} označených úhrad</p><table class="signal-table"><tbody><tr><td>Předchozí období<small>${esc(period({ periodStart: income.previousPeriodStart, periodEnd: income.previousPeriodEnd }))}</small></td><td>${esc(formatMoney(currency.previousValue, currency.currency))}<small>${esc(formatNumber(currency.previousRecordCount))} úhrad</small></td></tr><tr><td>Změna tohoto agregátu<small>Nejde o růst návštěvnosti ani čistého zisku.</small></td><td>${esc(currency.changePercent === null || currency.changePercent === undefined ? 'Nelze vypočítat' : percent(currency.changePercent))}</td></tr><tr><td>Všechny způsobilé uložené záznamy<small>Historický rozsah databáze, nikoliv celé podnikání.</small></td><td>${esc(formatMoney(currency.allTimeEligibleAmount, currency.currency))}<small>${esc(formatNumber(currency.allTimeEligibleRecordCount))} úhrad</small></td></tr></tbody></table></article>`).join('') : '<p>Pro vymezené období není k dispozici srovnatelný peněžní agregát v doložené měně.</p>'}
    <p class="source-note">Časové zařazení: datum úhrady <code>paidAt</code>. Hrubé částky mohou zahrnovat DPH a dopravu; náklady ani vypořádání poskytovatele nejsou odečtené. Zdroj: ${sourceMarkup(income.source)}.</p>`;
}

function signalMarkup(signals) {
  if (!signals.length) return '<p>Další datované výkonové signály nejsou doložené.</p>';
  const labels = { 'Collection documents': 'Dokumenty v datové kolekci', 'Eligible app-marked paid records, all time': 'Způsobilé provozně označené úhrady — celá databáze', 'Payment records missing usable paid date': 'Způsobilé záznamy bez použitelného data úhrady' };
  return `<table class="signal-table"><caption class="sr-only">Podpůrné signály s obdobím a zdrojem</caption><tbody>${signals.map(signal => {
    const unit = signal.unit === 'records' ? 'záznamů' : signal.unit ?? '';
    const value = numeric(signal.value) ? /^[A-Z]{3}$/u.test(unit) ? formatMoney(signal.value, unit) : `${formatNumber(signal.value, 2)} ${unit}` : 'Nezjištěno';
    return `<tr><td>${esc(labels[signal.label] ?? signal.label ?? 'Podpůrný signál')}<small>${esc(period(signal))}</small>${signal.note || signal.caveat ? `<small>${esc(note(signal.note || signal.caveat))}</small>` : ''}<small>Zdroj: ${sourceMarkup(signal.source)}</small></td><td>${esc(value)}</td></tr>`;
  }).join('')}</tbody></table><p class="source-note">Reklamní atribuce, kliknutí ve vyhledávání, databázové záznamy a zobrazení stránek jsou různé veličiny. Nepřevádíme je na unikátní návštěvníky ani je nesčítáme do tržeb.</p>`;
}

function sourcesFor(project) {
  const candidates = [...list(project.sources), ...list(project.evidence), ...list(project.profile?.evidence), ...list(project.features).map(f => f?.evidence), ...list(project.signals).map(s => s?.source), project.searchConsole?.source, project.metrics?.visitors?.source, project.metrics?.revenue?.source, project.metrics?.growth?.source, project.operationalIncome?.source].filter(Boolean);
  return [...new Map(candidates.map(source => [sourceText(source), source])).values()];
}

function profileEvidence(value){
  const items=Array.isArray(value)?value:value?[value]:[];
  return items.length?`<p class="source-path">${items.map(sourceMarkup).join(' · ')}</p>`:'';
}

function profileMarkup(p){
  const f=p.profile;
  if(!f)return '';
  const roles=list(f.roles),workflows=list(f.workflows),modules=list(f.modules),integrations=list(f.integrations);
  const bullet=value=>typeof value==='string'?value:value?.description??value?.purpose??value?.name??'';
  return `<section class="detail-section" id="detail-use"><span class="eyebrow">02 / Produkt do hloubky</span><h2>Pro koho a jak funguje</h2>${f.overview?`<p>${esc(f.overview)}</p>`:''}${list(f.audience).length?`<div class="profile-audience">${list(f.audience).map(a=>`<span>${esc(bullet(a))}</span>`).join('')}</div>`:''}${roles.length?`<h3>Role a oprávnění</h3><div class="profile-roles">${roles.map(r=>`<article class="profile-role"><h4>${esc(r.name)}</h4>${Array.isArray(r.capabilities)?`<ul>${r.capabilities.map(c=>`<li>${esc(bullet(c))}</li>`).join('')}</ul>`:`<p>${esc(r.capabilities??r.description??'')}</p>`}${profileEvidence(r.evidence)}</article>`).join('')}</div>`:''}${workflows.length?`<h3 style="margin-top:27px">Hlavní uživatelské postupy</h3>${workflows.map(w=>`<article class="profile-workflow"><h3>${esc(w.name)}</h3>${w.description?`<p>${esc(w.description)}</p>`:''}<ol>${list(w.steps).map(step=>`<li>${esc(bullet(step))}</li>`).join('')}</ol>${profileEvidence(w.evidence)}</article>`).join('')}`:''}</section><section class="detail-section" id="detail-modules"><span class="eyebrow">03 / Moduly a provoz</span><h2>Co tvoří celý systém</h2>${modules.length?`<div class="profile-modules">${modules.map(m=>`<article class="profile-module"><h4>${esc(m.name)}</h4><p>${esc(m.purpose??m.description??'')}</p>${profileEvidence(m.evidence)}</article>`).join('')}</div>`:''}${integrations.length?`<h3>Napojení a externí služby</h3><div class="profile-modules">${integrations.map(i=>`<article class="profile-module"><h4>${esc(i.name)}</h4><p>${esc(i.purpose??i.description??'')}</p>${profileEvidence(i.evidence)}</article>`).join('')}</div>`:'<p>Ve zkoumaném rozsahu nejsou další externí integrace doložené.</p>'}${list(f.operations).length?`<h3>Provoz a správa</h3><ul class="profile-list">${list(f.operations).map(o=>`<li>${esc(bullet(o))}${typeof o==='object'?profileEvidence(o.evidence):''}</li>`).join('')}</ul>`:''}${list(f.limitations).length?`<h3>Hranice ověření</h3><ul class="profile-list">${list(f.limitations).map(o=>`<li>${esc(bullet(o))}${typeof o==='object'?profileEvidence(o.evidence):''}</li>`).join('')}</ul>`:''}${profileEvidence(f.evidence)}</section>`;
}

export function renderProjectDetail(project, { selected = false } = {}) {
  const p = project ?? {};
  const features = list(p.features);
  const subprojects = list(p.subprojects);
  const sources = sourcesFor(p);
  const gaps = [...new Set(list(p.dataGaps).map(note).filter(Boolean))];
  const metrics = p.metrics ?? {};
  const cover = coverUrl(p.cover);
  const links = list(p.urls).map((url, index) => external(url, list(p.urls).length > 1 ? `Web projektu ${index + 1}` : 'Otevřít web projektu')).filter(Boolean).join('');
  const repository = external(p.repository, 'Zdrojový repozitář');
  const stateCounts = features.reduce((counts, feature) => { const key = featureStates[feature?.implementation] ? feature.implementation : 'uncertain'; counts[key] += 1; return counts; }, { implemented: 0, documented: 0, uncertain: 0 });
  return `<header class="dialog-head"><div class="dialog-breadcrumb"><span>ALVAH / PROJEKTY</span><span aria-hidden="true">/</span><span>${esc(p.categoryLabel ?? p.kind ?? 'Detail')}</span></div><div class="dialog-tools"><button type="button" class="small-button" data-copy-link="${esc(p.id)}">Kopírovat odkaz</button><button type="button" class="small-button" data-print>Tisk / PDF</button><button type="button" class="icon-button" data-close-dialog aria-label="Zavřít detail projektu">×</button></div></header>
    <div class="detail-layout"><aside class="detail-sidebar"><div class="detail-cover">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : ''}<span>${esc(p.name ?? p.folder ?? 'Projekt')}</span></div><span class="status-badge">${esc(p.statusLabel ?? 'Stav neuveden')}</span><h1 id="project-detail-title">${esc(p.name ?? p.folder ?? 'Projekt')}</h1><p class="muted">${esc(p.summary ?? '')}</p><nav class="detail-side-nav" aria-label="Sekce projektu"><a href="#detail-overview">Přehled</a><a href="#detail-use">Jak funguje</a><a href="#detail-modules">Moduly a provoz</a><a href="#detail-features">Všechny funkce</a><a href="#detail-architecture">Technologie</a><a href="#detail-performance">Výkon</a><a href="#detail-sources">Zdroje</a></nav><button type="button" class="secondary-button" data-compare="${esc(p.id)}" aria-pressed="${selected ? 'true' : 'false'}">${selected ? 'Odebrat ze srovnání' : 'Přidat ke srovnání'} <span aria-hidden="true">${selected ? '−' : '+'}</span></button><div class="side-stat"><small>Zdrojové soubory</small><strong>${esc(formatNumber(p.sourceFiles))}</strong></div><div class="side-stat"><small>Funkční oblasti</small><strong>${esc(formatNumber(features.length))}</strong></div>${links || repository ? `<div class="detail-external">${links}${repository}</div><p class="source-note">Dostupnost webu a existence GitHub repozitáře ověřena ${esc(formatDate(p.availability?.checkedAt))}. Kontrola neověřuje všechny interní procesy aplikace.</p>` : ''}</aside>
    <div class="detail-content"><section class="detail-section" id="detail-overview"><span class="eyebrow">01 / Kontext</span><h2>Co projekt dělá</h2><p>${esc(p.description ?? p.summary ?? 'Ve složce nebyla nalezena dokumentace umožňující poctivý popis projektu.')}</p>${p.businessModel ? `<p><strong>Obchodní kontext:</strong> ${esc(p.businessModel)}</p>` : ''}<p class="source-note">Složka: <code>${esc(p.folder ?? 'Neuvedena')}</code>${p.auditedAt ? ` · Audit ${esc(formatDate(p.auditedAt))}` : ''}. Zobrazený projekt má ověřený dostupný web a odpovídající GitHub repozitář. Stav implementace a skutečné napojení všech integrací jsou posouzené samostatně.</p>${subprojects.length ? `<h3>Části projektu</h3><div class="feature-grid">${subprojects.map(sub => `<article class="feature-item"><h4>${esc(sub.name ?? 'Podprojekt')}</h4><p>${esc(sub.purpose ?? sub.description ?? '')}</p>${sub.path ? `<code class="source-path">${esc(sub.path)}</code>` : ''}</article>`).join('')}</div>` : ''}${list(p.relatedProjects).length ? `<p class="source-note">Související složky nebo varianty: ${list(p.relatedProjects).map(related => esc(typeof related === 'object' ? related.name ?? related.id : related)).join(', ')}. Při hodnocení stejné značky či dat je nezapočítávat dvakrát.</p>` : ''}</section>
    ${profileMarkup(p)}<section class="detail-section" id="detail-features"><div class="detail-heading-row"><h2>Všechny funkční oblasti</h2><span>${esc(features.length)} oblastí</span></div><p class="source-note">${esc(stateCounts.implemented)} v kódu · ${esc(stateCounts.documented)} popsaných v dokumentaci · ${esc(stateCounts.uncertain)} neověřených. Existence modulu neznamená, že byl celý tok ověřen v produkci.</p>${features.length ? `<div class="feature-grid">${features.map(featureMarkup).join('')}</div>` : '<p>V dostupném obsahu nebyly doloženy konkrétní funkce.</p>'}</section>
    <section class="detail-section" id="detail-architecture"><span class="eyebrow">03 / Technologie a náročnost</span><h2>Jak je projekt postavený</h2>${list(p.stack).length ? `<div class="project-tech">${list(p.stack).map(tech => `<span class="tech-tag">${esc(tech)}</span>`).join('')}</div>` : '<p>Technologický základ nebyl doložen.</p>'}<p class="source-note">${esc(formatNumber(p.sourceFiles))} aktivních zdrojových souborů · ${esc(formatNumber(p.packageCount))} balíčkových manifestů. Počty nejsou pracovní hodiny ani měřítko obchodní hodnoty.</p>${estimateMarkup(p.complexity, 'Náročnost vývoje')}${estimateMarkup(p.maintenance, 'Náročnost údržby')}<p class="source-note">Relativní odborný odhad podle rozsahu kódu, integrací a provozních vazeb. Nejde o časový výkaz, rozpočet realizace ani procento dokončení.</p></section>
    <section class="detail-section" id="detail-performance"><span class="eyebrow">04 / Výkon a datové pokrytí</span><h2>Návštěvnost a výdělky</h2>${renderSearchCard(p,{detail:true})}<div class="detail-kpis">${metricBlock(known(metrics.visitors) ? trafficLabel(metrics.visitors) : 'Návštěvnost', metrics.visitors)}${metricBlock('Ověřené tržby', metrics.revenue, 'money')}</div><p><strong>${esc(metrics.growth?.label ?? 'Růst dle zdroje')}:</strong> ${esc(metricValue(metrics.growth, 'growth'))}${known(metrics.growth) ? ` · ${esc(period(metrics.growth))}` : ' — pro porovnání chybí dvě srovnatelná období stejné metriky.'}</p>${known(metrics.growth) && metrics.growth.source ? `<p class="source-note">Zdroj růstu: ${sourceMarkup(metrics.growth.source)}.</p>` : ''}<h3>Provozní evidence úhrad</h3>${operationalMarkup(p.operationalIncome)}<h3>Další doložené signály</h3>${signalMarkup(list(p.signals ?? p.additionalMetrics))}</section>
    <section class="detail-section" id="detail-sources"><span class="eyebrow">05 / Podklady a nejistoty</span><h2>Co víme a co chybí</h2>${gaps.length ? `<ul class="gaps-list">${gaps.map(gap => `<li>${esc(gap)}</li>`).join('')}</ul>` : '<p>V podkladech nejsou další výslovně uvedené mezery; to samo neznamená úplné datové pokrytí.</p>'}<details class="source-record"${sources.length <= 5 ? ' open' : ''}><summary>Zdrojové podklady · ${esc(formatNumber(sources.length))}</summary>${sources.length ? `<ol class="gaps-list">${sources.map(source => `<li>${sourceMarkup(source)}</li>`).join('')}</ol>` : '<p class="source-note">Zdrojové podklady nejsou dostupné.</p>'}</details></section></div></div>`;
}

function compactOperational(income) {
  if (!income) return 'Nezjištěno';
  const currencies = list(income.byCurrency);
  return `${currencies.length ? currencies.map(c => `<strong>${esc(formatMoney(c.value, c.currency))}</strong> · ${esc(formatNumber(c.recordCount))} úhrad`).join('<br>') : 'Bez srovnatelného součtu'}<br><small class="period">${esc(period(income))}</small><p>${income.monetaryCoverageComplete === false ? 'Částečný agregát. ' : ''}Stav zaplaceno v aplikaci; není ověřený bankovní příjem ani čistý zisk.</p>`;
}

export function renderComparison(projects) {
  const items = list(projects).slice(0, 3);
  const row = (title, render) => `<tr><td>${esc(title)}</td>${items.map(p => `<td>${render(p)}</td>`).join('')}</tr>`;
  const metric = (p, key, mode) => `${esc(metricValue(p.metrics?.[key], mode))}${known(p.metrics?.[key]) ? `<br><small class="period">${esc(period(p.metrics[key]))}</small>${p.metrics[key].source ? `<br><small class="source-path">${sourceMarkup(p.metrics[key].source)}</small>` : ''}${p.metrics[key].note || p.metrics[key].caveat || p.metrics[key].basis ? `<p>${esc(note(p.metrics[key].note || p.metrics[key].caveat || p.metrics[key].basis))}</p>` : ''}` : ''}`;
  return `<header class="dialog-head"><div class="dialog-breadcrumb">ALVAH / SROVNÁNÍ</div><div class="dialog-tools"><button type="button" class="small-button" data-print>Tisk / PDF</button><button type="button" class="icon-button" data-close-dialog aria-label="Zavřít srovnání">×</button></div></header><div class="compare-content"><h2 id="comparison-title">Vedle sebe, bez odhadovaných výsledků.</h2><p>Nejvýše tři projekty. Technická náročnost je odborný odhad; neověřené návštěvy a tržby zůstávají označené. Provozní úhrady se nesčítají s ověřenými příjmy.</p>${items.length ? `<table class="comparison-table"><caption class="sr-only">Srovnání vybraných projektů</caption><thead><tr><th scope="col">Projekt</th>${items.map(p => `<th scope="col">${esc(p.name ?? p.folder)}<br><button type="button" class="small-button" data-compare="${esc(p.id)}" aria-label="Odebrat ${esc(p.name ?? p.folder)} ze srovnání">Odebrat</button></th>`).join('')}</tr></thead><tbody>${row('Co dělá', p => `<strong>${esc(p.summary ?? '')}</strong><p>${esc(p.description ?? '')}</p>`)}${row('Stav zdrojů', p => esc(p.statusLabel ?? 'Neuvedeno'))}${row('Funkce', p => list(p.features).length ? `<ul>${list(p.features).map(f => `<li><strong>${esc(f.name ?? f.title ?? f)}</strong>${f.description ? ` — ${esc(f.description)}` : ''}${f.implementation !== 'implemented' ? ` <span class="implementation ${f.implementation === 'documented' ? 'documented' : 'uncertain'}">${f.implementation === 'documented' ? 'Dokumentováno' : 'Neověřeno'}</span>` : ''}</li>`).join('')}</ul>` : 'Funkce nedoloženy')}${row('Části projektu', p => list(p.subprojects).length ? `<ul>${list(p.subprojects).map(s => `<li><strong>${esc(s.name)}</strong>${s.purpose ? ` — ${esc(s.purpose)}` : ''}</li>`).join('')}</ul>` : 'Samostatná složka / bez doložených podčástí')}${row('Technologie', p => list(p.stack).map(esc).join(', ') || 'Nedoloženo')}${row('Vývoj · odhad', p => `${esc(complexityLabel(p.complexity?.score))}${numeric(p.complexity?.score) ? ` · ${esc(p.complexity.score)}/5` : ''}<ul>${list(p.complexity?.reasons).map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>`)}${row('Údržba · odhad', p => `${esc(complexityLabel(p.maintenance?.score))}${numeric(p.maintenance?.score) ? ` · ${esc(p.maintenance.score)}/5` : ''}<ul>${list(p.maintenance?.reasons).map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>`)}${row('Google Search Console', p => hasSearchData(p)?`${esc(formatNumber(p.searchConsole.current.clicks))} kliknutí · ${esc(formatNumber(p.searchConsole.current.impressions))} zobrazení<br><small>${esc(periodLabel(p.searchConsole))}</small><br>${searchGrowthMarkup(p.searchConsole)}`:'Chybí dostupný výkaz')}${row('Návštěvnost', p => `${known(p.metrics?.visitors) ? `<small>${esc(trafficLabel(p.metrics.visitors))}</small><br>` : ''}${metric(p, 'visitors')}`)}${row('Růst dle zdroje', p => metric(p, 'growth', 'growth'))}${row('Ověřené tržby', p => metric(p, 'revenue', 'money'))}${row('Provozní úhrady zvlášť', p => compactOperational(p.operationalIncome))}${row('Podpůrné signály', p => list(p.signals).length ? `<ul>${list(p.signals).map(s => `<li>${esc(s.label)}: ${esc(numeric(s.value) ? formatNumber(s.value, 2) : 'Nezjištěno')} ${esc(s.unit ?? '')}<br><small>${esc(period(s))}</small>${s.note ? `<br><small>${esc(note(s.note))}</small>` : ''}</li>`).join('')}</ul>` : 'Nejsou doložené')}${row('Mezery v datech', p => `<ul>${list(p.dataGaps).map(gap => `<li>${esc(note(gap))}</li>`).join('')}</ul>`)}</tbody></table>` : '<p>Pro srovnání nejprve vyberte alespoň jeden projekt.</p>'}</div>`;
}
