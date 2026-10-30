import {esc,formatNumber,formatDate,periodLabel} from './model.js';

const numeric=value=>typeof value==='number'&&Number.isFinite(value);
export const hasSearchData=p=>numeric(p?.searchConsole?.current?.clicks)&&numeric(p?.searchConsole?.current?.impressions);
const signed=(value,digits=1,suffix=' %')=>numeric(value)?`${value>0?'+':''}${formatNumber(value,digits)}${suffix}`:'Nelze vypočítat';
const safeLink=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};

export function searchGrowthMarkup(search){
  const value=search?.growth?.clicksPercent;
  if(numeric(value))return `<span class="delta ${value<0?'negative':''}">${esc(signed(value))}</span>`;
  if(search?.previous?.clicks===0)return '<span class="search-unavailable">Předchozí období má 0 kliknutí</span>';
  return '<span class="search-unavailable">Chybí srovnatelné období</span>';
}

function dailyChart(search){
  const rows=(search.daily??[]).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&numeric(row.clicks)&&row.date>=search.periodStart&&row.date<=search.periodEnd).sort((a,b)=>a.date.localeCompare(b.date));
  if(rows.length<2)return '<p class="search-chart-empty">Denní průběh není v dostupném výkazu.</p>';
  const max=Math.max(1,...rows.map(r=>r.clicks));
  const coords=rows.map((r,i)=>`${16+i/(rows.length-1)*568},${116-r.clicks/max*96}`);
  const accessible=rows.map(r=>`${formatDate(r.date)}: ${formatNumber(r.clicks)} kliknutí`).join('; ');
  return `<figure class="search-chart"><figcaption>Denní kliknutí z Googlu <span>${formatNumber(max)} / den</span></figcaption><svg viewBox="0 0 600 134" role="img" aria-label="${esc(accessible)}"><path d="M16 116H584M16 68H584M16 20H584" stroke="currentColor" opacity=".13" fill="none"/><path d="M${coords[0]} L${coords.slice(1).join(' L')} L584 116 L16 116 Z" fill="currentColor" opacity=".08"/><polyline points="${coords.join(' ')}" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" fill="none"/></svg><div class="search-chart-dates"><span>${formatDate(rows[0].date)}</span><span>${formatDate(rows.at(-1).date)}</span></div><details class="search-daily"><summary>Denní hodnoty v tabulce</summary><div class="table-wrap"><table class="signal-table"><thead><tr><th>Datum</th><th>Kliknutí</th><th>Zobrazení</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${formatDate(r.date)}</td><td>${formatNumber(r.clicks)}</td><td>${numeric(r.impressions)?formatNumber(r.impressions):'—'}</td></tr>`).join('')}</tbody></table></div></details></figure>`;
}

function additionalProperties(search){
  const rows=(search.additionalProperties??[]).filter(s=>numeric(s.current?.clicks)&&numeric(s.current?.impressions));
  if(!rows.length)return '';
  return `<div class="search-secondary"><h4>Další služba nebo varianta domény</h4><p class="source-note">Doplňkovou službu nepřičítáme k hlavní doméně ani k souhrnu portfolia.</p>${rows.map(s=>`<div><strong>${esc(s.property??s.label??'Další služba')}</strong><span class="period">${esc(periodLabel(s))}</span><table class="signal-table"><tbody><tr><td>Kliknutí z Googlu${numeric(s.previous?.clicks)?`<small>Dříve ${formatNumber(s.previous.clicks)}</small>`:''}</td><td>${formatNumber(s.current.clicks)}</td></tr><tr><td>Zobrazení</td><td>${formatNumber(s.current.impressions)}</td></tr><tr><td>Růst kliknutí</td><td>${searchGrowthMarkup(s)}</td></tr><tr><td>CTR / průměrná pozice</td><td>${numeric(s.current.ctr)?`${formatNumber(s.current.ctr*100,2)} %`:'—'} / ${numeric(s.current.position)?formatNumber(s.current.position,1):'—'}</td></tr></tbody></table>${s.note?`<p class="source-note">${esc(s.note)}</p>`:''}</div>`).join('')}</div>`;
}

export function renderSearchCard(project,{detail=false}={}){
  const s=project?.searchConsole;
  const title=detail?'Google Search Console':project.name;
  if(!hasSearchData(project))return `<article class="search-card search-missing"><div class="search-card-head"><div><p class="eyebrow">GOOGLE / ORGANICKÉ VYHLEDÁVÁNÍ</p><h3>${esc(title)}</h3></div>${!detail?`<button class="small-button" data-open="${esc(project.id)}">Detail ↗</button>`:''}</div><p>Statistiky Search Console nejsou pro tento projekt dostupné.</p><p class="source-note">${esc(s?.note||'Chybí dostupný výkaz nebo oprávnění k odpovídající službě. To neznamená nulovou návštěvnost.')}</p></article>`;
  const c=s.current,prev=s.previous;
  const ctr=numeric(c.ctr)?`${formatNumber(c.ctr*100,2)} %`:'—';
  const pos=numeric(c.position)?formatNumber(c.position,1):'—';
  const prop=safeLink(s.property);
  return `<article class="search-card"><div class="search-card-head"><div><p class="eyebrow">GOOGLE / ${s.isHistorical?'DATOVANÝ VÝKAZ':'SEARCH CONSOLE'}</p><h3>${esc(title)}</h3></div>${!detail?`<button class="small-button" data-open="${esc(project.id)}">Detail ↗</button>`:''}</div><p class="search-period">${esc(periodLabel(s))}${s.property?` · ${prop?`<a href="${esc(prop)}" target="_blank" rel="noopener noreferrer">${esc(s.property)}</a>`:esc(s.property)}`:''}</p><div class="search-kpis"><div><span>Kliknutí z Googlu</span><strong>${formatNumber(c.clicks)}</strong><small>${prev&&numeric(prev.clicks)?`Dříve ${formatNumber(prev.clicks)}`:'Bez srovnání'}</small></div><div><span>Zobrazení ve vyhledávání</span><strong>${formatNumber(c.impressions)}</strong><small>${prev&&numeric(prev.impressions)?`Dříve ${formatNumber(prev.impressions)}`:'Bez srovnání'}</small></div><div><span>Průměrné CTR</span><strong>${ctr}</strong><small>${numeric(s.growth?.ctrPoints)?`${signed(s.growth.ctrPoints,2,' p. b.')} oproti dřívějšku`:'Podíl kliknutí ze zobrazení'}</small></div><div><span>Průměrná pozice</span><strong>${pos}</strong><small>${numeric(s.growth?.positionDelta)?`${signed(s.growth.positionDelta,1,'')} · nižší je lepší`:'Nižší číslo je lepší'}</small></div></div><div class="search-comparison">${searchGrowthMarkup(s)}<span>změna kliknutí${s.previousPeriodStart&&s.previousPeriodEnd?` · proti ${esc(periodLabel({periodStart:s.previousPeriodStart,periodEnd:s.previousPeriodEnd}))}`:''}</span></div>${dailyChart(s)}${additionalProperties(s)}<p class="source-note">${esc(s.note||'Kliknutí z výsledků Google nejsou počet návštěvníků ani celková návštěvnost webu.')} ${s.isHistorical?'Jde o uložený historický výkaz, ne živé napojení.':''}</p>${s.source?`<p class="source-path">Zdroj: ${esc(typeof s.source==='string'?s.source:s.source.path||s.source.url||'Google Search Console')}</p>`:''}</article>`;
}

export function renderSearchOverview(projects,stats){
  const measured=projects.filter(hasSearchData);
  const count=measured.length;
  const groups=stats.searchGroups??[];
  const one=groups.length===1?groups[0]:null;
  const period=one?periodLabel(one):'Jednotlivé weby mají vlastní období';
  return `<section class="search-overview" aria-labelledby="search-title"><div class="subsection-heading"><div><p class="eyebrow">ORGANICKÁ NÁVŠTĚVNOST / GOOGLE</p><h2 id="search-title">Jak weby rostou ve vyhledávání.</h2></div><p>${count} z ${projects.length} projektů má doložené údaje Search Console. Kliknutí a celková návštěvnost z analytiky jsou oddělené.</p></div><div class="metric-tiles search-summary"><article class="metric-tile dark"><p class="eyebrow">Kliknutí z Googlu</p><strong>${formatNumber(stats.searchClicks)}</strong><p>${esc(period)}${one?' · shodné období, bez duplicitních služeb':''}</p></article><article class="metric-tile"><p class="eyebrow">Zobrazení ve vyhledávání</p><strong>${formatNumber(stats.searchImpressions)}</strong><p>${one?'Součet webů se shodným obdobím.':'Součet se při různých obdobích neuvádí.'}</p></article><article class="metric-tile"><p class="eyebrow">Změna kliknutí</p><strong class="search-growth-total">${numeric(stats.searchGrowth)?esc(signed(stats.searchGrowth)):'—'}</strong><p>Srovnání dvou stejně dlouhých období. Při chybějícím základu změnu neodhadujeme.</p></article><article class="metric-tile"><p class="eyebrow">Datové pokrytí</p><strong>${count}<small>/ ${projects.length}</small></strong><p>Aktuální i historické výkazy jsou označené přímo u projektu.</p></article></div><div class="evidence-banner"><span class="signal-icon">i</span><div><strong>GSC měří příchody z vyhledávání Google.</strong> Kliknutí nejsou unikátní lidé. CTR je podíl kliknutí a zobrazení; u průměrné pozice je nižší číslo lepší. Růst porovnává stejnou metriku u stejné služby.<small>Data mají vlastní datum a časové pásmo Search Console. Prázdný údaj znamená nedostupná data, nikoli nulu.</small></div></div><div class="search-card-grid">${measured.map(p=>renderSearchCard(p)).join('')}</div>${projects.some(p=>!hasSearchData(p))?`<details class="search-gaps"><summary>Bez dostupných statistik Search Console · ${projects.length-count} projektů</summary><div class="search-gap-list">${projects.filter(p=>!hasSearchData(p)).map(p=>`<div><button class="text-link" data-open="${esc(p.id)}">${esc(p.name)} ↗</button><span>${esc(p.searchConsole?.note||'Chybí dostupný výkaz nebo přístup k odpovídající službě.')}</span></div>`).join('')}</div></details>`:''}<div class="export-row"><p>Export obsahuje pouze nyní zařazené online projekty s GitHubem.</p><button class="secondary-button" data-export="search">Export Search Console CSV ↗</button></div></section>`;
}
