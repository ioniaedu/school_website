const STORAGE = {
  users: 'northstar:users',
  session: 'northstar:session',
  firstRun: 'northstar:first-run-complete',
  data: (id) => `northstar:data:${id}`,
};

const CATEGORY_META = {
  groceries: { label: 'Groceries', icon: '⌁', color: '#2ba879', tone: 'green' },
  dining: { label: 'Dining out', icon: '◒', color: '#ffb593', tone: 'orange' },
  transport: { label: 'Transport', icon: '↗', color: '#89baff', tone: 'purple' },
  entertainment: { label: 'Entertainment', icon: '◉', color: '#b7a7ff', tone: 'purple' },
  utilities: { label: 'Utilities', icon: '⌂', color: '#d69b3e', tone: 'orange' },
  shopping: { label: 'Shopping', icon: '◇', color: '#f18f8f', tone: 'orange' },
  health: { label: 'Health', icon: '+', color: '#85e9d0', tone: 'green' },
  income: { label: 'Income', icon: '↑', color: '#2ba879', tone: 'green' },
  other: { label: 'Other', icon: '•', color: '#aab4bf', tone: '' },
};

const RISK_MODES = {
  all: { label: 'All signals', layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', layerLabel: 'MODIS true color' },
  flood: { label: 'Flood screening', layer: 'MODIS_Terra_CorrectedReflectance_Bands721', layerLabel: 'MODIS false color' },
  heat: { label: 'Heat-island screening', layer: 'MODIS_Terra_L3_Land_Surface_Temp_8Day_Day', layerLabel: 'MODIS land-surface temperature' },
  vegetation: { label: 'Vegetation change', layer: 'MODIS_Terra_L3_NDVI_16Day', layerLabel: 'MODIS NDVI' },
};

const RISK_DEFAULT_FORM = {
  query: 'Portland, Oregon',
  beforeDate: dateDaysAgo(30),
  afterDate: dateDaysAgo(7),
  mode: 'all',
};

const appState = {
  user: null,
  data: null,
  route: 'dashboard',
  authMode: 'login',
  insightIndex: 0,
  profileMenuOpen: false,
  risk: {
    status: 'idle',
    form: { ...RISK_DEFAULT_FORM },
    location: null,
    context: null,
    report: null,
    imageComparison: null,
    error: '',
    requestId: 0,
  },
};

let modalOpener = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function uid(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readStorage(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast('Storage is unavailable. Your latest change may not persist.', 'error');
    return false;
  }
}

function nowDate() {
  return new Date();
}

function toISO(date) {
  const safeDate = date instanceof Date ? date : new Date(date);
  return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, '0')}-${String(safeDate.getDate()).padStart(2, '0')}`;
}

function dateInCurrentMonth(day) {
  const date = nowDate();
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return toISO(new Date(date.getFullYear(), date.getMonth(), Math.min(day, lastDay)));
}

function dateDaysAgo(days) {
  const date = nowDate();
  date.setDate(date.getDate() - days);
  return toISO(date);
}

function monthKey(date = nowDate()) {
  const safeDate = date instanceof Date ? date : new Date(`${date}T12:00:00`);
  return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key = monthKey()) {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function shortDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function longDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function formatCurrency(minor = 0, options = {}) {
  const absolute = Math.abs(Number(minor) || 0) / 100;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: appState.data?.profile?.currency || 'USD',
    maximumFractionDigits: options.compact ? 0 : 2,
    notation: options.compact ? 'compact' : 'standard',
  }).format(absolute);
  if (options.signed && Number(minor) > 0) return `+${formatted}`;
  if (options.signed && Number(minor) < 0) return `-${formatted}`;
  return formatted;
}

function amountForInput(minor = 0) {
  return (Number(minor) / 100).toFixed(2);
}

function parseMoney(value) {
  const normalized = String(value || '').replace(/[^0-9.-]/g, '');
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function signedAmount(tx) {
  const amount = tx.type === 'income' ? Math.abs(tx.amountMinor) : -Math.abs(tx.amountMinor);
  return formatCurrency(amount, { signed: true });
}

function makeCategories() {
  return Object.entries(CATEGORY_META).map(([id, meta]) => ({ id, name: meta.label, type: id === 'income' ? 'income' : 'expense', color: meta.color }));
}

function createSeedData(user) {
  const categories = makeCategories();
  const accountIds = { checking: uid('acct'), savings: uid('acct'), card: uid('acct') };
  const tx = (merchant, amountMinor, categoryId, date, accountId = accountIds.checking, type = 'expense', note = '') => ({
    id: uid('tx'), merchant, amountMinor, categoryId, date, accountId, type, note, createdAt: new Date().toISOString(),
  });

  return {
    schemaVersion: 1,
    profile: { id: user.id, name: user.name || 'Alex Rivera', email: user.email, currency: 'USD' },
    accounts: [
      { id: accountIds.checking, name: 'Everyday checking', type: 'Checking', openingBalanceMinor: 804000, archived: false },
      { id: accountIds.savings, name: 'Rainy day savings', type: 'Savings', openingBalanceMinor: 745000, archived: false },
      { id: accountIds.card, name: 'Altitude credit card', type: 'Credit card', openingBalanceMinor: -45000, archived: false },
    ],
    categories,
    transactions: [
      tx('Salary deposit', 420000, 'income', dateInCurrentMonth(1), accountIds.checking, 'income', 'Monthly salary'),
      tx('Whole Foods Market', 12642, 'groceries', dateInCurrentMonth(2), accountIds.checking),
      tx('Adobe Creative Cloud', 5999, 'utilities', dateInCurrentMonth(3), accountIds.card),
      tx('Uber', 2400, 'transport', dateInCurrentMonth(5), accountIds.card),
      tx('Blue Bottle Coffee', 860, 'dining', dateInCurrentMonth(6), accountIds.checking),
      tx('Apple Store', 1299, 'shopping', dateInCurrentMonth(7), accountIds.card),
      tx('Target', 7420, 'shopping', dateInCurrentMonth(9), accountIds.checking),
      tx('Airbnb', 19200, 'entertainment', dateInCurrentMonth(11), accountIds.card, 'expense', 'Weekend in Portland'),
      tx('Trader Joe\'s', 8421, 'groceries', dateInCurrentMonth(13), accountIds.checking),
      tx('Spotify', 1099, 'entertainment', dateInCurrentMonth(15), accountIds.card),
      tx('Sweetgreen', 1810, 'dining', dateInCurrentMonth(16), accountIds.checking),
      tx('Freelance payout', 85000, 'income', dateInCurrentMonth(17), accountIds.checking, 'income', 'Brand strategy project'),
      tx('Notion', 1200, 'utilities', dateDaysAgo(35), accountIds.card),
      tx('Farmers market', 4520, 'groceries', dateDaysAgo(38), accountIds.checking),
    ],
    budgets: [
      { id: uid('budget'), categoryId: 'groceries', month: monthKey(), limitMinor: 55000 },
      { id: uid('budget'), categoryId: 'dining', month: monthKey(), limitMinor: 28000 },
      { id: uid('budget'), categoryId: 'transport', month: monthKey(), limitMinor: 22000 },
      { id: uid('budget'), categoryId: 'entertainment', month: monthKey(), limitMinor: 18000 },
      { id: uid('budget'), categoryId: 'shopping', month: monthKey(), limitMinor: 25000 },
      { id: uid('budget'), categoryId: 'utilities', month: monthKey(), limitMinor: 16000 },
    ],
    subscriptions: [
      { id: uid('sub'), name: 'Notion', amountMinor: 1200, billingCycle: 'monthly', nextDueDate: dateInCurrentMonth(21), categoryId: 'utilities', status: 'active' },
      { id: uid('sub'), name: 'Netflix', amountMinor: 2299, billingCycle: 'monthly', nextDueDate: dateInCurrentMonth(24), categoryId: 'entertainment', status: 'active' },
      { id: uid('sub'), name: 'Figma', amountMinor: 1500, billingCycle: 'monthly', nextDueDate: dateInCurrentMonth(27), categoryId: 'utilities', status: 'active' },
      { id: uid('sub'), name: 'Wellness studio', amountMinor: 4800, billingCycle: 'monthly', nextDueDate: dateInCurrentMonth(30), categoryId: 'health', status: 'active' },
    ],
    goals: [
      { id: uid('goal'), name: 'Emergency fund', targetMinor: 1000000, currentMinor: 650000, targetDate: `${new Date().getFullYear() + 1}-06-30`, color: 'green', icon: '⌁' },
      { id: uid('goal'), name: 'New MacBook', targetMinor: 260000, currentMinor: 134000, targetDate: `${new Date().getFullYear()}-12-15`, color: 'lavender', icon: '◇' },
      { id: uid('goal'), name: 'Japan trip', targetMinor: 400000, currentMinor: 112000, targetDate: `${new Date().getFullYear() + 1}-04-01`, color: 'peach', icon: '✦' },
    ],
  };
}

function getUsers() {
  return readStorage(STORAGE.users, []);
}

function saveUsers(users) {
  writeStorage(STORAGE.users, users);
}

function saveData() {
  if (appState.user && appState.data) writeStorage(STORAGE.data(appState.user.id), appState.data);
}

function getCategory(id) {
  return appState.data.categories.find((category) => category.id === id) || { id: 'other', name: 'Other', color: CATEGORY_META.other.color };
}

function getAccount(id) {
  return appState.data.accounts.find((account) => account.id === id) || { name: 'Unknown account' };
}

function getMonthTransactions(key = monthKey()) {
  return appState.data.transactions.filter((transaction) => transaction.date.startsWith(key));
}

function getTotals() {
  const transactions = appState.data.transactions;
  const balance = appState.data.accounts.reduce((total, account) => total + Number(account.openingBalanceMinor || 0), 0) + transactions.reduce((total, transaction) => total + (transaction.type === 'income' ? transaction.amountMinor : -transaction.amountMinor), 0);
  const current = getMonthTransactions();
  const income = current.filter((transaction) => transaction.type === 'income').reduce((total, transaction) => total + transaction.amountMinor, 0);
  const expenses = current.filter((transaction) => transaction.type === 'expense').reduce((total, transaction) => total + transaction.amountMinor, 0);
  const savingsRate = income ? Math.max(0, Math.round(((income - expenses) / income) * 100)) : 0;
  return { balance, income, expenses, savingsRate, netCashflow: income - expenses };
}

function getCategorySpend(key = monthKey()) {
  const totals = {};
  getMonthTransactions(key).filter((transaction) => transaction.type === 'expense').forEach((transaction) => {
    totals[transaction.categoryId] = (totals[transaction.categoryId] || 0) + transaction.amountMinor;
  });
  return totals;
}

function getBudget(categoryId, key = monthKey()) {
  return appState.data.budgets.find((budget) => budget.categoryId === categoryId && budget.month === key);
}

function getBudgetState(budget) {
  const spent = getCategorySpend(budget.month)[budget.categoryId] || 0;
  const percent = budget.limitMinor ? Math.round((spent / budget.limitMinor) * 100) : 0;
  return { spent, percent, remaining: budget.limitMinor - spent };
}

function getGoalPercent(goal) {
  return goal.targetMinor ? Math.min(100, Math.round((goal.currentMinor / goal.targetMinor) * 100)) : 0;
}

function daysUntil(date) {
  return Math.ceil((new Date(`${date}T12:00:00`) - nowDate()) / 86400000);
}

function suggestCategory(merchant = '') {
  const value = merchant.toLowerCase();
  const patterns = [
    ['groceries', ['whole foods', 'trader', 'market', 'grocery', 'farmers']],
    ['dining', ['coffee', 'cafe', 'restaurant', 'sweetgreen', 'doordash', 'uber eats', 'pizza']],
    ['transport', ['uber', 'lyft', 'gas', 'shell', 'parking', 'transit']],
    ['entertainment', ['netflix', 'spotify', 'airbnb', 'movie', 'ticket', 'figma']],
    ['utilities', ['adobe', 'notion', 'internet', 'electric', 'phone', 'utility']],
    ['shopping', ['target', 'amazon', 'apple', 'shop', 'store']],
    ['health', ['gym', 'wellness', 'doctor', 'pharmacy', 'health']],
  ];
  const match = patterns.find(([, words]) => words.some((word) => value.includes(word)));
  return match ? match[0] : 'other';
}

function getTrendPoints() {
  const current = getMonthTransactions();
  const base = [38, 52, 45, 67, 59, 74];
  current.forEach((transaction) => {
    const index = Math.min(5, Math.max(0, Math.floor((Number(transaction.date.slice(-2)) - 1) / 6)));
    base[index] += transaction.type === 'income' ? 15 : -Math.min(12, Math.round(transaction.amountMinor / 5000));
  });
  return base.map((value) => Math.max(18, value));
}

function renderTrendChart() {
  const values = getTrendPoints();
  const min = Math.min(...values) - 5;
  const max = Math.max(...values) + 5;
  const points = values.map((value, index) => {
    const x = 16 + (index * 588) / (values.length - 1);
    const y = 160 - ((value - min) / (max - min)) * 125;
    return [x, y];
  });
  const path = points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const area = `${path} L ${points.at(-1)[0]} 175 L ${points[0][0]} 175 Z`;
  const labels = ['Sep 22', 'Sep 27', 'Oct 2', 'Oct 7', 'Oct 12', 'Oct 19'];
  return `<div class="line-chart" aria-label="Cash flow trend: rising over the last four weeks">
    <div class="chart-grid-lines" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="chart-y-labels" aria-hidden="true"><span>$5k</span><span>$3k</span><span>$1k</span><span>$0</span></div>
    <svg class="chart-svg" viewBox="0 0 620 190" role="img" aria-label="Cash flow line chart"><defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2ba879" stop-opacity=".45"/><stop offset="1" stop-color="#2ba879" stop-opacity="0"/></linearGradient></defs><path class="area" d="${area}"/><path class="line" d="${path}"/>${points.map(([x, y]) => `<circle class="dot" cx="${x}" cy="${y}" r="4"/>`).join('')}</svg>
    <div class="chart-x-labels" aria-hidden="true">${labels.map((label) => `<span>${label}</span>`).join('')}</div>
  </div>`;
}

function categoryOptions(selected, includeIncome = false) {
  return appState.data.categories
    .filter((category) => includeIncome || category.type === 'expense')
    .map((category) => `<option value="${category.id}" ${category.id === selected ? 'selected' : ''}>${escapeHTML(category.name)}</option>`)
    .join('');
}

function accountOptions(selected) {
  return appState.data.accounts.filter((account) => !account.archived).map((account) => `<option value="${account.id}" ${account.id === selected ? 'selected' : ''}>${escapeHTML(account.name)}</option>`).join('');
}

function merchantIcon(transaction) {
  const meta = CATEGORY_META[transaction.categoryId] || CATEGORY_META.other;
  return `<span class="merchant-icon ${meta.tone}">${meta.icon}</span>`;
}

function renderActivityRows(limit = 5) {
  const rows = [...appState.data.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (!rows.length) return '<div class="empty-state"><strong>No transactions yet</strong><p>Add your first expense to start seeing patterns.</p></div>';
  return rows.map((transaction) => `<div class="activity-row">
    ${merchantIcon(transaction)}
    <div class="merchant-copy"><strong>${escapeHTML(transaction.merchant)}</strong><small>${escapeHTML(getCategory(transaction.categoryId).name)} · ${shortDate(transaction.date)}</small></div>
    <span class="activity-amount ${transaction.type}">${signedAmount(transaction)}</span>
  </div>`).join('');
}

function renderDonut() {
  const totals = getCategorySpend();
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  let cursor = 0;
  const colors = entries.map(([categoryId, value]) => {
    const start = cursor;
    cursor += (value / total) * 100;
    return `${CATEGORY_META[categoryId]?.color || CATEGORY_META.other.color} ${start}% ${cursor}%`;
  });
  if (!colors.length) colors.push(`${CATEGORY_META.other.color} 0 100%`);
  const legend = entries.slice(0, 4).map(([categoryId, value]) => `<div class="legend-row"><i style="background:${CATEGORY_META[categoryId]?.color || CATEGORY_META.other.color}"></i><span>${escapeHTML(CATEGORY_META[categoryId]?.label || 'Other')}</span><strong>${formatCurrency(value)}</strong><small>${Math.round((value / total) * 100)}%</small></div>`).join('');
  return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${colors.join(',')})"><div class="donut-center"><strong>${formatCurrency(total, { compact: true })}</strong><small>spent this month</small></div></div><div class="legend-list">${legend || '<div class="empty-state"><strong>No spend yet</strong></div>'}</div></div>`;
}

function insightsForDashboard() {
  const totals = getTotals();
  const diningBudget = getBudget('dining');
  const diningState = diningBudget ? getBudgetState(diningBudget) : { percent: 0 };
  const options = [
    diningState.percent >= 70 ? { title: 'Dining is your loudest signal', text: `You have used ${diningState.percent}% of your dining budget. A $${Math.max(0, Math.round((diningBudget.limitMinor - diningState.spent) / 100))} runway remains this month.`, tag: 'Budget pulse' } : null,
    { title: 'Your savings rhythm is strong', text: `${totals.savingsRate}% of this month’s incoming money is still working for you. That is a healthy pace toward your next goal.`, tag: 'Momentum check' },
    { title: 'A small win is hiding in plain sight', text: 'Bundling two recurring subscriptions into your monthly review could make your plan feel noticeably lighter.', tag: 'Smart suggestion' },
  ].filter(Boolean);
  return options[appState.insightIndex % options.length];
}

function pageHeader(eyebrow, title, description, actions = '') {
  return `<div class="page-intro"><div><p class="eyebrow"><span></span>${eyebrow}</p><h2>${title}</h2><p>${description}</p></div><div class="page-intro-actions">${actions}</div></div>`;
}

function riskMode(mode = 'all') {
  return RISK_MODES[mode] || RISK_MODES.all;
}

function riskLocationLabel(location) {
  if (!location) return 'Location not selected';
  return [location.name, location.admin1, location.country].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(', ');
}

function riskImageBbox(location) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const latitudeRadius = 0.1;
  const longitudeRadius = Math.min(0.35, 0.14 / Math.max(0.35, Math.cos((latitude * Math.PI) / 180)));
  return [
    Math.max(-180, longitude - longitudeRadius),
    Math.max(-89.7, latitude - latitudeRadius),
    Math.min(180, longitude + longitudeRadius),
    Math.min(89.7, latitude + latitudeRadius),
  ].map((value) => value.toFixed(4)).join(',');
}

function riskSatelliteUrl(location, date, mode = 'all') {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: riskMode(mode).layer,
    STYLES: 'default',
    FORMAT: 'image/png',
    TRANSPARENT: 'FALSE',
    SRS: 'EPSG:4326',
    BBOX: riskImageBbox(location),
    WIDTH: '800',
    HEIGHT: '480',
    TIME: date,
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

async function fetchRiskJSON(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function geocodeRiskLocation(query) {
  const params = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' });
  const payload = await fetchRiskJSON(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
  const result = payload.results?.[0];
  if (!result) throw new Error('We could not find that place. Try a city, region or postal code.');
  return result;
}

async function loadRiskContext(location) {
  const weatherParams = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,cloud_cover',
    daily: 'temperature_2m_max,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration',
    forecast_days: '7',
    past_days: '7',
    timezone: 'auto',
  });
  const floodParams = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: 'river_discharge',
    past_days: '7',
    forecast_days: '7',
    timezone: 'GMT',
  });
  const [weatherResult, floodResult] = await Promise.allSettled([
    fetchRiskJSON(`https://api.open-meteo.com/v1/forecast?${weatherParams.toString()}`),
    fetchRiskJSON(`https://flood-api.open-meteo.com/v1/flood?${floodParams.toString()}`),
  ]);
  return {
    weather: weatherResult.status === 'fulfilled' ? weatherResult.value : null,
    flood: floodResult.status === 'fulfilled' ? floodResult.value : null,
    weatherError: weatherResult.status === 'rejected' ? 'Recent weather context is unavailable.' : '',
    floodError: floodResult.status === 'rejected' ? 'Modeled river context is unavailable.' : '',
  };
}

function recentDailyRows(daily) {
  if (!daily?.time?.length) return [];
  const today = toISO(nowDate());
  const todayIndex = daily.time.indexOf(today);
  const pivot = todayIndex >= 0 ? todayIndex : Math.min(7, daily.time.length - 1);
  const start = Math.max(0, pivot - 6);
  return daily.time.slice(start, pivot + 1).map((date, offset) => {
    const index = start + offset;
    return {
      date,
      precipitation: Number(daily.precipitation_sum?.[index] || 0),
      maxTemperature: Number(daily.temperature_2m_max?.[index] || 0),
      meanTemperature: Number(daily.temperature_2m_mean?.[index] || 0),
      evapotranspiration: Number(daily.et0_fao_evapotranspiration?.[index] || 0),
      riverDischarge: Number(daily.river_discharge?.[index] || 0),
    };
  });
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function riskContextStats(context) {
  const weatherRows = recentDailyRows(context?.weather?.daily);
  const riverRows = recentDailyRows(context?.flood?.daily);
  const rainMm = weatherRows.reduce((sum, row) => sum + row.precipitation, 0);
  const evapotranspirationMm = weatherRows.reduce((sum, row) => sum + row.evapotranspiration, 0);
  const maxTemperature = weatherRows.length ? Math.max(...weatherRows.map((row) => row.maxTemperature)) : null;
  const meanTemperature = weatherRows.length ? weatherRows.reduce((sum, row) => sum + row.meanTemperature, 0) / weatherRows.length : null;
  const riverValues = riverRows.map((row) => row.riverDischarge).filter((value) => value > 0);
  const riverPeak = riverValues.length ? Math.max(...riverValues) : null;
  const riverBaseline = riverValues.length > 1 ? median(riverValues.slice(0, -1)) : null;
  const riverTrend = riverPeak && riverBaseline ? riverPeak / riverBaseline : null;
  const current = context?.weather?.current || {};
  return {
    weatherRows,
    rainMm,
    evapotranspirationMm,
    moistureBalance: rainMm - evapotranspirationMm,
    maxTemperature,
    meanTemperature,
    humidity: Number.isFinite(Number(current.relative_humidity_2m)) ? Number(current.relative_humidity_2m) : null,
    cloudCover: Number.isFinite(Number(current.cloud_cover)) ? Number(current.cloud_cover) : null,
    currentPrecipitation: Number.isFinite(Number(current.precipitation)) ? Number(current.precipitation) : null,
    riverPeak,
    riverBaseline,
    riverTrend,
  };
}

function screeningState(score, hasData) {
  if (!hasData) return { label: 'Insufficient evidence', tone: 'warning' };
  if (score >= 3) return { label: 'Stronger screening signal', tone: 'danger' };
  if (score >= 1) return { label: 'Possible signal', tone: 'warning' };
  return { label: 'No strong signal', tone: 'positive' };
}

function buildRiskReport(context, mode = 'all', imageComparison = null) {
  const stats = riskContextStats(context);
  const imageSignal = imageComparison?.status === 'ready' && imageComparison.changeFraction >= 0.18;
  const floodEvidence = [];
  if (stats.rainMm >= 60) floodEvidence.push(`${Math.round(stats.rainMm)} mm of modeled precipitation in the recent 7-day window`);
  if (stats.riverTrend >= 1.4) floodEvidence.push('modeled river discharge is elevated versus its recent baseline');
  if (mode === 'flood' && imageSignal) floodEvidence.push('the selected before/after imagery shows a notable visual change');
  const floodScore = Math.min(3, (stats.rainMm >= 60 ? 1 : 0) + (stats.rainMm >= 120 ? 1 : 0) + (stats.riverTrend >= 1.4 ? 1 : 0) + (mode === 'flood' && imageSignal ? 1 : 0));
  const floodStatus = screeningState(floodScore, Boolean(context?.weather || context?.flood));

  const heatEvidence = [];
  if (stats.maxTemperature >= 32) heatEvidence.push(`recent daily maximum temperatures reached ${Math.round(stats.maxTemperature)}°C`);
  if (stats.cloudCover !== null && stats.cloudCover <= 45) heatEvidence.push(`current cloud cover is ${Math.round(stats.cloudCover)}%`);
  if (mode === 'heat' && imageSignal) heatEvidence.push('the selected land-surface-temperature imagery shows a notable visual change');
  const heatScore = Math.min(3, (stats.maxTemperature >= 32 ? 1 : 0) + (stats.maxTemperature >= 36 ? 1 : 0) + (stats.cloudCover !== null && stats.cloudCover <= 45 ? 1 : 0) + (mode === 'heat' && imageSignal ? 1 : 0));
  const heatStatus = screeningState(heatScore, Boolean(context?.weather));

  const vegetationEvidence = [];
  if (stats.moistureBalance <= -15) vegetationEvidence.push(`modeled evapotranspiration exceeds precipitation by ${Math.round(Math.abs(stats.moistureBalance))} mm`);
  if (stats.maxTemperature >= 32 && stats.moistureBalance < 0) vegetationEvidence.push('recent warmth and a negative moisture balance may add plant stress');
  if (mode === 'vegetation' && imageSignal) vegetationEvidence.push('the selected NDVI imagery shows a notable visual change');
  const vegetationScore = Math.min(3, (stats.moistureBalance <= -15 ? 1 : 0) + (stats.moistureBalance <= -35 ? 1 : 0) + (stats.maxTemperature >= 32 && stats.moistureBalance < 0 ? 1 : 0) + (mode === 'vegetation' && imageSignal ? 1 : 0));
  const vegetationStatus = screeningState(vegetationScore, Boolean(context?.weather));

  return {
    stats,
    signals: [
      { id: 'flood', title: 'Flood screening', ...floodStatus, summary: floodScore ? 'Weather and modeled river conditions merit a closer look for surface-water expansion.' : 'No strong rainfall or river-discharge signal was found in the recent context.', evidence: floodEvidence },
      { id: 'heat', title: 'Heat-island screening', ...heatStatus, summary: heatScore ? 'Warm-weather conditions could amplify a persistent warm surface contrast.' : 'Recent weather does not show a strong heat-stress context.', evidence: heatEvidence },
      { id: 'vegetation', title: 'Vegetation change', ...vegetationStatus, summary: vegetationScore ? 'The moisture and temperature context is consistent with possible vegetation stress.' : 'Recent weather does not show a strong moisture-stress context.', evidence: vegetationEvidence },
    ],
    imageComparison,
    generatedAt: new Date().toISOString(),
  };
}

function formatRiskNumber(value, suffix = '') {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${suffix}`;
}

function renderDashboard() {
  const totals = getTotals();
  const insight = insightsForDashboard();
  const actions = `<button class="button button-secondary" type="button" data-action="open-search">⌕ <span>Search</span></button><button class="button button-primary" type="button" data-action="add-transaction">+ Add transaction</button>`;
  return `<div class="page-shell dashboard-page">
    ${pageHeader('Overview', 'Your money, at a glance.', 'A calm snapshot of where things stand this month.', actions)}
    <section class="metric-grid" aria-label="Key financial metrics">
      <article class="card metric-card primary"><div class="metric-top"><span>Total balance</span><span class="metric-icon">✦</span></div><div class="metric-value">${formatCurrency(totals.balance)}</div><div class="metric-foot"><strong>↑ 8.4%</strong><span>vs. last month</span></div></article>
      <article class="card metric-card"><div class="metric-top"><span>Monthly income</span><span class="metric-icon">↑</span></div><div class="metric-value">${formatCurrency(totals.income)}</div><div class="metric-foot"><strong>On track</strong><span>${monthLabel()}</span></div></article>
      <article class="card metric-card"><div class="metric-top"><span>Monthly spending</span><span class="metric-icon">↘</span></div><div class="metric-value">${formatCurrency(totals.expenses)}</div><div class="metric-foot"><strong>${totals.savingsRate}% saved</strong><span>of income</span></div></article>
      <article class="card metric-card"><div class="metric-top"><span>Upcoming bills</span><span class="metric-icon">◷</span></div><div class="metric-value">${formatCurrency(appState.data.subscriptions.filter((sub) => sub.status === 'active' && daysUntil(sub.nextDueDate) >= 0 && daysUntil(sub.nextDueDate) <= 30).reduce((sum, sub) => sum + sub.amountMinor, 0))}</div><div class="metric-foot"><strong>${appState.data.subscriptions.filter((sub) => sub.status === 'active' && daysUntil(sub.nextDueDate) >= 0 && daysUntil(sub.nextDueDate) <= 30).length} due</strong><span>next 30 days</span></div></article>
    </section>
    <section class="dashboard-grid">
      <article class="card chart-card"><div class="card-heading"><div><h3>Cash flow</h3><p>Incoming and outgoing money over time</p></div><div class="chart-toolbar"><span class="data-chip">This month</span><button class="icon-button" type="button" data-action="export-data" aria-label="Export cash flow">↓</button></div></div><div class="chart-summary"><strong>${formatCurrency(totals.netCashflow, { signed: true })}</strong><span>+12.8% <small>vs. last month</small></span></div>${renderTrendChart()}<div class="chart-legend"><span><i></i>Cash flow</span><span><i class="expense"></i>Expenses</span></div></article>
      <article class="card spending-card"><div class="card-heading"><div><h3>Where your money goes</h3><p>Spending by category</p></div><button class="card-link" type="button" data-route="transactions">View report →</button></div>${renderDonut()}</article>
    </section>
    <section class="dashboard-bottom">
      <article class="card activity-card"><div class="card-heading"><div><h3>Recent activity</h3><p>Latest money movements</p></div><button class="card-link" type="button" data-route="transactions">See all →</button></div><div class="activity-list">${renderActivityRows()}</div></article>
      <article class="card insight-card"><div class="card-heading"><div><h3>Northstar signal</h3><p>Personalized to your habits</p></div><span class="insight-spark">✦</span></div><div class="insight-body"><span class="insight-tag">✦ ${insight.tag}</span><h4>${escapeHTML(insight.title)}</h4><p>${escapeHTML(insight.text)}</p></div><div class="insight-footer"><button type="button" data-action="refresh-insight">Show me another →</button><span>Updated just now</span></div></article>
    </section>
  </div>`;
}

function renderTransactions() {
  const transactions = [...appState.data.transactions].sort((a, b) => b.date.localeCompare(a.date));
  const rows = transactions.map((transaction) => `<tr>
    <td><div class="merchant-cell">${merchantIcon(transaction)}<div class="merchant-copy"><strong>${escapeHTML(transaction.merchant)}</strong><small>${escapeHTML(getAccount(transaction.accountId).name)}</small></div></div></td>
    <td>${longDate(transaction.date)}</td><td><span class="category-pill">${escapeHTML(getCategory(transaction.categoryId).name)}</span></td><td>${transaction.type === 'income' ? 'Incoming' : 'Completed'}</td><td class="amount-cell ${transaction.type}">${signedAmount(transaction)}</td>
    <td><div class="row-menu"><button class="row-menu-button" type="button" data-action="toggle-row-menu" data-id="${transaction.id}" aria-label="More actions for ${escapeHTML(transaction.merchant)}">···</button><div class="row-menu-actions" data-menu-for="${transaction.id}" hidden><button type="button" data-action="edit-transaction" data-id="${transaction.id}">Edit</button><button type="button" data-action="delete-transaction" data-id="${transaction.id}">Delete</button></div></div></td>
  </tr>`).join('');
  return `<div class="page-shell transactions-page">${pageHeader('Ledger', 'Every move, accounted for.', 'Keep the small details visible so the bigger picture stays clear.', '<button class="button button-secondary" type="button" data-action="export-data">↓ Export</button><button class="button button-primary" type="button" data-action="add-transaction">+ Add transaction</button>')}
    <div class="card toolbar-card"><div class="toolbar-left"><div class="toolbar-search"><span>⌕</span><input id="transaction-search" type="search" placeholder="Search merchants or notes" aria-label="Search transactions" /></div><select id="transaction-category-filter" class="filter-select" aria-label="Filter by category"><option value="all">All categories</option>${categoryOptions('other', false)}</select></div><div class="toolbar-right"><select id="transaction-type-filter" class="filter-select" aria-label="Filter by type"><option value="all">All activity</option><option value="expense">Expenses</option><option value="income">Income</option></select><button class="button button-secondary button-small" type="button" data-action="clear-filters">Clear</button></div></div>
    <div class="card transaction-table-wrap"><table class="transaction-table"><thead><tr><th>Merchant</th><th>Date</th><th>Category</th><th>Status</th><th>Amount</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="transaction-rows">${rows || '<tr><td colspan="6"><div class="empty-state"><strong>No transactions yet</strong><p>Add your first transaction to start building your picture.</p></div></td></tr>'}</tbody></table></div>
  </div>`;
}

function renderBudgets() {
  const budgets = appState.data.budgets.filter((budget) => budget.month === monthKey());
  const spent = budgets.reduce((sum, budget) => sum + getBudgetState(budget).spent, 0);
  const limit = budgets.reduce((sum, budget) => sum + budget.limitMinor, 0);
  const cards = budgets.map((budget) => {
    const state = getBudgetState(budget);
    const meta = CATEGORY_META[budget.categoryId] || CATEGORY_META.other;
    const tone = state.percent >= 100 ? 'danger' : state.percent >= 80 ? 'warning' : '';
    return `<article class="card budget-card"><div class="budget-card-top"><div class="budget-name"><i class="budget-color" style="background:${meta.color}"></i><div><strong>${escapeHTML(meta.label)}</strong><small>${monthLabel(budget.month)}</small></div></div><span class="budget-percent">${state.percent}%</span></div><div class="progress-track"><div class="progress-value ${tone}" style="width:${Math.min(100, state.percent)}%"></div></div><div class="budget-foot"><span><strong>${formatCurrency(state.spent)}</strong> spent</span><span>${state.remaining >= 0 ? `${formatCurrency(state.remaining)} left` : `${formatCurrency(Math.abs(state.remaining))} over`}</span></div></article>`;
  }).join('');
  return `<div class="page-shell budgets-page">${pageHeader('Planning', 'Give your money a little structure.', 'Budgets flex with real life while keeping your priorities in view.', '<button class="button button-primary" type="button" data-action="add-budget">+ New budget</button>')}
    <section class="metric-grid"><article class="card metric-card primary"><div class="metric-top"><span>Total budgeted</span><span class="metric-icon">▥</span></div><div class="metric-value">${formatCurrency(limit)}</div><div class="metric-foot"><strong>${monthLabel()}</strong><span>this month</span></div></article><article class="card metric-card"><div class="metric-top"><span>Used so far</span><span class="metric-icon">↘</span></div><div class="metric-value">${formatCurrency(spent)}</div><div class="metric-foot"><strong>${limit ? Math.round((spent / limit) * 100) : 0}%</strong><span>of your plan</span></div></article><article class="card metric-card"><div class="metric-top"><span>On track</span><span class="metric-icon">✓</span></div><div class="metric-value">${budgets.filter((budget) => getBudgetState(budget).percent < 80).length}</div><div class="metric-foot"><strong>categories</strong><span>with room</span></div></article><article class="card metric-card"><div class="metric-top"><span>Flexible left</span><span class="metric-icon">✦</span></div><div class="metric-value">${formatCurrency(Math.max(0, limit - spent))}</div><div class="metric-foot"><strong>available</strong><span>to reallocate</span></div></article></section>
    <div class="budget-grid" style="margin-top:15px">${cards || '<div class="card empty-state"><strong>No budgets yet</strong><p>Create a category budget to give your spending a north star.</p></div>'}</div>
  </div>`;
}

function subscriptionLogo(name) {
  const first = escapeHTML(name.trim().slice(0, 1).toUpperCase() || 'N');
  const tone = name.toLowerCase().includes('netflix') ? 'orange' : name.toLowerCase().includes('figma') ? 'green' : name.toLowerCase().includes('wellness') ? 'yellow' : '';
  return `<span class="subscription-brand ${tone}">${first}</span>`;
}

function renderSubscriptions() {
  const subscriptions = appState.data.subscriptions.filter((subscription) => subscription.status !== 'cancelled');
  const monthly = subscriptions.reduce((sum, subscription) => sum + (subscription.billingCycle === 'yearly' ? Math.round(subscription.amountMinor / 12) : subscription.amountMinor), 0);
  const cards = subscriptions.map((subscription) => `<article class="card subscription-card"><div class="subscription-card-top">${subscriptionLogo(subscription.name)}<span class="data-chip ${subscription.status === 'paused' ? 'warning' : 'positive'}">${subscription.status === 'paused' ? 'Paused' : 'Active'}</span></div><h3>${escapeHTML(subscription.name)}</h3><p>${escapeHTML(getCategory(subscription.categoryId).name)} · ${escapeHTML(subscription.billingCycle)}</p><div class="subscription-amount"><strong>${formatCurrency(subscription.amountMinor)}</strong><span>/${subscription.billingCycle === 'yearly' ? 'year' : 'month'}</span></div><div class="subscription-due"><span>Next charge</span><strong>${shortDate(subscription.nextDueDate)}</strong></div></article>`).join('');
  return `<div class="page-shell subscriptions-page">${pageHeader('Recurring', 'Keep the quiet charges visible.', 'Know what is coming before it taps your account.', '<button class="button button-primary" type="button" data-action="add-subscription">+ Add subscription</button>')}
    <section class="metric-grid"><article class="card metric-card primary"><div class="metric-top"><span>Monthly recurring</span><span class="metric-icon">◌</span></div><div class="metric-value">${formatCurrency(monthly)}</div><div class="metric-foot"><strong>${subscriptions.length} active</strong><span>subscriptions</span></div></article><article class="card metric-card"><div class="metric-top"><span>Next 7 days</span><span class="metric-icon">◷</span></div><div class="metric-value">${formatCurrency(subscriptions.filter((subscription) => subscription.status === 'active' && daysUntil(subscription.nextDueDate) >= 0 && daysUntil(subscription.nextDueDate) <= 7).reduce((sum, subscription) => sum + subscription.amountMinor, 0))}</div><div class="metric-foot"><strong>Upcoming</strong><span>payments</span></div></article><article class="card metric-card"><div class="metric-top"><span>Annual run rate</span><span class="metric-icon">↗</span></div><div class="metric-value">${formatCurrency(monthly * 12)}</div><div class="metric-foot"><strong>Projected</strong><span>over 12 months</span></div></article><article class="card metric-card"><div class="metric-top"><span>Review due</span><span class="metric-icon">!</span></div><div class="metric-value">${subscriptions.filter((subscription) => subscription.status === 'active').length > 3 ? '1' : '0'}</div><div class="metric-foot"><strong>smart flag</strong><span>to look at</span></div></article></section>
    <div class="subscription-grid" style="margin-top:15px">${cards || '<div class="card empty-state"><strong>No subscriptions yet</strong><p>Add a recurring payment to get reminders before it lands.</p></div>'}</div>
  </div>`;
}

function renderGoals() {
  const goals = appState.data.goals;
  const saved = goals.reduce((sum, goal) => sum + goal.currentMinor, 0);
  const target = goals.reduce((sum, goal) => sum + goal.targetMinor, 0);
  const cards = goals.map((goal) => `<article class="card goal-card ${escapeHTML(goal.color || '')}"><div class="goal-card-top"><span class="goal-icon">${escapeHTML(goal.icon || '◎')}</span><span class="goal-date">Target ${shortDate(goal.targetDate)}</span></div><h3>${escapeHTML(goal.name)}</h3><p>Keep building this one step at a time.</p><div class="goal-amounts"><strong>${formatCurrency(goal.currentMinor)}</strong><span>of ${formatCurrency(goal.targetMinor)}</span></div><div class="progress-track"><div class="progress-value" style="width:${getGoalPercent(goal)}%"></div></div><div class="goal-card-footer"><span>${getGoalPercent(goal)}% complete</span><strong>${formatCurrency(Math.max(0, goal.targetMinor - goal.currentMinor))} to go</strong></div><div class="goal-actions"><button class="button button-primary button-small" type="button" data-action="contribute-goal" data-id="${goal.id}">+ Add money</button></div></article>`).join('');
  return `<div class="page-shell goals-page">${pageHeader('Future you', 'Give the next chapter a number.', 'Turn good intentions into visible, motivating progress.', '<button class="button button-primary" type="button" data-action="add-goal">+ New goal</button>')}
    <section class="metric-grid"><article class="card metric-card primary"><div class="metric-top"><span>Total saved</span><span class="metric-icon">◎</span></div><div class="metric-value">${formatCurrency(saved)}</div><div class="metric-foot"><strong>${goals.length} active goals</strong><span>in motion</span></div></article><article class="card metric-card"><div class="metric-top"><span>Across all goals</span><span class="metric-icon">↗</span></div><div class="metric-value">${target ? Math.round((saved / target) * 100) : 0}%</div><div class="metric-foot"><strong>overall progress</strong><span>keep going</span></div></article><article class="card metric-card"><div class="metric-top"><span>Closest milestone</span><span class="metric-icon">✦</span></div><div class="metric-value">${goals.length ? `${Math.max(...goals.map(getGoalPercent))}%` : '—'}</div><div class="metric-foot"><strong>on your way</strong><span>to a goal</span></div></article><article class="card metric-card"><div class="metric-top"><span>Suggested this month</span><span class="metric-icon">+</span></div><div class="metric-value">${formatCurrency(Math.max(0, Math.round(getTotals().netCashflow * .15)))}</div><div class="metric-foot"><strong>15% of surplus</strong><span>small step</span></div></article></section>
    <div class="goal-grid" style="margin-top:15px">${cards || '<div class="card empty-state"><strong>No goals yet</strong><p>Give something meaningful a name and a target.</p></div>'}</div>
  </div>`;
}

function renderInsights() {
  const totals = getTotals();
  const dining = getBudget('dining');
  const diningState = dining ? getBudgetState(dining) : { percent: 0 };
  const recommendations = [
    { title: diningState.percent >= 70 ? 'Give dining a softer landing' : 'Keep your dining rhythm', text: diningState.percent >= 70 ? `You are at ${diningState.percent}% of your dining budget. Try one planned meal at home this week to create breathing room.` : 'Your dining spend is comfortably within the plan. Keep the same simple rhythm.' },
    { title: 'Make payday do more', text: `Your current cashflow leaves ${formatCurrency(totals.netCashflow)} after expenses. Moving 15% to your Emergency fund would keep the goal moving without feeling restrictive.` },
    { title: 'Review one recurring charge', text: 'You have four active subscriptions. A two-minute monthly review is enough to keep quiet renewals intentional.' },
  ];
  return `<div class="page-shell insights-page">${pageHeader('Northstar intelligence', 'A little more meaning in the numbers.', 'Small observations, grounded in your real activity. No guilt — just useful next steps.', '<button class="button button-primary" type="button" data-action="refresh-insight">✦ Refresh insights</button>')}
    <section class="insights-grid"><article class="insight-large"><span class="insight-tag">✦ Personal finance co-pilot</span><h3>${escapeHTML(insightsForDashboard().title)}</h3><p>${escapeHTML(insightsForDashboard().text)} Northstar looks for patterns across your spending, recurring payments and goals so you can make the next decision with more context.</p><div class="insight-actions"><button class="button button-primary" type="button" data-action="refresh-insight">Show another signal ↗</button><button class="button button-secondary" type="button" data-route="budgets">Open budgets</button></div></article><div class="insight-metric-list"><article class="card insight-metric"><p>Monthly savings rate</p><strong>${totals.savingsRate}%</strong><small>↑ Trending in the right direction</small></article><article class="card insight-metric"><p>Dining budget used</p><strong>${diningState.percent}%</strong><small>${diningState.percent >= 80 ? 'Worth a little attention this week' : 'Comfortably inside your plan'}</small></article><article class="card insight-metric"><p>Goal momentum</p><strong>${appState.data.goals.length ? Math.max(...appState.data.goals.map(getGoalPercent)) : 0}%</strong><small>Emergency fund is your closest milestone</small></article></div></section>
    <section class="card activity-card" style="margin-top:15px"><div class="card-heading"><div><h3>Recommended next steps</h3><p>Simple, high-leverage moves based on your current picture</p></div><span class="data-chip positive">Updated just now</span></div><div class="recommendation-list">${recommendations.map((item, index) => `<div class="recommendation-row"><span class="recommendation-number">0${index + 1}</span><div><h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(item.text)}</p></div></div>`).join('')}</div></section>
  </div>`;
}

function renderRiskSignalCard(signal) {
  const evidence = signal.evidence.length
    ? `<ul class="risk-evidence-list">${signal.evidence.slice(0, 2).map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`
    : '<p class="risk-evidence-empty">No corroborating signal in the recent weather context.</p>';
  return `<article class="card risk-signal-card"><div class="risk-signal-top"><span class="risk-signal-icon ${signal.tone}">${signal.id === 'flood' ? '≈' : signal.id === 'heat' ? '☼' : '⌁'}</span><span class="data-chip ${signal.tone}">${escapeHTML(signal.label)}</span></div><h3>${escapeHTML(signal.title)}</h3><p>${escapeHTML(signal.summary)}</p>${evidence}</article>`;
}

function renderRiskDashboard() {
  const state = appState.risk;
  const form = state.form;
  const selectedMode = riskMode(form.mode);
  const actions = '<span class="data-chip positive">Public data · no API key</span>';
  let body = '';

  if (state.status === 'idle') {
    body = `<section class="risk-start-grid"><article class="card risk-start-card"><div class="risk-start-icon">◎</div><h3>Start with a place</h3><p>Enter a city, region or postal code. Northstar will pair recent weather context with two comparable NASA satellite views.</p><div class="risk-start-points"><span><b>01</b> Geocode a location</span><span><b>02</b> Compare two dates</span><span><b>03</b> Get a screening report</span></div></article><article class="card risk-method-card"><p class="eyebrow"><span></span>What this is</p><h3>A fast environmental read, not an emergency map.</h3><p>Use it to decide where to look next. Results are screening signals based on public model data and rendered satellite layers, not a property-level diagnosis.</p><span class="data-chip warning">Review before acting</span></article></section>`;
  }

  if (state.status === 'loading') {
    body = `<div class="card risk-loading" role="status"><span class="loading-orbit">✦</span><div><strong>Building your location report</strong><p>Finding the place, loading recent weather and preparing the satellite comparison…</p></div></div>`;
  }

  if (state.status === 'error') {
    body = `<div class="card risk-error" role="alert"><span class="risk-error-icon">!</span><div><strong>We could not complete that analysis</strong><p>${escapeHTML(state.error || 'Try a different location or check your connection, then run it again.')}</p><button class="button button-secondary button-small" type="button" data-action="retry-risk">Try again</button></div></div>`;
  }

  if (state.status === 'ready' && state.location && state.report) {
    const report = state.report;
    const stats = report.stats;
    const comparison = state.imageComparison;
    const imageryNote = comparison?.status === 'ready'
      ? `Browser comparison: ${Math.round(comparison.changeFraction * 100)}% of sampled pixels changed noticeably.`
      : comparison?.status === 'error'
        ? 'The imagery could not be sampled in this browser; the visual panels remain available for review.'
        : 'Sampling the rendered imagery in your browser…';
    const providerWarnings = [state.context?.weatherError, state.context?.floodError].filter(Boolean);
    body = `<section class="risk-report-head"><div><p class="eyebrow"><span></span>Screening report</p><h3>${escapeHTML(riskLocationLabel(state.location))}</h3><p>${escapeHTML(Number(state.location.latitude).toFixed(3))}°, ${escapeHTML(Number(state.location.longitude).toFixed(3))}° · Generated ${escapeHTML(shortDate(toISO(new Date())))}</p></div><div class="risk-report-head-meta"><span class="data-chip positive">${escapeHTML(selectedMode.label)}</span><span class="data-chip">${escapeHTML(selectedMode.layerLabel)}</span></div></section>
      <section class="risk-signal-grid">${report.signals.map(renderRiskSignalCard).join('')}</section>
      <section class="risk-analysis-grid"><article class="card risk-comparison-card"><div class="card-heading"><div><h3>Satellite comparison</h3><p>Same footprint · ${escapeHTML(selectedMode.layerLabel)} · requested dates</p></div><span class="data-chip">${escapeHTML(form.beforeDate)} → ${escapeHTML(form.afterDate)}</span></div><div class="risk-image-grid"><figure class="risk-image-panel"><div class="risk-image-label"><span>Before</span><strong>${escapeHTML(shortDate(form.beforeDate))}</strong></div><img data-risk-image="before" crossorigin="anonymous" src="${escapeHTML(riskSatelliteUrl(state.location, form.beforeDate, form.mode))}" alt="${escapeHTML(selectedMode.label)} satellite image for ${escapeHTML(riskLocationLabel(state.location))} on ${escapeHTML(form.beforeDate)}" /></figure><figure class="risk-image-panel"><div class="risk-image-label"><span>After</span><strong>${escapeHTML(shortDate(form.afterDate))}</strong></div><img data-risk-image="after" crossorigin="anonymous" src="${escapeHTML(riskSatelliteUrl(state.location, form.afterDate, form.mode))}" alt="${escapeHTML(selectedMode.label)} satellite image for ${escapeHTML(riskLocationLabel(state.location))} on ${escapeHTML(form.afterDate)}" /></figure></div><p class="risk-comparison-note" id="risk-image-comparison-note">${escapeHTML(imageryNote)}</p><p class="risk-attribution">Imagery: NASA Global Imagery Browse Services (GIBS). Products can snap to the nearest available acquisition or composite date.</p></article><article class="card risk-context-card"><div class="card-heading"><div><h3>Weather context</h3><p>Recent modeled conditions around the selected point</p></div><span class="data-chip">Last 7 days</span></div><div class="risk-context-metrics"><div><span>Rainfall</span><strong>${formatRiskNumber(stats.rainMm, ' mm')}</strong><small>modeled total</small></div><div><span>Max temperature</span><strong>${formatRiskNumber(stats.maxTemperature, '°C')}</strong><small>recent daily high</small></div><div><span>River discharge</span><strong>${formatRiskNumber(stats.riverPeak, ' m³/s')}</strong><small>modeled peak</small></div><div><span>Moisture balance</span><strong>${formatRiskNumber(stats.moistureBalance, ' mm')}</strong><small>rain minus ET₀</small></div></div>${providerWarnings.length ? `<div class="risk-provider-warning"><strong>Some context is missing</strong><p>${providerWarnings.map(escapeHTML).join(' ')}</p></div>` : ''}<p class="risk-provider-note">Weather: Open-Meteo forecast model · River: Open-Meteo GloFAS context. These are useful signals, not local gauges or official warnings.</p></article></section>
      <section class="card risk-methodology"><div><span class="risk-methodology-icon">✦</span><div><h3>How to read this report</h3><p>Signals combine weather context with a same-footprint satellite comparison. A visual change is not automatically a flood, heat island or vegetation loss: clouds, seasonality, water, harvest and image gaps can all look like change.</p></div></div><span class="data-chip warning">Screening only</span></section>`;
  }

  return `<div class="page-shell risk-page">${pageHeader('Environmental intelligence', 'See change before it becomes a surprise.', 'Compare satellite imagery across dates and pair it with weather context for a location-specific environmental risk report.', actions)}<form class="card risk-controls" data-form="risk-analysis" novalidate><div class="risk-control-main"><div class="field-group"><label for="risk-location">Location</label><input id="risk-location" name="query" type="search" value="${escapeHTML(form.query)}" placeholder="e.g. Portland, Oregon or 560001" required /></div><div class="field-group"><label for="risk-mode">Focus</label><select id="risk-mode" name="mode">${Object.entries(RISK_MODES).map(([id, item]) => `<option value="${id}" ${id === form.mode ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('')}</select></div></div><div class="risk-control-dates"><div class="field-group"><label for="risk-before-date">Before date</label><input id="risk-before-date" name="beforeDate" type="date" max="${toISO(nowDate())}" value="${escapeHTML(form.beforeDate)}" required /></div><span class="risk-date-arrow">→</span><div class="field-group"><label for="risk-after-date">After date</label><input id="risk-after-date" name="afterDate" type="date" max="${toISO(nowDate())}" value="${escapeHTML(form.afterDate)}" required /></div><button class="button button-primary risk-submit" type="submit">Analyze location <b>↗</b></button></div></form>${body}<p class="risk-footer-note">Data sources: Open-Meteo geocoding, weather and flood context · NASA GIBS satellite visualization. Public services may have coverage gaps and rate limits.</p></div>`;
}

function compareRiskImages() {
  const before = $('[data-risk-image="before"]');
  const after = $('[data-risk-image="after"]');
  if (!before || !after || appState.risk.imageComparison?.status === 'ready' || appState.risk.imageComparison?.status === 'loading' || appState.risk.imageComparison?.status === 'error') return;
  appState.risk.imageComparison = { status: 'loading' };
  const waitForImage = (image) => new Promise((resolve, reject) => {
    if (image.complete && image.naturalWidth) { resolve(image); return; }
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('Satellite image unavailable.')), { once: true });
  });
  Promise.all([waitForImage(before), waitForImage(after)]).then(([beforeImage, afterImage]) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 96;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(beforeImage, 0, 0, canvas.width, canvas.height);
    const beforePixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(afterImage, 0, 0, canvas.width, canvas.height);
    const afterPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let validPixels = 0;
    let changedPixels = 0;
    let totalChange = 0;
    for (let index = 0; index < beforePixels.length; index += 4) {
      if (beforePixels[index + 3] < 20 || afterPixels[index + 3] < 20) continue;
      const distance = (Math.abs(beforePixels[index] - afterPixels[index]) + Math.abs(beforePixels[index + 1] - afterPixels[index + 1]) + Math.abs(beforePixels[index + 2] - afterPixels[index + 2])) / 765;
      validPixels += 1;
      totalChange += distance;
      if (distance >= 0.15) changedPixels += 1;
    }
    const comparison = { status: 'ready', validFraction: validPixels / (canvas.width * canvas.height), changeFraction: validPixels ? changedPixels / validPixels : 0, averageChange: validPixels ? totalChange / validPixels : 0 };
    appState.risk.imageComparison = comparison;
    appState.risk.report = buildRiskReport(appState.risk.context, appState.risk.form.mode, comparison);
    if (appState.route === 'risk') render();
  }).catch(() => {
    appState.risk.imageComparison = { status: 'error' };
    const note = $('#risk-image-comparison-note');
    if (note) note.textContent = 'The imagery could not be sampled in this browser; the visual panels remain available for review.';
  });
}

async function analyzeRisk(values = appState.risk.form) {
  const requestId = appState.risk.requestId + 1;
  appState.risk.requestId = requestId;
  appState.risk.status = 'loading';
  appState.risk.form = { ...RISK_DEFAULT_FORM, ...values, mode: RISK_MODES[values.mode] ? values.mode : 'all' };
  appState.risk.location = null;
  appState.risk.context = null;
  appState.risk.report = null;
  appState.risk.imageComparison = null;
  appState.risk.error = '';
  render();
  try {
    const location = await geocodeRiskLocation(appState.risk.form.query);
    const context = await loadRiskContext(location);
    if (requestId !== appState.risk.requestId) return;
    appState.risk.location = location;
    appState.risk.context = context;
    appState.risk.report = buildRiskReport(context, appState.risk.form.mode);
    appState.risk.status = 'ready';
    render();
    showToast(`Environmental report ready for ${location.name}.`);
  } catch (error) {
    if (requestId !== appState.risk.requestId) return;
    appState.risk.status = 'error';
    appState.risk.error = error.name === 'AbortError' ? 'The public data service took too long to respond.' : error.message;
    render();
  }
}

function getRouteFromHash() {
  const route = window.location.hash.replace('#', '').split('?')[0];
  return ['dashboard', 'transactions', 'budgets', 'subscriptions', 'goals', 'insights', 'risk'].includes(route) ? route : 'dashboard';
}

function updateShell(route) {
  const titles = {
    dashboard: `Good morning, ${appState.data.profile.name.split(' ')[0]} ✦`,
    transactions: 'Your transaction ledger',
    budgets: 'Plan with a little more clarity',
    subscriptions: 'The quiet charges, surfaced',
    goals: 'Progress worth seeing',
    insights: 'A smarter read on your money',
    risk: 'Read the signals around a place',
  };
  const kickers = {
    dashboard: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(nowDate()),
    transactions: 'All accounts · Updated just now',
    budgets: `${monthLabel()} · Flexible by design`,
    subscriptions: 'Recurring payments · Next 30 days',
    goals: 'Savings plan · Keep the momentum',
    insights: 'Northstar intelligence · Based on your activity',
    risk: 'Environmental intelligence · Satellite + weather context',
  };
  $('#page-title').innerHTML = `${escapeHTML(titles[route])}`;
  $('#page-kicker').textContent = kickers[route];
  $$('.nav-item[data-route]').forEach((item) => {
    const isActive = item.dataset.route === route;
    item.classList.toggle('is-active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const firstName = appState.data.profile.name.split(' ')[0] || 'there';
  $('#sidebar-name').textContent = appState.data.profile.name;
  $('#top-name').textContent = appState.data.profile.name;
  $('#menu-name').textContent = appState.data.profile.name;
  $('#menu-email').textContent = appState.data.profile.email;
  $('#top-avatar').textContent = initials(appState.data.profile.name);
  $('#menu-avatar').textContent = initials(appState.data.profile.name);
  $('#top-avatar').setAttribute('aria-label', `${firstName}'s profile`);
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'NS';
}

function render() {
  if (!appState.data) return;
  appState.route = getRouteFromHash();
  const views = { dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets, subscriptions: renderSubscriptions, goals: renderGoals, insights: renderInsights, risk: renderRiskDashboard };
  $('#app-main').innerHTML = views[appState.route]();
  updateShell(appState.route);
  closeSidebar();
  if (appState.route === 'risk' && appState.risk.status === 'ready') window.setTimeout(compareRiskImages, 0);
}

function setAuthScreen(visible) {
  $('#auth-screen').classList.toggle('is-hidden', !visible);
  $('#app-shell').classList.toggle('is-hidden', visible);
  if (!visible) $('#app-main').focus({ preventScroll: true });
}

function setAuthMode(mode) {
  appState.authMode = mode;
  const isSignup = mode === 'signup';
  $('#auth-kicker').textContent = isSignup ? 'Start your money story' : 'Welcome back';
  $('#auth-title').textContent = isSignup ? 'Create your Northstar' : 'Sign in to Northstar';
  $('#auth-description').textContent = isSignup ? 'A clearer view of your money is a few details away.' : 'Your financial picture is waiting for you.';
  $('#name-field').classList.toggle('is-hidden', !isSignup);
  $('#auth-name').required = isSignup;
  $('#auth-password').autocomplete = isSignup ? 'new-password' : 'current-password';
  $('#auth-submit-label').textContent = isSignup ? 'Create workspace' : 'Sign in';
  $('#auth-switch-copy').textContent = isSignup ? 'Already have a workspace?' : 'New to Northstar?';
  $('[data-auth-action="toggle"]').textContent = isSignup ? 'Sign in instead' : 'Create an account';
  $('#auth-message').textContent = '';
}

async function hashPassword(password) {
  if (window.crypto?.subtle) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return btoa(unescape(encodeURIComponent(password)));
}

function loadWorkspace(user) {
  appState.user = user;
  const stored = readStorage(STORAGE.data(user.id));
  appState.data = stored?.schemaVersion ? stored : createSeedData(user);
  if (!stored) saveData();
  setAuthScreen(false);
  if (!window.location.hash) window.location.hash = '#dashboard';
  else render();
}

function ensureDemoSession() {
  const users = getUsers();
  let demo = users.find((user) => user.id === 'demo_user');
  if (!demo) {
    demo = { id: 'demo_user', name: 'Alex Rivera', email: 'alex@northstar.app', passwordHash: 'local-demo' };
    saveUsers([...users, demo]);
  }
  const sessionId = readStorage(STORAGE.session);
  const currentUser = getUsers().find((user) => user.id === sessionId);
  loadWorkspace(currentUser || demo);
  if (!sessionId) writeStorage(STORAGE.session, demo.id);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.target.closest('#auth-form') || event.currentTarget;
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const message = $('#auth-message');
  message.textContent = '';
  if (!email || !email.includes('@')) { message.textContent = 'Enter a valid email address.'; return; }
  if (password.length < 8) { message.textContent = 'Use at least 8 characters for your password.'; return; }
  const users = getUsers();
  const passwordHash = await hashPassword(password);
  if (appState.authMode === 'signup') {
    if (name.length < 2) { message.textContent = 'Tell us your name so we can personalize your workspace.'; return; }
    if (users.some((user) => user.email === email)) { message.textContent = 'That email already has a workspace. Try signing in instead.'; return; }
    const user = { id: uid('user'), name, email, passwordHash };
    saveUsers([...users, user]);
    writeStorage(STORAGE.session, user.id);
    loadWorkspace(user);
    showToast('Your workspace is ready. Welcome to Northstar.');
    return;
  }
  const user = users.find((candidate) => candidate.email === email);
  if (!user || user.passwordHash !== passwordHash) { message.textContent = 'We could not match that email and password.'; return; }
  writeStorage(STORAGE.session, user.id);
  loadWorkspace(user);
  showToast('Welcome back.');
}

function signOut() {
  writeStorage(STORAGE.session, null);
  writeStorage(STORAGE.firstRun, true);
  appState.user = null;
  appState.data = null;
  closeModal();
  closeProfileMenu();
  setAuthMode('login');
  $('#auth-email').value = '';
  $('#auth-password').value = '';
  setAuthScreen(true);
}

function openModal(content) {
  const layer = $('#modal-layer');
  modalOpener = document.activeElement;
  layer.innerHTML = content;
  layer.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => layer.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus(), 40);
}

function closeModal() {
  const layer = $('#modal-layer');
  layer.classList.remove('is-open');
  layer.innerHTML = '';
  document.body.style.overflow = '';
  if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  modalOpener = null;
}

function modalFrame(title, description, body, className = '') {
  return `<div class="modal-card ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close dialog">×</button></div>${body}</div>`;
}

function openTransactionModal(id = '') {
  const existing = appState.data.transactions.find((transaction) => transaction.id === id);
  const isEdit = Boolean(existing);
  const transaction = existing || { merchant: '', amountMinor: '', type: 'expense', categoryId: 'groceries', accountId: appState.data.accounts[0]?.id, date: toISO(nowDate()), note: '' };
  const body = `<form data-form="transaction" novalidate><input type="hidden" name="id" value="${escapeHTML(id)}" /><div class="form-grid"><div class="field-group full"><label for="transaction-merchant">Merchant or source</label><input id="transaction-merchant" data-autocategorize="true" name="merchant" type="text" value="${escapeHTML(transaction.merchant)}" placeholder="e.g. Whole Foods" required /></div><div class="field-group"><label for="transaction-amount">Amount</label><input id="transaction-amount" name="amount" type="number" min="0.01" step="0.01" value="${transaction.amountMinor ? amountForInput(transaction.amountMinor) : ''}" placeholder="0.00" required /></div><div class="field-group"><label for="transaction-type">Type</label><select id="transaction-type" name="type"><option value="expense" ${transaction.type === 'expense' ? 'selected' : ''}>Expense</option><option value="income" ${transaction.type === 'income' ? 'selected' : ''}>Income</option></select></div><div class="field-group"><label for="transaction-category">Category</label><select id="transaction-category" name="categoryId">${categoryOptions(transaction.categoryId, true)}</select></div><div class="field-group"><label for="transaction-account">Account</label><select id="transaction-account" name="accountId">${accountOptions(transaction.accountId)}</select></div><div class="field-group full"><label for="transaction-date">Date</label><input id="transaction-date" name="date" type="date" value="${escapeHTML(transaction.date)}" required /></div><div class="field-group full"><label for="transaction-note">Note <span class="optional-label">Optional</span></label><textarea id="transaction-note" name="note" placeholder="Add context for future you">${escapeHTML(transaction.note || '')}</textarea></div></div><p class="modal-error" data-modal-error></p><div class="modal-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${isEdit ? 'Save changes' : 'Add transaction'} <b>↗</b></button></div></form>`;
  openModal(modalFrame(isEdit ? 'Edit transaction' : 'Add a transaction', 'Keep the details light. You can always refine them later.', body));
}

function openSubscriptionModal() {
  const body = `<form data-form="subscription" novalidate><div class="form-grid"><div class="field-group full"><label for="subscription-name">Subscription name</label><input id="subscription-name" name="name" type="text" placeholder="e.g. Calm, Netflix, gym" required /></div><div class="field-group"><label for="subscription-amount">Amount</label><input id="subscription-amount" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></div><div class="field-group"><label for="subscription-cycle">Billing cycle</label><select id="subscription-cycle" name="billingCycle"><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="weekly">Weekly</option></select></div><div class="field-group"><label for="subscription-category">Category</label><select id="subscription-category" name="categoryId">${categoryOptions('utilities')}</select></div><div class="field-group"><label for="subscription-due">Next charge</label><input id="subscription-due" name="nextDueDate" type="date" value="${dateInCurrentMonth(25)}" required /></div></div><p class="modal-error" data-modal-error></p><div class="modal-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Save subscription <b>↗</b></button></div></form>`;
  openModal(modalFrame('Add a subscription', 'Northstar will remind you before the next quiet charge lands.', body));
}

function openGoalModal() {
  const body = `<form data-form="goal" novalidate><div class="form-grid"><div class="field-group full"><label for="goal-name">What are you working toward?</label><input id="goal-name" name="name" type="text" placeholder="e.g. Emergency fund" required /></div><div class="field-group"><label for="goal-target">Target amount</label><input id="goal-target" name="target" type="number" min="1" step="0.01" placeholder="10000" required /></div><div class="field-group"><label for="goal-current">Already saved</label><input id="goal-current" name="current" type="number" min="0" step="0.01" value="0" /></div><div class="field-group full"><label for="goal-date">Target date</label><input id="goal-date" name="targetDate" type="date" value="${dateInCurrentMonth(28)}" required /></div></div><p class="modal-error" data-modal-error></p><div class="modal-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Create goal <b>↗</b></button></div></form>`;
  openModal(modalFrame('Create a savings goal', 'Give a future plan a name, a number and a little momentum.', body));
}

function openContributeModal(id) {
  const goal = appState.data.goals.find((candidate) => candidate.id === id);
  if (!goal) return;
  const body = `<form data-form="contribute" novalidate><input type="hidden" name="id" value="${escapeHTML(id)}" /><div class="field-group"><label for="contribution-amount">How much would you like to add?</label><input id="contribution-amount" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></div><p class="form-helper">${escapeHTML(goal.name)} is currently at ${getGoalPercent(goal)}%.</p><p class="modal-error" data-modal-error></p><div class="modal-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Add to goal <b>↗</b></button></div></form>`;
  openModal(modalFrame(`Add to ${escapeHTML(goal.name)}`, 'A small contribution is still a meaningful move.', body));
}

function openBudgetModal() {
  const body = `<form data-form="budget" novalidate><div class="form-grid"><div class="field-group"><label for="budget-category">Category</label><select id="budget-category" name="categoryId">${categoryOptions('groceries')}</select></div><div class="field-group"><label for="budget-amount">Monthly limit</label><input id="budget-amount" name="amount" type="number" min="1" step="0.01" placeholder="500" required /></div></div><p class="modal-error" data-modal-error></p><div class="modal-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Save budget <b>↗</b></button></div></form>`;
  openModal(modalFrame('Set a monthly budget', 'Choose a category and a limit that feels useful, not restrictive.', body));
}

function openSettingsModal() {
  const body = `<form data-form="settings" novalidate><div class="field-group"><label for="settings-name">Display name</label><input id="settings-name" name="name" type="text" value="${escapeHTML(appState.data.profile.name)}" required /></div><div class="field-group"><label for="settings-email">Email address</label><input id="settings-email" type="email" value="${escapeHTML(appState.data.profile.email)}" disabled /></div><div class="field-group"><label>Workspace storage</label><div class="data-chip positive">✓ Local browser storage · private to this device</div></div><p class="modal-error" data-modal-error></p><div class="modal-actions"><button class="button button-secondary" type="button" data-action="reset-workspace">Reset demo data</button><button class="button button-primary" type="submit">Save settings <b>↗</b></button></div></form>`;
  openModal(modalFrame('Workspace settings', 'Keep your profile and local workspace feeling like yours.', body));
}

function openSearchModal() {
  if (!appState.data) return;
  const body = `<div class="search-input-wrap"><span>⌕</span><input id="search-modal-input" type="search" placeholder="Search merchants, categories, notes..." autocomplete="off" /></div><div class="search-results" id="search-modal-results"><div class="empty-state"><strong>Search your money</strong><p>Try “coffee”, “travel” or a merchant name.</p></div></div>`;
  openModal(modalFrame('Find anything', 'Search across your transactions and get to the right detail quickly.', body, 'search-modal'));
}

function renderSearchResults(query = '') {
  const container = $('#search-modal-results');
  if (!container || !appState.data) return;
  const normalized = query.trim().toLowerCase();
  if (!normalized) { container.innerHTML = '<div class="empty-state"><strong>Search your money</strong><p>Try “coffee”, “travel” or a merchant name.</p></div>'; return; }
  const results = appState.data.transactions.filter((transaction) => `${transaction.merchant} ${transaction.note} ${getCategory(transaction.categoryId).name}`.toLowerCase().includes(normalized)).slice(0, 8);
  container.innerHTML = results.length ? results.map((transaction) => `<button class="search-result" type="button" data-action="search-transaction" data-id="${transaction.id}">${merchantIcon(transaction)}<span class="search-result-copy"><strong>${escapeHTML(transaction.merchant)}</strong><small>${escapeHTML(getCategory(transaction.categoryId).name)} · ${longDate(transaction.date)}</small></span><span class="activity-amount ${transaction.type}">${signedAmount(transaction)}</span></button>`).join('') : '<div class="empty-state"><strong>No matches yet</strong><p>Try another word or add a new transaction.</p></div>';
}

function openNotifications() {
  const active = appState.data.subscriptions.filter((subscription) => subscription.status === 'active').slice(0, 3);
  const body = `<div class="recommendation-list"><div class="recommendation-row"><span class="recommendation-number">✦</span><div><h4>Your monthly snapshot is ready</h4><p>You saved ${getTotals().savingsRate}% of incoming money this month. Keep the rhythm.</p></div></div>${active.map((subscription) => `<div class="recommendation-row"><span class="recommendation-number">◷</span><div><h4>${escapeHTML(subscription.name)} renews ${shortDate(subscription.nextDueDate)}</h4><p>${formatCurrency(subscription.amountMinor)} will be charged from your recurring plan.</p></div></div>`).join('')}</div><div class="modal-actions"><button class="button button-primary" type="button" data-action="close-modal">All caught up</button></div>`;
  openModal(modalFrame('Your latest signals', 'A few things Northstar thinks are worth seeing.', body));
}

function renderFilteredTransactionRows() {
  const search = ($('#transaction-search')?.value || '').trim().toLowerCase();
  const category = $('#transaction-category-filter')?.value || 'all';
  const type = $('#transaction-type-filter')?.value || 'all';
  const transactions = [...appState.data.transactions].sort((a, b) => b.date.localeCompare(a.date)).filter((transaction) => {
    const matchesSearch = !search || `${transaction.merchant} ${transaction.note} ${getCategory(transaction.categoryId).name}`.toLowerCase().includes(search);
    const matchesCategory = category === 'all' || transaction.categoryId === category;
    const matchesType = type === 'all' || transaction.type === type;
    return matchesSearch && matchesCategory && matchesType;
  });
  const container = $('#transaction-rows');
  if (!container) return;
  container.innerHTML = transactions.length ? transactions.map(renderTransactionRow).join('') : '<tr><td colspan="6"><div class="empty-state"><strong>No matching transactions</strong><p>Try a different search or clear the filters.</p></div></td></tr>';
}

function renderTransactionRow(transaction) {
  return `<tr><td><div class="merchant-cell">${merchantIcon(transaction)}<div class="merchant-copy"><strong>${escapeHTML(transaction.merchant)}</strong><small>${escapeHTML(getAccount(transaction.accountId).name)}</small></div></div></td><td>${longDate(transaction.date)}</td><td><span class="category-pill">${escapeHTML(getCategory(transaction.categoryId).name)}</span></td><td>${transaction.type === 'income' ? 'Incoming' : 'Completed'}</td><td class="amount-cell ${transaction.type}">${signedAmount(transaction)}</td><td><div class="row-menu"><button class="row-menu-button" type="button" data-action="toggle-row-menu" data-id="${transaction.id}" aria-label="More actions for ${escapeHTML(transaction.merchant)}">···</button><div class="row-menu-actions" data-menu-for="${transaction.id}" hidden><button type="button" data-action="edit-transaction" data-id="${transaction.id}">Edit</button><button type="button" data-action="delete-transaction" data-id="${transaction.id}">Delete</button></div></div></td></tr>`;
}

function closeSidebar() {
  const sidebar = $('#sidebar');
  sidebar.classList.remove('is-open');
  $('.sidebar-scrim').classList.remove('is-visible');
  if (window.innerWidth <= 680) {
    sidebar.setAttribute('aria-hidden', 'true');
    sidebar.inert = true;
    $('[data-action="open-sidebar"]')?.setAttribute('aria-expanded', 'false');
  }
}

function openSidebar() {
  const sidebar = $('#sidebar');
  sidebar.classList.add('is-open');
  $('.sidebar-scrim').classList.add('is-visible');
  sidebar.setAttribute('aria-hidden', 'false');
  sidebar.inert = false;
  $('[data-action="open-sidebar"]')?.setAttribute('aria-expanded', 'true');
}

function closeProfileMenu() {
  appState.profileMenuOpen = false;
  $('#profile-menu').hidden = true;
  $('[data-action="toggle-profile"]')?.setAttribute('aria-expanded', 'false');
}

function toggleProfileMenu() {
  appState.profileMenuOpen = !appState.profileMenuOpen;
  $('#profile-menu').hidden = !appState.profileMenuOpen;
  $('[data-action="toggle-profile"]')?.setAttribute('aria-expanded', String(appState.profileMenuOpen));
}

function showToast(message, type = 'success') {
  const region = $('#toast-region');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<strong>${type === 'error' ? '!' : '✓'}</strong><span>${escapeHTML(message)}</span>`;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function exportWorkspace() {
  const payload = { exportedAt: new Date().toISOString(), profile: appState.data.profile, accounts: appState.data.accounts, categories: appState.data.categories, transactions: appState.data.transactions, budgets: appState.data.budgets, subscriptions: appState.data.subscriptions, goals: appState.data.goals };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `northstar-workspace-${toISO(nowDate())}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Your workspace export is ready.');
}

async function handleFormSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const formData = new FormData(form);
  const error = $('[data-modal-error]', form);
  if (error) error.textContent = '';
  const fail = (message) => { if (error) error.textContent = message; };

  if (form.dataset.form === 'risk-analysis') {
    const values = {
      query: String(formData.get('query') || '').trim(),
      beforeDate: String(formData.get('beforeDate') || ''),
      afterDate: String(formData.get('afterDate') || ''),
      mode: String(formData.get('mode') || 'all'),
    };
    appState.risk.form = { ...appState.risk.form, ...values };
    if (!values.query) { appState.risk.status = 'error'; appState.risk.error = 'Enter a city, region or postal code to begin.'; render(); return; }
    if (!values.beforeDate || !values.afterDate || values.beforeDate >= values.afterDate) { appState.risk.status = 'error'; appState.risk.error = 'Choose a before date earlier than the after date.'; render(); return; }
    if (values.afterDate > toISO(nowDate())) { appState.risk.status = 'error'; appState.risk.error = 'Choose an after date of today or earlier so the satellite service has a chance to have imagery.'; render(); return; }
    analyzeRisk(values);
    return;
  }

  if (form.dataset.form === 'transaction') {
    const merchant = String(formData.get('merchant') || '').trim();
    const amountMinor = parseMoney(formData.get('amount'));
    if (!merchant) { fail('Add a merchant or source so this entry is easy to recognize.'); return; }
    if (amountMinor <= 0) { fail('Enter an amount greater than zero.'); return; }
    const id = String(formData.get('id') || '');
    const existing = appState.data.transactions.find((transaction) => transaction.id === id);
    const transaction = { id: id || uid('tx'), merchant, amountMinor, type: formData.get('type') === 'income' ? 'income' : 'expense', categoryId: String(formData.get('categoryId') || 'other'), accountId: String(formData.get('accountId') || appState.data.accounts[0].id), date: String(formData.get('date') || toISO(nowDate())), note: String(formData.get('note') || '').trim(), createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (existing) appState.data.transactions = appState.data.transactions.map((candidate) => candidate.id === id ? transaction : candidate);
    else appState.data.transactions.unshift(transaction);
    saveData(); closeModal(); render(); showToast(existing ? 'Transaction updated.' : 'Transaction added.');
  }

  if (form.dataset.form === 'subscription') {
    const name = String(formData.get('name') || '').trim();
    const amountMinor = parseMoney(formData.get('amount'));
    if (!name) { fail('Name this recurring payment so it is easy to spot.'); return; }
    if (amountMinor <= 0) { fail('Enter an amount greater than zero.'); return; }
    appState.data.subscriptions.push({ id: uid('sub'), name, amountMinor, billingCycle: String(formData.get('billingCycle') || 'monthly'), nextDueDate: String(formData.get('nextDueDate') || dateInCurrentMonth(25)), categoryId: String(formData.get('categoryId') || 'utilities'), status: 'active' });
    saveData(); closeModal(); render(); showToast(`${name} is now on your radar.`);
  }

  if (form.dataset.form === 'goal') {
    const name = String(formData.get('name') || '').trim();
    const targetMinor = parseMoney(formData.get('target'));
    const currentMinor = parseMoney(formData.get('current'));
    if (!name) { fail('Give your goal a name.'); return; }
    if (targetMinor <= 0) { fail('Set a target greater than zero.'); return; }
    if (currentMinor < 0) { fail('Already saved cannot be negative.'); return; }
    if (currentMinor > targetMinor) { fail('Already ahead? Set the current amount below the target for now.'); return; }
    appState.data.goals.push({ id: uid('goal'), name, targetMinor, currentMinor, targetDate: String(formData.get('targetDate') || dateInCurrentMonth(28)), color: ['green', 'lavender', 'peach'][appState.data.goals.length % 3], icon: ['⌁', '◇', '✦'][appState.data.goals.length % 3] });
    saveData(); closeModal(); render(); showToast(`${name} is ready for its first milestone.`);
  }

  if (form.dataset.form === 'contribute') {
    const goal = appState.data.goals.find((candidate) => candidate.id === String(formData.get('id')));
    const amountMinor = parseMoney(formData.get('amount'));
    if (!goal) return;
    if (amountMinor <= 0) { fail('Enter an amount greater than zero.'); return; }
    goal.currentMinor = Math.min(goal.targetMinor, goal.currentMinor + amountMinor);
    saveData(); closeModal(); render(); showToast(`${formatCurrency(amountMinor)} added to ${goal.name}.`);
  }

  if (form.dataset.form === 'budget') {
    const categoryId = String(formData.get('categoryId') || 'groceries');
    const limitMinor = parseMoney(formData.get('amount'));
    if (limitMinor <= 0) { fail('Set a monthly limit greater than zero.'); return; }
    const current = appState.data.budgets.find((budget) => budget.categoryId === categoryId && budget.month === monthKey());
    if (current) current.limitMinor = limitMinor;
    else appState.data.budgets.push({ id: uid('budget'), categoryId, month: monthKey(), limitMinor });
    saveData(); closeModal(); render(); showToast(`${getCategory(categoryId).name} budget saved.`);
  }

  if (form.dataset.form === 'settings') {
    const name = String(formData.get('name') || '').trim();
    if (name.length < 2) { fail('Use at least two characters for your display name.'); return; }
    appState.data.profile.name = name;
    appState.user.name = name;
    saveUsers(getUsers().map((user) => user.id === appState.user.id ? { ...user, name } : user));
    saveData(); closeModal(); render(); showToast('Settings saved.');
  }
}

function handleClick(event) {
  const routeButton = event.target.closest('[data-route]');
  if (routeButton) {
    window.location.hash = `#${routeButton.dataset.route}`;
    closeProfileMenu();
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === 'open-sidebar') openSidebar();
  if (action === 'close-sidebar') closeSidebar();
  if (action === 'toggle-profile') toggleProfileMenu();
  if (action === 'open-search') { closeProfileMenu(); openSearchModal(); }
  if (action === 'show-notifications') { closeProfileMenu(); openNotifications(); }
  if (action === 'close-modal') closeModal();
  if (action === 'add-transaction') openTransactionModal();
  if (action === 'edit-transaction') openTransactionModal(actionButton.dataset.id);
  if (action === 'delete-transaction') {
    const transaction = appState.data.transactions.find((candidate) => candidate.id === actionButton.dataset.id);
    if (transaction && window.confirm(`Delete ${transaction.merchant}?`)) { appState.data.transactions = appState.data.transactions.filter((candidate) => candidate.id !== transaction.id); saveData(); render(); showToast('Transaction deleted.'); }
  }
  if (action === 'toggle-row-menu') {
    $$('[data-menu-for]').forEach((menu) => { menu.hidden = menu.dataset.menuFor !== actionButton.dataset.id; });
  }
  if (action === 'clear-filters') { const search = $('#transaction-search'); const category = $('#transaction-category-filter'); const type = $('#transaction-type-filter'); if (search) search.value = ''; if (category) category.value = 'all'; if (type) type.value = 'all'; renderFilteredTransactionRows(); }
  if (action === 'add-subscription') openSubscriptionModal();
  if (action === 'add-goal') openGoalModal();
  if (action === 'contribute-goal') openContributeModal(actionButton.dataset.id);
  if (action === 'add-budget') openBudgetModal();
  if (action === 'retry-risk') analyzeRisk(appState.risk.form);
  if (action === 'refresh-insight') { appState.insightIndex += 1; render(); showToast('Fresh signal generated from your latest activity.'); }
  if (action === 'open-settings') { closeProfileMenu(); openSettingsModal(); }
  if (action === 'export-data') { closeProfileMenu(); exportWorkspace(); }
  if (action === 'sign-out') signOut();
  if (action === 'reset-workspace' && window.confirm('Reset this workspace to the original demo data? Your custom changes will be removed.')) { appState.data = createSeedData(appState.user); saveData(); closeModal(); render(); showToast('Demo workspace reset.'); }
  if (action === 'search-transaction' && appState.data) { closeModal(); window.location.hash = '#transactions'; window.setTimeout(() => { const search = $('#transaction-search'); if (search) { search.value = actionButton.querySelector('.search-result-copy strong')?.textContent || ''; renderFilteredTransactionRows(); search.focus(); } }, 50); }
  if (action === 'forgot') { $('#auth-message').textContent = 'For this local demo, create a new account or continue with the demo workspace.'; }
  if (action === 'toggle') setAuthMode(appState.authMode === 'login' ? 'signup' : 'login');
  if (action === 'demo') { const demo = getUsers().find((user) => user.id === 'demo_user'); if (demo) { writeStorage(STORAGE.session, demo.id); loadWorkspace(demo); showToast('Demo workspace loaded.'); } }
}

function handleInput(event) {
  if (event.target.id === 'search-modal-input') renderSearchResults(event.target.value);
  if (['transaction-search', 'transaction-category-filter', 'transaction-type-filter'].includes(event.target.id)) renderFilteredTransactionRows();
  if (event.target.dataset.autocategorize === 'true') {
    const category = $('#transaction-category');
    const type = $('#transaction-type');
    if (category && type?.value === 'expense') category.value = suggestCategory(event.target.value);
  }
}

function handleKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && appState.data) { event.preventDefault(); openSearchModal(); }
  const modal = $('#modal-layer');
  if (event.key === 'Tab' && modal.classList.contains('is-open')) {
    const focusable = $$('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])', modal).filter((element) => element.offsetParent !== null);
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  if (event.key === 'Escape') { closeModal(); closeSidebar(); closeProfileMenu(); }
}

document.addEventListener('click', handleClick);
document.addEventListener('submit', (event) => event.target.id === 'auth-form' ? handleAuthSubmit(event) : handleFormSubmit(event));
document.addEventListener('input', handleInput);
document.addEventListener('change', handleInput);
document.addEventListener('keydown', handleKeydown);
document.addEventListener('click', (event) => {
  if (appState.profileMenuOpen && !event.target.closest('.profile-trigger') && !event.target.closest('.profile-menu')) closeProfileMenu();
  if (!event.target.closest('.row-menu')) $$('[data-menu-for]').forEach((menu) => { menu.hidden = true; });
});
window.addEventListener('hashchange', render);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE.data(appState.user?.id)) { appState.data = readStorage(STORAGE.data(appState.user.id), appState.data); render(); showToast('Workspace synced from another tab.'); }
});

function boot() {
  setAuthMode('login');
  const sessionId = readStorage(STORAGE.session);
  const user = getUsers().find((candidate) => candidate.id === sessionId);
  if (user) loadWorkspace(user);
  else if (!readStorage(STORAGE.firstRun, false)) { writeStorage(STORAGE.firstRun, true); ensureDemoSession(); }
  else setAuthScreen(true);
}

boot();
