/* Delivery Car Finder (public, static).
   Every number on the page is worked out here, in the browser, from the visitor's own inputs and the car list
   in data/cars.json (written by tools/export_public_app.py). The math matches the app's delivery.py:
   weekly earnings, miles, gas, maintenance, insurance and registration, then taxes, then living costs. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => (n < 0 ? "-" : "") + "$" + Math.round(Math.abs(n)).toLocaleString();
const money2 = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toFixed(2);
const signed = (n) => (Math.round(n) > 0 ? "+" : "") + money(n);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------------- Inputs ---------------- */
// [key, label, default, step, unit, help]
const GROUPS = [
  ["Earnings & volume", "fa-sack-dollar", [
    ["deliveries", "Deliveries per week", 40, 1, "", ""],
    ["pay", "Pay per delivery (with tips)", 9, 0.25, "$", "Your weekly earnings ÷ deliveries."],
    ["per_hour", "Deliveries per hour", 2, 0.1, "", "For the per-hour figures."],
    ["miles_per", "Miles per delivery", 7, 0.5, "mi", "Pickup + drop-off + driving back. Rural areas run higher."],
    ["base_miles", "Other miles per week", 40, 5, "mi", "Driving to hot spots, personal trips you'd count."],
  ]],
  ["Car running costs", "fa-gas-pump", [
    ["gas", "Gas price", 5.25, 0.05, "$/gal", ""],
    ["insurance", "Insurance per month", 120, 5, "$", "Liability + delivery endorsement for a typical car. Adjusted per car type."],
    ["maint", "Maintenance per mile", "", 0.01, "$", "Leave blank to estimate per car from its reliability and miles."],
    ["sales_tax", "Sales tax when buying", 9.25, 0.25, "%", "Ridgecrest/Kern County is 9.25%."],
  ]],
  ["Living costs & taxes", "fa-house", [
    ["tax_rate", "Tax set-aside", 20, 1, "%", "Of earnings after the mileage deduction. Self-employment tax alone is 15.3%."],
    ["mileage_rate", "Mileage deduction", 0.70, 0.005, "$/mi", "IRS standard rate. Check the current year's rate."],
    ["bills", "Monthly bills paid from driving", 600, 25, "$", "Food, phone, utilities, rent share, support: whatever comes out of this income."],
    ["cushion", "Cushion kept back", 35, 5, "%", "Share of what's left you keep for repairs and slow weeks before a car payment."],
  ]],
];
const FIELDS = GROUPS.flatMap(([, , f]) => f);
const DEFAULTS = Object.fromEntries(FIELDS.map(([k, , d]) => [k, d]));

function readInputs() {
  const out = {};
  for (const [k, , d] of FIELDS) {
    const raw = $(`#in-${k}`).value.trim();
    const v = parseFloat(raw);
    out[k] = raw === "" ? (d === "" ? null : d) : isFinite(v) && v >= 0 ? v : d === "" ? null : d;
  }
  out.deliveries = Math.max(1, Math.round(out.deliveries));
  out.per_hour = Math.max(0.1, out.per_hour);
  return out;
}

function drawInputs(values) {
  $("#calc-fields").innerHTML = GROUPS.map(([title, icon, fields], gi) => `
    <fieldset class="vstack gap-2">
      <legend class="fs-6 fw-bold mb-1 ${gi ? "pt-2 border-top" : ""}"><i class="fa-solid ${icon} me-2 text-primary"></i>${title}</legend>
      ${fields.map(([k, label, d, step, unit, help]) => {
        const pre = unit === "$" ? '<span class="input-group-text">$</span>' : "";
        const post = unit && unit !== "$" ? `<span class="input-group-text">${esc(unit)}</span>` : "";
        return `<div><label class="form-label mb-1" for="in-${k}">${esc(label)}</label>
          <div class="input-group input-group-sm">${pre}<input class="form-control" id="in-${k}" name="${k}" type="number" inputmode="decimal"
            min="0" step="${step}" value="${esc(values[k] ?? "")}" placeholder="${d === "" ? "auto" : esc(d)}">${post}</div>
          ${help ? `<div class="form-text mt-1">${esc(help)}</div>` : ""}</div>`;
      }).join("")}
    </fieldset>`).join("");
}

/* ---------------- Per-car math ---------------- */
const MAINT_PER_MILE = { 0: 0.08, 1: 0.12, 2: 0.10, 3: 0.08, 4: 0.06, 5: 0.05 };
const INS_CLASS = [  // liability multiplier by type of car
  [["tesla"], "electric (Tesla)", 1.6],
  [["challenger", "charger", "mustang", "camaro", "corvette", "wrx", "gti"], "sporty", 1.45],
  [["audi", "bmw", "mercedes", "lexus", "acura", "infiniti", "volvo", "porsche"], "luxury brand", 1.3],
  [["f150", "f-150", "silverado", "ram", "tacoma", "tundra", "ranger", "4runner", "tahoe", "expedition"], "truck/SUV", 1.1],
];
function insMult(car) {
  const t = `${car.make} ${car.model} ${car.title}`.toLowerCase();
  for (const [words, label, m] of INS_CLASS) if (words.some((w) => t.includes(w))) return { label, m };
  return { label: "typical car", m: 1 };
}
// California transfer + first-year registration (approximate, like the private app's budget.dmv_fees).
function dmvFees(price) {
  const tif = price < 5000 ? 32 : price < 25000 ? 65 : price < 35000 ? 130 : price < 60000 ? 195 : 227;
  return price * 0.0065 + 74 + 34 + 15 + tif;
}

function carInputs(car, inp) {
  const b = car.budget || {};
  const score = car.reliability?.score || 0;
  const mpgCity = b.mpg_city || (b.mpg || 25) * 0.9;
  const maint = inp.maint ?? MAINT_PER_MILE[score] + ((car.mileage || 0) > 150000 ? 0.01 : 0);
  const ins = insMult(car);
  return {
    mpgCity, maint, electric: (b.fuel || "").toLowerCase() === "electric",
    insMonth: Math.round(inp.insurance * ins.m / 5) * 5, insLabel: ins.label,
    regYear: car.price * 0.0065 + 150,
    buy: car.price * (1 + inp.sales_tax / 100) + dmvFees(car.price),
  };
}

// One week at n deliveries.
function week(n, car, ci, inp) {
  const earn = n * inp.pay;
  const miles = n * inp.miles_per + inp.base_miles;
  const gas = miles / ci.mpgCity * inp.gas;
  const maint = miles * ci.maint;
  const ins = ci.insMonth * 12 / 52;
  const reg = ci.regYear / 52;
  const carCost = gas + maint + ins + reg;
  const profit = earn - carCost;
  const tax = Math.max(0, inp.tax_rate / 100 * (earn - miles * inp.mileage_rate));
  const net = profit - tax;
  const bills = inp.bills * 12 / 52;
  const left = net - bills;
  const leftMonth = left * 52 / 12;
  const safe = leftMonth > 0 ? Math.floor(leftMonth * (1 - inp.cushion / 100) / 25) * 25 : 0;
  const hours = n / inp.per_hour;
  return { n, earn, miles, gas, maint, ins, reg, carCost, profit, tax, net, bills, left, leftMonth, safe, hours,
    perHour: net / hours, cpm: carCost / miles, perDelivery: profit / n };
}

function metrics(car, inp) {
  const ci = carInputs(car, inp);
  const w = week(inp.deliveries, car, ci, inp);
  const first = (pred) => { for (let n = 1; n <= 300; n++) if (pred(week(n, car, ci, inp))) return n; return null; };
  return {
    ci, w,
    breakeven: first((x) => x.left >= 0),           // covers car costs, taxes and bills
    payoff: w.safe > 0 ? Math.ceil(ci.buy / w.safe) : null,
  };
}

/* ---------------- Data + state ---------------- */
let CARS = [];
let INP = { ...DEFAULTS };
let M = new Map();  // car id -> metrics
let sortCol = "net", sortDir = -1;

const params = new URLSearchParams(location.search);
const fromUrl = Object.fromEntries(FIELDS.filter(([k]) => params.has(k)).map(([k]) => [k, params.get(k)]));
drawInputs({ ...DEFAULTS, ...(store.get("inputs") || {}), ...fromUrl });

function recompute() {
  INP = readInputs();
  M = new Map(CARS.map((c) => [c.id, metrics(c, INP)]));
  const saved = {};
  for (const [k] of FIELDS) saved[k] = $(`#in-${k}`).value;
  store.set("inputs", saved);
  drawSummary();
  drawCars();
  drawCompare();
  if (openCarId != null) drawCarModal(openCarId);
}

/* ---------------- Summary strip ---------------- */
function drawSummary() {
  const i = INP;
  const ranked = CARS.map((c) => [c, M.get(c.id)]).sort((a, b) => b[1].w.net - a[1].w.net);
  const best = ranked[0];
  const chip = (icon, text) => `<span class="badge rounded-pill text-bg-light border me-1 mb-1 fw-semibold"><i class="fa-solid ${icon} me-1"></i>${text}</span>`;
  $("#summary").innerHTML = `
    <div class="mb-2">${chip("fa-box", `${i.deliveries} deliveries/wk`)}${chip("fa-dollar-sign", `${money2(i.pay)} each`)}
      ${chip("fa-road", `${Math.round(i.deliveries * i.miles_per + i.base_miles)} mi/wk`)}${chip("fa-gas-pump", `${money2(i.gas)}/gal`)}
      ${chip("fa-shield-halved", `${money(i.insurance)}/mo insurance`)}${chip("fa-receipt", `${money(i.bills)}/mo bills`)}</div>
    ${best ? `<div class="small">Gross <b>${money(i.deliveries * i.pay)}/week</b>. Best car for these numbers:
      <a href="#" data-car="${best[0].id}" class="fw-semibold">${esc(best[0].title)}</a>, about
      <b class="${best[1].w.net < 0 ? "text-danger" : "text-success"}">${money(best[1].w.net)}/week</b> take-home after car costs and taxes
      (${money2(best[1].w.perHour)}/hr).</div>` : ""}`;
}

/* ---------------- Cars tab ---------------- */
function relDots(score) {
  return `<span class="rel-dots" title="Reliability ${score || "?"}/5">${[1, 2, 3, 4, 5].map((i) =>
    `<i class="fa-${i <= score ? "solid" : "regular"} fa-circle text-${score >= 4 ? "success" : score >= 3 ? "warning" : "danger"}" style="font-size:.6rem"></i>`).join(" ")}</span>`;
}
function sortValue(c, key) {
  const m = M.get(c.id);
  return { net: m.w.net, payoff: m.payoff ?? 1e9, cpm: m.w.cpm, price: c.price, rel: c.reliability?.score || 0,
    profit: m.w.profit, perHour: m.w.perHour, breakeven: m.breakeven ?? 1e9, safe: m.w.safe, mpg: m.ci.mpgCity,
    miles: c.mileage || 0, title: c.title }[key];
}
function filtered() {
  const q = $("#f-q").value.trim().toLowerCase();
  const max = +$("#f-max").value || Infinity;
  return CARS.filter((c) => c.price <= max && (!q || `${c.title} ${c.location} ${c.source}`.toLowerCase().includes(q)));
}
function drawCars() {
  const key = $("#f-sort").value;
  const asc = ["payoff", "cpm", "price"].includes(key);
  const cars = filtered().sort((a, b) => (asc ? 1 : -1) * (sortValue(a, key) - sortValue(b, key)));
  $("#f-count").textContent = `${cars.length} of ${CARS.length} cars`;
  $("#cars").innerHTML = cars.map((c) => {
    const m = M.get(c.id), w = m.w;
    const img = c.images[0];
    return `<div class="col"><article class="card car-card h-100 shadow-sm">
      <button type="button" class="car-photo ratio ratio-4x3 border-0 p-0 bg-body-secondary" data-car="${c.id}" aria-label="Details for ${esc(c.title)}">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" class="card-img-top">` : '<span class="d-flex align-items-center justify-content-center text-body-secondary"><i class="fa-solid fa-car-side fa-3x"></i></span>'}
        ${c.images.length > 1 ? `<span class="badge text-bg-dark position-absolute"><i class="fa-solid fa-images me-1"></i>${c.images.length}</span>` : ""}
      </button>
      <div class="card-body d-flex flex-column">
        <div class="d-flex justify-content-between gap-2">
          <h3 class="h6 mb-1"><a href="#" class="stretched-link-ish text-reset" data-car="${c.id}">${esc(c.title)}</a></h3>
          <span class="fw-bold text-nowrap">${money(c.price)}</span>
        </div>
        <div class="small text-body-secondary mb-2">${c.mileage ? `${c.mileage.toLocaleString()} mi · ` : ""}${esc(c.location)} · ${Math.round(m.ci.mpgCity)} MPG town ${relDots(c.reliability?.score)}</div>
        <div class="row g-2 text-center metric-tiles mt-auto">
          ${tile("Take-home", `${money(w.net)}<small>/wk</small>`, w.net < 0 ? "danger" : "success")}
          ${tile("Per hour", money2(w.perHour), w.perHour < 0 ? "danger" : "")}
          ${tile("Cost/mile", money2(w.cpm), "")}
          ${tile("Safe payment", w.safe ? `${money(w.safe)}<small>/mo</small>` : "$0", w.safe ? "" : "danger")}
        </div>
        <div class="small mt-2">${m.payoff ? `<i class="fa-solid fa-flag-checkered me-1 text-primary"></i>Paid off in about <b>${m.payoff} months</b> (${money(m.ci.buy)} with tax &amp; DMV)`
          : `<i class="fa-solid fa-triangle-exclamation me-1 text-danger"></i>Doesn't leave room for a payment at ${INP.deliveries}/wk${m.breakeven ? `; needs ${m.breakeven}+` : ""}`}</div>
      </div></article></div>`;
  }).join("") || '<div class="col-12 text-body-secondary">No cars match. Clear the search or raise the max price.</div>';
}
function tile(label, value, tone) {
  return `<div class="col-6"><div class="metric rounded-2 py-2 px-1"><div class="metric-label">${label}</div>
    <div class="metric-value ${tone ? `text-${tone}` : ""}">${value}</div></div></div>`;
}

/* ---------------- Compare tab ---------------- */
const COLS = [
  ["title", "Car", (c) => `<a href="#" data-car="${c.id}">${esc(c.title)}</a><div class="text-body-secondary">${esc(c.location)}</div>`],
  ["price", "Price", (c) => money(c.price)],
  ["miles", "Miles", (c) => (c.mileage ? `${Math.round(c.mileage / 1000)}k` : "–")],
  ["mpg", "MPG", (c, m) => Math.round(m.ci.mpgCity)],
  ["rel", "Rel.", (c) => `${c.reliability?.score || "?"}/5`],
  ["cpm", "Cost/mi", (c, m) => money2(m.w.cpm)],
  ["profit", "Profit/wk", (c, m) => money(m.w.profit)],
  ["net", "Take-home/wk", (c, m) => `<b class="${m.w.net < 0 ? "text-danger" : ""}">${money(m.w.net)}</b>`],
  ["perHour", "$/hr", (c, m) => money2(m.w.perHour)],
  ["breakeven", "Break-even", (c, m) => (m.breakeven ? `${m.breakeven}/wk` : "–")],
  ["safe", "Safe pmt", (c, m) => (m.w.safe ? `${money(m.w.safe)}/mo` : "$0")],
  ["payoff", "Paid off", (c, m) => (m.payoff ? `${m.payoff} mo` : "–")],
];
function drawCompare() {
  const cars = [...CARS].sort((a, b) => {
    const x = sortValue(a, sortCol), y = sortValue(b, sortCol);
    return sortDir * (typeof x === "string" ? x.localeCompare(y) : x - y);
  });
  $("#compare").innerHTML = `<thead class="table-light"><tr>${COLS.map(([k, label]) =>
      `<th scope="col" class="${k === "title" ? "" : "text-end"} text-nowrap" role="button" data-sort="${k}">${label}${k === sortCol ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
    <tbody>${cars.map((c) => { const m = M.get(c.id); return `<tr>${COLS.map(([k, , f]) => `<td class="${k === "title" ? "" : "text-end text-nowrap"}">${f(c, m)}</td>`).join("")}</tr>`; }).join("")}</tbody>`;
}
$("#compare").addEventListener("click", (e) => {
  const k = e.target.closest("[data-sort]")?.dataset.sort;
  if (!k) return;
  sortDir = k === sortCol ? -sortDir : ["price", "payoff", "cpm", "breakeven", "miles", "title"].includes(k) ? 1 : -1;
  sortCol = k;
  drawCompare();
});

/* ---------------- One car ---------------- */
let openCarId = null;
const carModal = new bootstrap.Modal("#car-modal");
$("#car-modal").addEventListener("hidden.bs.modal", () => { openCarId = null; });
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-car]");
  if (!el) return;
  e.preventDefault();
  openCarId = +el.dataset.car;
  drawCarModal(openCarId);
  carModal.show();
});

function drawCarModal(id) {
  const c = CARS.find((x) => x.id === id);
  if (!c) return;
  const m = M.get(id), ci = m.ci;
  const n = INP.deliveries;
  const tiers = [...new Set([Math.max(5, n - 10), n, n + 10, n + 20, m.breakeven].filter(Boolean))].sort((a, b) => a - b);
  const weeks = tiers.map((t) => week(t, c, ci, INP));
  const row = (label, f, cls = "") => `<tr class="${cls}"><th scope="row" class="fw-normal text-body-secondary">${label}</th>${weeks.map((w) =>
    `<td class="text-end ${w.n === n ? "table-primary" : ""}">${f(w)}</td>`).join("")}</tr>`;
  const neg = (v) => (v ? `-${money(v)}` : "$0");
  $("#car-modal-title").textContent = c.title;
  const photos = c.images.length ? `<div id="car-carousel" class="carousel slide mb-3 rounded overflow-hidden bg-dark">
      <div class="carousel-inner">${c.images.map((src, i) => `<div class="carousel-item ${i ? "" : "active"}"><img src="${esc(src)}" class="d-block w-100 modal-photo" alt="Photo ${i + 1} of ${esc(c.title)}" loading="lazy"></div>`).join("")}</div>
      ${c.images.length > 1 ? `<button class="carousel-control-prev" type="button" data-bs-target="#car-carousel" data-bs-slide="prev"><span class="carousel-control-prev-icon" aria-hidden="true"></span><span class="visually-hidden">Previous</span></button>
      <button class="carousel-control-next" type="button" data-bs-target="#car-carousel" data-bs-slide="next"><span class="carousel-control-next-icon" aria-hidden="true"></span><span class="visually-hidden">Next</span></button>` : ""}
    </div>` : "";
  const rel = c.reliability || {};
  $("#car-modal-body").innerHTML = `<div class="row g-4">
    <div class="col-lg-5">${photos}
      <dl class="row small mb-0">
        <dt class="col-5">Price</dt><dd class="col-7">${money(c.price)} <span class="text-body-secondary">(${money(ci.buy)} with ${INP.sales_tax}% tax &amp; DMV)</span></dd>
        <dt class="col-5">Miles</dt><dd class="col-7">${c.mileage ? c.mileage.toLocaleString() : "Not listed"}</dd>
        <dt class="col-5">Where</dt><dd class="col-7">${esc(c.location)}</dd>
        <dt class="col-5">Seller</dt><dd class="col-7">${esc(c.seller)} · ${esc(c.source)}</dd>
        ${c.vin ? `<dt class="col-5">VIN</dt><dd class="col-7"><code>${esc(c.vin)}</code> · <a href="https://www.nhtsa.gov/recalls?vin=${encodeURIComponent(c.vin)}" target="_blank" rel="noopener">recalls</a></dd>` : ""}
        <dt class="col-5">Fuel economy</dt><dd class="col-7">${Math.round(ci.mpgCity)} MPG in town${ci.electric ? " (gas-equivalent for charging cost)" : ""}</dd>
        <dt class="col-5">Insurance used</dt><dd class="col-7">${money(ci.insMonth)}/mo (${esc(ci.insLabel)})</dd>
        <dt class="col-5">Maintenance</dt><dd class="col-7">${money2(ci.maint)}/mile${INP.maint == null ? " (estimated)" : ""}</dd>
      </dl>
      <a class="btn btn-primary mt-3" href="${esc(c.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i>See the listing on ${esc(c.source)}</a>
      <div class="form-text">Listings sell fast. Last checked ${esc(DATA_DATE)}.</div>
    </div>
    <div class="col-lg-7">
      <h3 class="h6"><i class="fa-solid fa-calculator me-2 text-primary"></i>A week with this car</h3>
      <div class="table-responsive"><table class="table table-sm small align-middle">
        <thead class="table-light"><tr><th></th>${weeks.map((w) => `<th class="text-end ${w.n === n ? "table-primary" : ""}">${w.n}<div class="fw-normal text-body-secondary">${w.n === n ? "you" : w.n === m.breakeven ? "break-even" : "deliveries"}</div></th>`).join("")}</tr></thead>
        <tbody>
          ${row("Earnings", (w) => money(w.earn))}
          ${row("Miles", (w) => Math.round(w.miles).toLocaleString())}
          ${row(ci.electric ? "Charging" : "Gas", (w) => neg(w.gas))}
          ${row("Maintenance", (w) => neg(w.maint))}
          ${row("Insurance", (w) => neg(w.ins))}
          ${row("Registration", (w) => neg(w.reg))}
          ${row("Profit after car", (w) => `<b>${money(w.profit)}</b>`, "table-active")}
          ${row("Tax set-aside", (w) => neg(w.tax))}
          ${row("Take-home", (w) => `<b>${money(w.net)}</b>`)}
          ${row("Bills", (w) => neg(w.bills))}
          ${row("Left over", (w) => `<b class="${w.left < 0 ? "text-danger" : "text-success"}">${signed(w.left)}</b>`, "table-active")}
          ${row("Per hour", (w) => money2(w.perHour))}
          ${row("Safe payment", (w) => (w.safe ? `${money(w.safe)}/mo` : "$0"))}
        </tbody></table></div>
      <p class="small">${m.payoff ? `At ${n} deliveries a week you could set aside about <b>${money(m.w.safe)}/month</b>, which pays back the ${money(ci.buy)} in about <b>${m.payoff} months</b>.`
        : `At ${n} deliveries a week this car doesn't leave room for a payment.`}
        ${m.breakeven ? `It covers its own costs, taxes and your bills from <b>${m.breakeven} deliveries</b> a week.` : ""}</p>
      ${rel.summary ? `<h3 class="h6 mt-3"><i class="fa-solid fa-wrench me-2 text-primary"></i>Reliability ${relDots(rel.score)}</h3><p class="small">${esc(rel.summary)}</p>` : ""}
      ${(rel.issues || []).length ? `<div class="small fw-semibold">Known issues</div><ul class="small">${rel.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(rel.checks || []).length ? `<div class="small fw-semibold">Check before buying</div><ul class="small">${rel.checks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </div></div>`;
}

/* ---------------- Guide + about ---------------- */
const GUIDE = [
  ["Pick a car for delivery work", "fa-car-side", [
    "Gas is the biggest running cost. At 300+ miles a week, a 50 MPG hybrid saves $40–60 a week over a 25 MPG car.",
    "Reliability beats features: a day off the road costs a day of earnings. Toyota and Honda hybrids and compacts hold up best.",
    "Get an insurance quote with a delivery or rideshare endorsement before you buy. A personal policy alone usually won't cover delivery driving.",
    "Plan for 10–20% more miles than you expect: dead-heading back from drop-offs adds up.",
  ]],
  ["Desert-specific things to check", "fa-sun", [
    "A/C: let it run 15+ minutes at idle. It should stay ice cold.",
    "Cooling system: watch the temperature gauge on a long uphill; look for crusty residue around the radiator and hoses.",
    "Tires dry-rot in the sun even with good tread. Check sidewalls and the DOT date (older than about 6 years means new tires soon).",
    "Batteries die fast in heat. Ask how old it is, and for hybrids, get the hybrid battery scanned.",
  ]],
  ["Vetting a specific car", "fa-magnifying-glass", [
    "Check the VIN for open recalls (NHTSA) and run a history report for salvage, flood or odometer problems.",
    "Ask for maintenance records. No records on a high-mileage car means negotiate harder.",
    "Test drive from a cold start, at highway speed, up a hill and through a tight parking-lot turn.",
    "Always get a pre-purchase inspection (about $100–200) at a shop you choose.",
  ]],
  ["Buying in California", "fa-file-signature", [
    "Private sellers must give you a smog certificate from the last 90 days for most gas cars older than 8 model years.",
    "Get the signed title (pink slip), a bill of sale (REG 135), and make sure no lienholder is listed.",
    "You have 10 days to transfer the title at the DMV and pay use tax.",
    "At dealers, negotiate the out-the-door price in writing and decline add-ons. Under the CARS Act (since Oct 1, 2026), used cars $50k or less come with a 3-day return option.",
    "Never wire money or pay a deposit on a car you haven't seen.",
  ]],
];
$("#guide").innerHTML = GUIDE.map(([t, icon, items]) => `<div class="col"><div class="card shadow-sm h-100">
    <div class="card-header"><i class="fa-solid ${icon} me-2 text-primary"></i>${esc(t)}</div>
    <ul class="list-group list-group-flush">${items.map((i) => `<li class="list-group-item small">${esc(i)}</li>`).join("")}</ul></div></div>`).join("") +
  '<div class="col-12"><div class="form-text">General info, not legal advice. Confirm current rules at <a href="https://www.dmv.ca.gov" target="_blank" rel="noopener">dmv.ca.gov</a>.</div></div>';

function drawAbout() {
  $("#about").innerHTML = `
    <h2 class="h5">How the numbers work</h2>
    <p>Everything is worked out in your browser from the numbers in <b>Your numbers</b>. Change one and every car, table and total updates.</p>
    <ol class="small">
      <li><b>Earnings</b> = deliveries × pay per delivery.</li>
      <li><b>Miles</b> = deliveries × miles per delivery + other miles.</li>
      <li><b>Car costs</b> = gas (miles ÷ the car's city MPG × gas price) + maintenance (miles × per-mile rate) + insurance + registration.
        Maintenance is estimated from each car's reliability rating ($0.05–0.12/mile, +$0.01 over 150k miles) unless you enter your own.
        Insurance is your monthly figure scaled for the type of car (trucks, sporty and luxury cars cost more). Registration is about 0.65% of the price + $150 a year.</li>
      <li><b>Profit after car</b> = earnings − car costs. <b>Cost per mile</b> = car costs ÷ miles.</li>
      <li><b>Tax set-aside</b> = your rate × (earnings − miles × mileage deduction).</li>
      <li><b>Take-home</b> = profit − tax. <b>Per hour</b> = take-home ÷ (deliveries ÷ deliveries per hour).</li>
      <li><b>Left over</b> = take-home − your monthly bills (as a weekly amount).</li>
      <li><b>Safe payment</b> = what's left each month, minus your cushion, rounded down to $25. <b>Paid off</b> = price + sales tax + DMV fees ÷ safe payment.</li>
      <li><b>Break-even</b> = the fewest deliveries a week where take-home covers your bills.</li>
    </ol>
    <h2 class="h5 mt-4">About the cars</h2>
    <p class="small">The list is real listings from Craigslist, Facebook Marketplace, CarGurus and AutosToday around Ridgecrest, Lancaster/Palmdale and Bakersfield
      (Priuses out to the San Fernando Valley), hand-checked for reliability. It was last updated <b>${esc(DATA_DATE)}</b>, so some will have sold:
      always confirm with the seller. Private sellers' names and numbers aren't shown; use the listing link.</p>
    <p class="small mb-0">Estimates only. Not financial, tax or legal advice, and not affiliated with DoorDash or any listing site.</p>`;
}

/* ---------------- Wiring ---------------- */
let DATA_DATE = "";
$("#calc-form").addEventListener("input", recompute);
$("#calc-form").addEventListener("submit", (e) => e.preventDefault());
$("#calc-reset").addEventListener("click", () => { drawInputs(DEFAULTS); recompute(); toast("Back to the default numbers."); });
$("#calc-share").addEventListener("click", async () => {
  const u = new URL(location.href.split("?")[0].split("#")[0]);
  for (const [k] of FIELDS) { const v = $(`#in-${k}`).value.trim(); if (v !== "" && String(v) !== String(DEFAULTS[k])) u.searchParams.set(k, v); }
  try { await navigator.clipboard.writeText(u.href); toast("Link copied. Anyone who opens it sees your numbers."); }
  catch { prompt("Copy this link:", u.href); }
});
["#f-q", "#f-max", "#f-sort"].forEach((s) => $(s).addEventListener("input", drawCars));
$$('#tabs [data-bs-toggle="tab"]').forEach((b) => b.addEventListener("shown.bs.tab", () => store.set("tab", b.dataset.tab)));
const lastTab = store.get("tab");
if (lastTab) { const b = $(`#tabs [data-tab="${lastTab}"]`); if (b) bootstrap.Tab.getOrCreateInstance(b).show(); }

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast align-items-center border-0";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  $("#toasts").append(el);
  el.addEventListener("hidden.bs.toast", () => el.remove());
  new bootstrap.Toast(el, { delay: 3500 }).show();
}

(async function load() {
  const v = new URL(document.currentScript?.src || location.href).searchParams.get("v") || Date.now();
  try {
    const d = await (await fetch(`data/cars.json?v=${v}`)).json();
    CARS = d.cars;
    DATA_DATE = d.updated;
  } catch (e) {
    $("#cars").innerHTML = `<div class="col-12 text-danger">Couldn't load the car list (${esc(e.message)}). Try reloading.</div>`;
    return;
  }
  $("#data-date").textContent = `Listings updated ${DATA_DATE}`;
  drawAbout();
  recompute();
})();
