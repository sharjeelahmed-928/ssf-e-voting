/* ============================================================
   SSF E-Voting System — Frontend SPA (vanilla JS)
   ============================================================ */

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:5000/api"
  : "https://sharjeelssf928.pythonanywhere.com/api"; // Update after deploying backend to Render

const state = {
  token: localStorage.getItem("ssf_token") || null,
  member: null,
  ballotSelections: {},
};

/* ---------------------------- API layer ---------------------------- */

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (err) {
    toast("Network error. Please check your connection and try again.", "error");
    throw err;
  }

  let data = {};
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (res.status === 401 && state.token) {
    // session expired
    clearSession();
    toast("Your session has expired. Please log in again.", "error");
    navigate("login");
  }

  if (!res.ok) {
    const message = data.error || "Something went wrong. Please try again.";
    throw new Error(message);
  }
  return data;
}

/* ---------------------------- Toasts ---------------------------- */

function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fa-solid ${icon} mt-0.5"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s ease";
    setTimeout(() => el.remove(), 250);
  }, 4000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------- Session ---------------------------- */

function saveSession(token, member) {
  state.token = token;
  state.member = member;
  localStorage.setItem("ssf_token", token);
}

function clearSession() {
  state.token = null;
  state.member = null;
  localStorage.removeItem("ssf_token");
}

/* ---------------------------- Router ---------------------------- */

const PUBLIC_ROUTES = ["home", "activate", "login"];

const routes = {
  home: renderHome,
  activate: renderActivate,
  login: renderLogin,
  dashboard: renderDashboard,
  vote: renderVote,
  results: renderResults,
  "admin-elections": renderAdminElections,
  "admin-members": renderAdminMembers,
  "admin-wings": renderAdminWings,
  "admin-audit": renderAdminAudit,
  profile: renderProfile,
};

function navigate(route, params = {}) {
  window.location.hash = `${route}${params.id !== undefined ? `/${params.id}` : ""}`;
}

async function router() {
  const hash = window.location.hash.replace("#", "") || "home";
  const [route, param] = hash.split("/");
  const handler = routes[route] || renderHome;

  if (!PUBLIC_ROUTES.includes(route) && !state.token) {
    navigate("login");
    return;
  }

  updateChrome(route);

  const main = document.getElementById("app-main");
  main.innerHTML = `<div class="p-8 text-center text-ink/50"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i></div>`;
  try {
    await handler(main, param);
  } catch (err) {
    toast(err.message, "error");
    main.innerHTML = `<div class="p-8 text-center text-ink/50">Unable to load this page.</div>`;
  }
}

function updateChrome(route) {
  const header = document.getElementById("app-header");
  const sidebar = document.getElementById("sidebar");
  const loggedIn = !!state.token;

  header.classList.toggle("hidden", !loggedIn);
  sidebar.classList.toggle("hidden", !loggedIn);

  if (loggedIn && state.member) {
    document.getElementById("header-username").textContent = `${state.member.full_name} (${state.member.ssf_id})`;
    renderSidebar(route);
  }
}

function renderSidebar(activeRoute) {
  const isAdmin = state.member && ["admin", "super_admin"].includes(state.member.role);
  const links = [
    { route: "dashboard", label: "Dashboard", icon: "fa-gauge" },
    { route: "results", label: "Results", icon: "fa-chart-simple" },
    { route: "profile", label: "Profile", icon: "fa-user" },
  ];
  if (isAdmin) {
    links.push(
      { route: "admin-elections", label: "Elections", icon: "fa-boxes-stacked" },
      { route: "admin-members", label: "Voters", icon: "fa-users" },
      { route: "admin-wings", label: "Wings", icon: "fa-people-group" },
      { route: "admin-audit", label: "Audit Logs", icon: "fa-list-check" },
    );
  }
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML = links.map(l => `
    <a href="#${l.route}" class="sidebar-link ${activeRoute === l.route ? "active" : ""}">
      <i class="fa-solid ${l.icon} w-5 text-center"></i><span>${l.label}</span>
    </a>`).join("");
}

/* ---------------------------- Shared: wing helpers ---------------------------- */

let _wingsCache = null;

async function fetchWings(forceRefresh = false) {
  if (_wingsCache && !forceRefresh) return _wingsCache;
  _wingsCache = await api("/admin/wings");
  return _wingsCache;
}

function wingScopeOptionsHtml(wings, selectedWingId, selectedIsAllWings) {
  const allSelected = selectedIsAllWings ? "selected" : "";
  const wingOptions = wings.map(w => `
    <option value="${w.id}" ${!selectedIsAllWings && String(selectedWingId) === String(w.id) ? "selected" : ""}>${escapeHtml(w.name)}</option>
  `).join("");
  return `
    <option value="">Select a wing…</option>
    ${wingOptions}
    <option value="all" ${allSelected}>Both / All Wings</option>
  `;
}

/* ---------------------------- Views: Home / Auth ---------------------------- */

async function renderHome(main) {
  let electionBlock = `<div class="skeleton h-32 w-full max-w-md mx-auto"></div>`;
  const authButtons = state.token ? "" : `
    <div class="flex flex-wrap items-center justify-center gap-3 mb-8">
      <a href="#login" class="btn-gold px-6 py-2.5">Login</a>
      <a href="#activate" class="px-6 py-2.5 rounded-full border border-white/30 text-white hover:bg-white/10 transition">Activate Account</a>
      <a href="#login" class="px-6 py-2.5 rounded-full border border-white/30 text-white/70 hover:bg-white/10 transition text-sm">
        <i class="fa-solid fa-user-shield mr-1"></i>Admin Login
      </a>
    </div>`;
  main.innerHTML = `
    <section class="bg-ink text-white">
      <div class="max-w-5xl mx-auto px-4 py-20 text-center">
       <img src="ssf-logo.png" alt="SSF Logo" class="w-16 h-16 mx-auto rounded-full object-cover mb-6" />
        <h1 class="font-display text-3xl sm:text-5xl font-extrabold mb-3">Shikarpur Shagird Forum</h1>
        <p class="text-white/70 max-w-xl mx-auto mb-8">A secure, transparent, and modern platform for SSF elections — cast your vote from anywhere.</p>
        ${authButtons}
        <div id="election-banner">${electionBlock}</div>
      </div>
    </section>
    <section class="max-w-4xl mx-auto px-4 py-14 grid sm:grid-cols-3 gap-6 text-center">
      <div class="glass-card p-6"><i class="fa-solid fa-lock text-gold text-2xl mb-2"></i><p class="font-display font-semibold">Secure Voting</p><p class="text-sm text-ink/60 mt-1">Encrypted, one member, one vote.</p></div>
      <div class="glass-card p-6"><i class="fa-solid fa-eye-slash text-gold text-2xl mb-2"></i><p class="font-display font-semibold">Ballot Secrecy</p><p class="text-sm text-ink/60 mt-1">Your identity stays confidential.</p></div>
      <div class="glass-card p-6"><i class="fa-solid fa-bolt text-gold text-2xl mb-2"></i><p class="font-display font-semibold">Instant Results</p><p class="text-sm text-ink/60 mt-1">Automatic counting after close.</p></div>
    </section>
  `;

  try {
    // Note: /elections/public only ever returns an "all wings" election.
    // Wing-specific elections are intentionally invisible to anonymous
    // visitors and only appear once a member logs in (see renderDashboard).
    const data = await api("/elections/public");
    const banner = document.getElementById("election-banner");
    if (!data.election) {
      banner.innerHTML = `<div class="glass-card inline-block px-6 py-4 bg-white/10 text-white"><p>No active election is available.</p></div>`;
      return;
    }
    const e = data.election;
    let statusText = "";
    if (e.status === "upcoming" && e.start_time) {
      statusText = `<p class="text-sm text-white/70 mb-3">Voting starts in <span id="countdown" class="font-semibold text-gold"></span></p>`;
    } else if (e.status === "active") {
      statusText = `<p class="text-sm text-white/70 mb-3">Voting is open now.</p>`;
    }
    banner.innerHTML = `
      <div class="glass-card inline-block px-8 py-6 bg-white/5 border-white/10">
        <p class="font-display text-xl font-semibold text-gold mb-1">${escapeHtml(e.title)}</p>
        ${statusText}
        <button class="btn-gold px-6 py-2.5" onclick="navigate('${state.token ? "vote" : "login"}', {id: ${e.id}})">
          Vote Now <i class="fa-solid fa-arrow-right ml-1"></i>
        </button>
      </div>`;
    if (e.status === "upcoming" && e.start_time) startCountdown(e.start_time);
  } catch (err) {
    document.getElementById("election-banner").innerHTML = "";
  }
}

function startCountdown(isoTime) {
  const target = new Date(isoTime).getTime();
  const el = document.getElementById("countdown");
  if (!el) return;
  const tick = () => {
    const diff = target - Date.now();
    if (diff <= 0) { el.textContent = "Starting soon..."; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${d}d ${h}h ${m}m ${s}s`;
  };
  tick();
  setInterval(tick, 1000);
}

function renderActivate(main) {
  main.innerHTML = `
    <section class="max-w-md mx-auto px-4 py-16 w-full">
      <div class="glass-card p-8">
        <h2 class="font-display text-2xl font-bold mb-1">Activate Your Account</h2>
        <p class="text-sm text-ink/60 mb-6">Enter the SSF ID and Phone number issued by the organization.</p>
        <div id="activate-step-1">
          <label class="text-sm font-medium">SSF ID</label>
          <input id="act-ssf-id" class="input-field mt-1 mb-4" placeholder="SSF240001" />
          <label class="text-sm font-medium">Phone number</label>
          <input id="act-cnic" class="input-field mt-1 mb-6" placeholder="03XXXXXXXXX" />
          <button id="verify-btn" class="btn-gold w-full py-3">Verify</button>
        </div>
        <div id="activate-step-2" class="hidden"></div>
        <p class="text-center text-sm mt-6">Already activated? <a href="#login" class="text-gold font-semibold">Log in</a></p>
      </div>
    </section>`;

  document.getElementById("verify-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const ssf_id = document.getElementById("act-ssf-id").value.trim();
    const cnic = document.getElementById("act-cnic").value.trim();
    if (!ssf_id || !cnic) return toast("Please fill in both fields.", "error");
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Verifying...`;
    try {
      const data = await api("/auth/activate/verify", { method: "POST", body: { ssf_id, cnic } });
      toast(data.message, "success");
      showActivateStep2(ssf_id, cnic, data.full_name);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false; btn.textContent = "Verify";
    }
  });
}

function showActivateStep2(ssf_id, cnic, fullName) {
  document.getElementById("activate-step-1").classList.add("hidden");
  const step2 = document.getElementById("activate-step-2");
  step2.classList.remove("hidden");
  step2.innerHTML = `
    <p class="font-display font-semibold mb-4">Welcome, ${escapeHtml(fullName)}! Please create your password.</p>
    <label class="text-sm font-medium">Password</label>
    <input id="act-password" type="password" class="input-field mt-1 mb-2" />
    <div class="strength-bar mb-4"><div id="strength-fill" class="strength-fill" style="width:0%"></div></div>
    <label class="text-sm font-medium">Confirm Password</label>
    <input id="act-confirm" type="password" class="input-field mt-1 mb-4" />
    <label class="flex items-center gap-2 text-sm mb-6">
      <input type="checkbox" id="act-terms" /> I accept the Terms of Use.
    </label>
    <button id="activate-btn" class="btn-gold w-full py-3">Activate Account</button>
  `;
  document.getElementById("act-password").addEventListener("input", (e) => {
    document.getElementById("strength-fill").style.width = `${passwordStrength(e.target.value)}%`;
    document.getElementById("strength-fill").style.background = strengthColor(passwordStrength(e.target.value));
  });
  document.getElementById("activate-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const password = document.getElementById("act-password").value;
    const confirm_password = document.getElementById("act-confirm").value;
    const terms = document.getElementById("act-terms").checked;
    if (!terms) return toast("Please accept the Terms of Use.", "error");
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Activating...`;
    try {
      const data = await api("/auth/activate/complete", {
        method: "POST", body: { ssf_id, cnic, password, confirm_password },
      });
      toast(data.message, "success");
      navigate("login");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false; btn.textContent = "Activate Account";
    }
  });
}

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score += 25;
  if (/[A-Z]/.test(pw)) score += 25;
  if (/[a-z]/.test(pw) && /\d/.test(pw)) score += 25;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 25;
  return score;
}
function strengthColor(score) {
  if (score < 50) return "#b3261e";
  if (score < 100) return "#F5A300";
  return "#1f7a3f";
}

function renderLogin(main) {
  main.innerHTML = `
    <section class="max-w-md mx-auto px-4 py-16 w-full">
      <div class="glass-card p-8">
        <h2 class="font-display text-2xl font-bold mb-1">Member Login</h2>
        <p class="text-sm text-ink/60 mb-6">Sign in with your SSF ID and password.</p>
        <label class="text-sm font-medium">SSF ID</label>
        <input id="login-ssf-id" class="input-field mt-1 mb-4" placeholder="SSF240001" />
        <label class="text-sm font-medium">Password</label>
        <input id="login-password" type="password" class="input-field mt-1 mb-6" />
        <button id="login-btn" class="btn-gold w-full py-3">Login</button>
        <p class="text-center text-sm mt-6">New member? <a href="#activate" class="text-gold font-semibold">Activate your account</a></p>
      </div>
    </section>`;

  const submit = async () => {
    const btn = document.getElementById("login-btn");
    const ssf_id = document.getElementById("login-ssf-id").value.trim();
    const password = document.getElementById("login-password").value;
    if (!ssf_id || !password) return toast("Please enter your SSF ID and password.", "error");
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Logging in...`;
    try {
      const data = await api("/auth/login", { method: "POST", body: { ssf_id, password } });
      saveSession(data.token, data.member);
      toast(`Welcome back, ${data.member.full_name}!`, "success");
      navigate("dashboard");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false; btn.textContent = "Login";
    }
  };
  document.getElementById("login-btn").addEventListener("click", submit);
  document.getElementById("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

/* ---------------------------- Views: Member ---------------------------- */

async function renderDashboard(main) {
  // Uses /elections/mine (wing-filtered server-side) instead of the single
  // "latest election" lookup, since different wings can now have their own
  // elections running at the same time.
  const elections = await api("/elections/mine");
  main.innerHTML = `
    <section class="max-w-4xl mx-auto px-4 py-10 w-full">
      <h2 class="font-display text-2xl font-bold mb-6">Welcome, ${escapeHtml(state.member.full_name)}</h2>
      <div id="dash-content" class="space-y-4"></div>
    </section>`;
  const content = document.getElementById("dash-content");
  if (!elections.length) {
    content.innerHTML = `<div class="glass-card p-8 text-center text-ink/60">No active election is available right now.</div>`;
    return;
  }
  const statusLabel = { active: "Voting Open", upcoming: "Upcoming", closed: "Election has ended." };
  content.innerHTML = elections.map(e => `
    <div class="glass-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <p class="font-display font-semibold text-lg">${escapeHtml(e.title)}</p>
        <p class="text-sm text-ink/60">${escapeHtml(statusLabel[e.status] || e.status)}</p>
      </div>
      ${e.status === "active"
        ? `<button class="btn-gold px-6 py-2.5" onclick="navigate('vote', {id:${e.id}})">Cast Your Vote</button>`
        : e.status === "closed"
        ? `<button class="btn-gold px-6 py-2.5" onclick="navigate('results', {id:${e.id}})">View Results</button>`
        : `<span class="text-sm text-ink/50">Not open yet</span>`
      }
    </div>`).join("");
}

async function renderVote(main, electionId) {
  if (!electionId) return navigate("dashboard");
  let data;
  try {
    data = await api(`/elections/${electionId}/ballot`);
  } catch (err) {
    main.innerHTML = `<div class="max-w-lg mx-auto px-4 py-16 text-center glass-card"><p class="text-ink/70">${escapeHtml(err.message)}</p><button class="btn-gold px-6 py-2.5 mt-4" onclick="navigate('dashboard')">Back to Dashboard</button></div>`;
    return;
  }
  state.ballotSelections = {};

  main.innerHTML = `
    <section class="max-w-3xl mx-auto px-4 py-10 w-full">
      <h2 class="font-display text-2xl font-bold mb-1">${escapeHtml(data.title)}</h2>
      <p class="text-sm text-ink/60 mb-6">Select one candidate for each position. Your vote is confidential.</p>
      <div id="positions-list" class="space-y-8"></div>
      <button id="submit-vote-btn" class="btn-gold w-full py-3 mt-8" disabled>Review &amp; Submit Vote</button>
    </section>`;

  const list = document.getElementById("positions-list");
  data.positions.forEach(pos => {
    const block = document.createElement("div");
    block.className = "glass-card p-6";
    block.innerHTML = `
      <p class="font-display font-semibold text-lg mb-4">${escapeHtml(pos.title)}</p>
      <div class="grid sm:grid-cols-2 gap-4" id="pos-${pos.id}-candidates">
        ${pos.candidates.map(c => `
          <div class="candidate-card glass-card p-4 flex items-center gap-3" data-position="${pos.id}" data-candidate="${c.id}">
            <div class="w-12 h-12 rounded-full bg-lightgold flex items-center justify-center font-display font-bold">${escapeHtml(c.full_name.slice(0,1))}</div>
            <div>
              <p class="font-medium">${escapeHtml(c.full_name)}</p>
              ${c.bio ? `<p class="text-xs text-ink/50">${escapeHtml(c.bio)}</p>` : ""}
            </div>
          </div>`).join("")}
      </div>`;
    list.appendChild(block);
  });

  list.querySelectorAll(".candidate-card").forEach(card => {
    card.addEventListener("click", () => {
      const posId = card.dataset.position;
      document.querySelectorAll(`.candidate-card[data-position="${posId}"]`).forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      state.ballotSelections[posId] = card.dataset.candidate;
      const submitBtn = document.getElementById("submit-vote-btn");
      submitBtn.disabled = Object.keys(state.ballotSelections).length !== data.positions.length;
    });
  });

  document.getElementById("submit-vote-btn").addEventListener("click", () => confirmAndSubmitVote(electionId));
}

function confirmAndSubmitVote(electionId) {
  if (!confirm("Are you sure you want to submit your vote? This cannot be changed once submitted.")) return;
  submitVote(electionId);
}

async function submitVote(electionId) {
  const btn = document.getElementById("submit-vote-btn");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...`;
  try {
    const data = await api(`/elections/${electionId}/vote`, {
      method: "POST",
      body: { selections: state.ballotSelections },
    });
    toast(data.message, "success");
    navigate("dashboard");
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
    btn.textContent = "Review & Submit Vote";
  }
}

async function renderResults(main, electionId) {
  main.innerHTML = `<div class="max-w-4xl mx-auto px-4 py-10 w-full"><div class="skeleton h-64 w-full"></div></div>`;
  let id = electionId;
  if (!id) {
    // Fall back to whichever visible election (own wing or all-wings) is
    // most recent, instead of assuming there's only ever one election.
    // Admins aren't necessarily scoped to a single wing, so they need the
    // full elections list rather than the voter-facing /elections/mine.
    const isAdmin = state.member && ["admin", "super_admin"].includes(state.member.role);
    const mine = isAdmin ? await api("/admin/elections") : await api("/elections/mine");
    // Only fall back to a CLOSED election — results for an election that's
    // still upcoming/active aren't final and shouldn't be shown as if they were.
    const candidate = mine.find(e => e.status === "closed");
    if (!candidate) {
      main.innerHTML = `<div class="max-w-2xl mx-auto px-4 py-16 text-center text-ink/60">No election results are available.</div>`;
      return;
    }
    id = candidate.id;
  }
  let data;
  try {
    data = await api(`/elections/${id}/results`);
  } catch (err) {
    main.innerHTML = `<div class="max-w-2xl mx-auto px-4 py-16 text-center text-ink/60">${escapeHtml(err.message)}</div>`;
    return;
  }
  main.innerHTML = `
    <section class="max-w-4xl mx-auto px-4 py-10 w-full">
      <h2 class="font-display text-2xl font-bold mb-6">${escapeHtml(data.title)} — Results</h2>
      <div id="results-charts" class="grid sm:grid-cols-2 gap-6"></div>
    </section>`;
  const container = document.getElementById("results-charts");
  data.positions.forEach(pos => {
    const card = document.createElement("div");
    card.className = "glass-card p-6";
    card.innerHTML = `<p class="font-display font-semibold mb-3">${escapeHtml(pos.title)}</p><canvas></canvas>`;
    container.appendChild(card);
    const ctx = card.querySelector("canvas").getContext("2d");
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: pos.candidates.map(c => c.full_name),
        datasets: [{
          label: "Votes",
          data: pos.candidates.map(c => c.vote_count || 0),
          backgroundColor: "#F5A300",
          borderRadius: 6,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  });
}

async function renderProfile(main) {
  main.innerHTML = `
    <section class="max-w-md mx-auto px-4 py-10 w-full">
      <h2 class="font-display text-2xl font-bold mb-6">Your Profile</h2>
      <div class="glass-card p-6 space-y-3 text-sm">
        <div class="flex justify-between"><span class="text-ink/50">SSF ID</span><span class="font-medium">${escapeHtml(state.member.ssf_id)}</span></div>
        <div class="flex justify-between"><span class="text-ink/50">Full Name</span><span class="font-medium">${escapeHtml(state.member.full_name)}</span></div>
        <div class="flex justify-between"><span class="text-ink/50">Wing</span><span class="font-medium">${escapeHtml(state.member.wing_name || "—")}</span></div>
        <div class="flex justify-between"><span class="text-ink/50">Department</span><span class="font-medium">${escapeHtml(state.member.department || "—")}</span></div>
        <div class="flex justify-between"><span class="text-ink/50">Role</span><span class="font-medium capitalize">${escapeHtml(state.member.role)}</span></div>
      </div>
    </section>`;
}

/* ---------------------------- Views: Admin ---------------------------- */

async function renderAdminElections(main) {
  const [elections, wings] = await Promise.all([api("/admin/elections"), fetchWings()]);

  main.innerHTML = `
    <section class="max-w-5xl mx-auto px-4 py-10 w-full">
      <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 class="font-display text-2xl font-bold">Manage Elections</h2>
        <div class="flex items-center gap-2">
          <label class="text-sm text-ink/60">Filter by wing</label>
          <select id="election-wing-filter" class="input-field !w-auto text-sm">
            <option value="">All</option>
            ${wings.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join("")}
          </select>
          <button id="new-election-btn" class="btn-gold px-5 py-2.5"><i class="fa-solid fa-plus mr-1"></i>New Election</button>
        </div>
      </div>
      <div id="new-election-form" class="hidden glass-card p-6 mb-6">
        <input id="new-election-title" class="input-field mb-3" placeholder="Election title" />
        <textarea id="new-election-desc" class="input-field mb-3" placeholder="Description (optional)"></textarea>
        <label class="text-sm font-medium">Wing</label>
        <select id="new-election-wing" class="input-field mb-3">
          ${wingScopeOptionsHtml(wings, null, false)}
        </select>
        <button id="create-election-btn" class="btn-gold px-6 py-2.5">Create</button>
      </div>
      <div class="space-y-4" id="elections-list"></div>
    </section>`;

  function renderList(list) {
    document.getElementById("elections-list").innerHTML = list.map(e => `
      <div class="glass-card p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-display font-semibold">${escapeHtml(e.title)}</p>
            <p class="text-xs text-ink/50 uppercase tracking-wide">${escapeHtml(e.status)} &middot; ${escapeHtml(e.is_all_wings ? "All Wings" : (e.wing_name || "No wing assigned"))}</p>
          </div>
          <div class="flex gap-2 flex-wrap items-center">
            <select class="input-field !w-auto text-sm" onchange="changeElectionWingScope(${e.id}, this.value)">
              ${wingScopeOptionsHtml(wings, e.wing_id, e.is_all_wings)}
            </select>
            <select class="input-field !w-auto text-sm" onchange="changeElectionStatus(${e.id}, this.value)">
              ${["draft","upcoming","active","closed","archived"].map(s => `<option value="${s}" ${s === e.status ? "selected" : ""}>${s}</option>`).join("")}
            </select>
            <button class="text-sm text-gold font-semibold" onclick="manageElectionStructure(${e.id})">Positions &amp; Candidates</button>
            <button class="text-sm text-gold font-semibold" onclick="editElectionDetails(${e.id})">Edit</button>
            <button class="text-sm text-red-600 font-semibold" onclick="deleteElection(${e.id})">Delete</button>
          </div>
        </div>
        <div id="structure-${e.id}" class="mt-4 hidden"></div>
      </div>`).join("") || `<p class="text-ink/50 text-center py-10">No elections yet. Create one to get started.</p>`;
  }
  renderList(elections);

  document.getElementById("election-wing-filter").addEventListener("change", async (e) => {
    const wingId = e.target.value;
    const filtered = await api(`/admin/elections${wingId ? `?wing_id=${wingId}` : ""}`);
    renderList(filtered);
  });

  document.getElementById("new-election-btn").addEventListener("click", () => {
    document.getElementById("new-election-form").classList.toggle("hidden");
  });
  document.getElementById("create-election-btn").addEventListener("click", async () => {
    const title = document.getElementById("new-election-title").value.trim();
    const description = document.getElementById("new-election-desc").value.trim();
    const wingValue = document.getElementById("new-election-wing").value;
    if (!title) return toast("Election title is required.", "error");
    if (!wingValue) return toast("Please select a wing, or Both / All Wings.", "error");
    const body = { title, description };
    if (wingValue === "all") { body.is_all_wings = true; } else { body.is_all_wings = false; body.wing_id = Number(wingValue); }
    try {
      await api("/admin/elections", { method: "POST", body });
      toast("Election created.", "success");
      renderAdminElections(main);
    } catch (err) { toast(err.message, "error"); }
  });
}

async function changeElectionStatus(id, status) {
  try {
    await api(`/admin/elections/${id}/status`, { method: "POST", body: { status } });
    toast("Election status updated.", "success");
  } catch (err) { toast(err.message, "error"); }
}

async function changeElectionWingScope(id, wingValue) {
  if (!wingValue) return;
  const body = wingValue === "all" ? { is_all_wings: true } : { is_all_wings: false, wing_id: Number(wingValue) };
  try {
    await api(`/admin/elections/${id}`, { method: "PUT", body });
    toast("Election wing assignment updated.", "success");
  } catch (err) { toast(err.message, "error"); }
}

async function editElectionDetails(id) {
  const elections = await api("/admin/elections");
  const election = elections.find(e => e.id === id);
  if (!election) return;
  const title = prompt("Election title:", election.title);
  if (title === null) return;
  if (!title.trim()) return toast("Election title is required.", "error");
  const description = prompt("Election description:", election.description || "");
  if (description === null) return;
  try {
    await api(`/admin/elections/${id}`, { method: "PUT", body: { title: title.trim(), description: description.trim() } });
    toast("Election updated.", "success");
    router();
  } catch (err) { toast(err.message, "error"); }
}

async function deleteElection(id) {
  if (!confirm("Delete this election? This will also remove its positions and candidates. This cannot be undone.")) return;
  try {
    await api(`/admin/elections/${id}`, { method: "DELETE" });
    toast("Election deleted.", "success");
    router();
  } catch (err) { toast(err.message, "error"); }
}

async function manageElectionStructure(electionId) {
  const container = document.getElementById(`structure-${electionId}`);
  container.classList.toggle("hidden");
  if (container.dataset.loaded) return;
  container.dataset.loaded = "1";

  const elections = await api("/admin/elections");
  const election = elections.find(e => e.id === electionId);

  container.innerHTML = `
    <div class="border-t border-ink/10 pt-4 mt-2">
      <div class="flex gap-2 mb-4">
        <input id="pos-title-${electionId}" class="input-field" placeholder="New position title (e.g. President)" />
        <button class="btn-gold px-4" onclick="addPosition(${electionId})">Add</button>
      </div>
      <div id="positions-${electionId}" class="space-y-4">
        ${election.positions.map(p => `
          <div class="bg-white/70 rounded-lg p-4">
            <div class="flex items-center justify-between gap-2 mb-2">
              <p class="font-medium" id="pos-name-${p.id}">${escapeHtml(p.title)}</p>
              <div class="flex gap-2">
                <button class="text-xs text-gold font-semibold" onclick="editPosition(${p.id}, ${electionId})">Rename</button>
                <button class="text-xs text-red-600 font-semibold" onclick="deletePosition(${p.id}, ${electionId})">Delete</button>
              </div>
            </div>
            <div class="flex gap-2 mb-2">
              <input id="cand-name-${p.id}" class="input-field text-sm" placeholder="Candidate name" />
              <button class="btn-gold px-4 text-sm" onclick="addCandidate(${p.id}, ${electionId})">Add</button>
            </div>
            <ul class="text-sm text-ink/70 space-y-1">
              ${p.candidates.map(c => `
                <li class="flex items-center justify-between gap-2">
                  <span id="cand-display-${c.id}">${escapeHtml(c.full_name)}</span>
                  <span class="flex gap-2 text-xs shrink-0">
                    <button class="text-gold font-semibold" onclick="editCandidate(${c.id}, ${electionId})">Rename</button>
                    <button class="text-red-600 font-semibold" onclick="deleteCandidate(${c.id}, ${electionId})">Delete</button>
                  </span>
                </li>`).join("") || "<li>No candidates yet</li>"}
            </ul>
          </div>`).join("")}
      </div>
    </div>`;
}

async function addPosition(electionId) {
  const input = document.getElementById(`pos-title-${electionId}`);
  const title = input.value.trim();
  if (!title) return toast("Position title required.", "error");
  try {
    await api(`/admin/elections/${electionId}/positions`, { method: "POST", body: { title } });
    toast("Position added.", "success");
    document.getElementById(`structure-${electionId}`).dataset.loaded = "";
    manageElectionStructure(electionId);
  } catch (err) { toast(err.message, "error"); }
}

async function addCandidate(positionId, electionId) {
  const input = document.getElementById(`cand-name-${positionId}`);
  const full_name = input.value.trim();
  if (!full_name) return toast("Candidate name required.", "error");
  try {
    await api(`/admin/positions/${positionId}/candidates`, { method: "POST", body: { full_name } });
    toast("Candidate added.", "success");
    document.getElementById(`structure-${electionId}`).dataset.loaded = "";
    manageElectionStructure(electionId);
  } catch (err) { toast(err.message, "error"); }
}

async function editPosition(positionId, electionId) {
  const el = document.getElementById(`pos-name-${positionId}`);
  const current = el ? el.textContent : "";
  const title = prompt("Rename position:", current);
  if (!title || !title.trim() || title.trim() === current) return;
  try {
    await api(`/admin/positions/${positionId}`, { method: "PUT", body: { title: title.trim() } });
    toast("Position renamed.", "success");
    document.getElementById(`structure-${electionId}`).dataset.loaded = "";
    manageElectionStructure(electionId);
  } catch (err) { toast(err.message, "error"); }
}

async function deletePosition(positionId, electionId) {
  if (!confirm("Delete this position? All its candidates will be removed too.")) return;
  try {
    await api(`/admin/positions/${positionId}`, { method: "DELETE" });
    toast("Position deleted.", "success");
    document.getElementById(`structure-${electionId}`).dataset.loaded = "";
    manageElectionStructure(electionId);
  } catch (err) { toast(err.message, "error"); }
}

async function editCandidate(candidateId, electionId) {
  const el = document.getElementById(`cand-display-${candidateId}`);
  const current = el ? el.textContent : "";
  const full_name = prompt("Candidate name:", current);
  if (!full_name || !full_name.trim() || full_name.trim() === current) return;
  try {
    await api(`/admin/candidates/${candidateId}`, { method: "PUT", body: { full_name: full_name.trim() } });
    toast("Candidate updated.", "success");
    document.getElementById(`structure-${electionId}`).dataset.loaded = "";
    manageElectionStructure(electionId);
  } catch (err) { toast(err.message, "error"); }
}

async function deleteCandidate(candidateId, electionId) {
  if (!confirm("Remove this candidate?")) return;
  try {
    await api(`/admin/candidates/${candidateId}`, { method: "DELETE" });
    toast("Candidate removed.", "success");
    document.getElementById(`structure-${electionId}`).dataset.loaded = "";
    manageElectionStructure(electionId);
  } catch (err) { toast(err.message, "error"); }
}

async function renderAdminMembers(main) {
  const [members, wings] = await Promise.all([api("/admin/members"), fetchWings()]);

  main.innerHTML = `
    <section class="max-w-5xl mx-auto px-4 py-10 w-full">
      <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 class="font-display text-2xl font-bold">Registered Voters</h2>
        <div class="flex items-center gap-2 flex-wrap">
          <label class="text-sm text-ink/60">Filter by wing</label>
          <select id="member-wing-filter" class="input-field !w-auto text-sm">
            <option value="">All</option>
            ${wings.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join("")}
          </select>
          <label class="btn-gold px-4 py-2.5 cursor-pointer text-sm">
            <i class="fa-solid fa-file-csv mr-1"></i>Import CSV
            <input type="file" accept=".csv" class="hidden" id="csv-input" />
          </label>
          <button id="add-member-btn" class="btn-gold px-4 py-2.5 text-sm"><i class="fa-solid fa-user-plus mr-1"></i>Add Voter</button>
        </div>
      </div>
      <p class="text-xs text-ink/50 mb-4">CSV imports need a <code>wing</code> column matching a wing's name (e.g. "Male Wing").</p>
      <div id="add-member-form" class="hidden glass-card p-6 mb-6 grid sm:grid-cols-2 gap-3">
        <input id="m-ssf-id" class="input-field" placeholder="SSF ID (e.g. SSF240010)" />
        <input id="m-name" class="input-field" placeholder="Full name" />
        <input id="m-cnic" class="input-field" placeholder="Phone number" />
        <input id="m-dept" class="input-field" placeholder="Department" />
        <select id="m-wing" class="input-field sm:col-span-2">
          <option value="">Select a wing…</option>
          ${wings.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join("")}
        </select>
        <button id="save-member-btn" class="btn-gold py-2.5 sm:col-span-2">Register Voter</button>
      </div>
      <div class="glass-card overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-ink text-white text-left">
            <tr><th class="p-3">SSF ID</th><th class="p-3">Name</th><th class="p-3">Wing</th><th class="p-3">Department</th><th class="p-3">Activated</th><th class="p-3">Role</th><th class="p-3">Actions</th></tr>
          </thead>
          <tbody id="members-tbody"></tbody>
        </table>
      </div>
    </section>`;

  function renderRows(list) {
    document.getElementById("members-tbody").innerHTML = list.map(m => `
      <tr class="border-b border-ink/5">
        <td class="p-3 font-mono">${escapeHtml(m.ssf_id)}</td>
        <td class="p-3">${escapeHtml(m.full_name)}</td>
        <td class="p-3">
          <select class="input-field !w-auto text-xs" onchange="changeMemberWing(${m.id}, this.value)">
            ${wings.map(w => `<option value="${w.id}" ${m.wing_id === w.id ? "selected" : ""}>${escapeHtml(w.name)}</option>`).join("")}
          </select>
        </td>
        <td class="p-3">${escapeHtml(m.department || "—")}</td>
        <td class="p-3">${m.account_activated ? '<i class="fa-solid fa-circle-check text-green-600"></i>' : '<i class="fa-solid fa-circle-xmark text-ink/30"></i>'}</td>
        <td class="p-3 capitalize">${escapeHtml(m.role)}</td>
        <td class="p-3">
          <div class="flex gap-2">
            <button class="text-xs text-gold font-semibold" onclick="editMember(${m.id})">Edit</button>
            <button class="text-xs text-red-600 font-semibold" onclick="deleteMember(${m.id})">Delete</button>
          </div>
        </td>
      </tr>`).join("") || `<tr><td class="p-6 text-center text-ink/50" colspan="7">No voters registered yet.</td></tr>`;
  }
  renderRows(members);

  document.getElementById("member-wing-filter").addEventListener("change", async (e) => {
    const wingId = e.target.value;
    const filtered = await api(`/admin/members${wingId ? `?wing_id=${wingId}` : ""}`);
    renderRows(filtered);
  });

  document.getElementById("add-member-btn").addEventListener("click", () => {
    document.getElementById("add-member-form").classList.toggle("hidden");
  });
  document.getElementById("save-member-btn").addEventListener("click", async () => {
    const wingValue = document.getElementById("m-wing").value;
    if (!wingValue) return toast("Please assign this voter to a wing.", "error");
    const body = {
      ssf_id: document.getElementById("m-ssf-id").value.trim(),
      full_name: document.getElementById("m-name").value.trim(),
      cnic: document.getElementById("m-cnic").value.trim(),
      department: document.getElementById("m-dept").value.trim(),
      wing_id: Number(wingValue),
    };
    try {
      await api("/admin/members", { method: "POST", body });
      toast("Voter registered.", "success");
      renderAdminMembers(main);
    } catch (err) { toast(err.message, "error"); }
  });
  document.getElementById("csv-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const data = await api("/admin/members/import-csv", { method: "POST", body: form, isForm: true });
      toast(`Imported ${data.created} voters (${data.skipped} skipped).`, "success");
      if (data.errors && data.errors.length) toast(`${data.errors.length} row(s) had issues — check console.`, "error");
      if (data.errors && data.errors.length) console.warn("CSV import issues:", data.errors);
      renderAdminMembers(main);
    } catch (err) { toast(err.message, "error"); }
  });
}

async function changeMemberWing(memberId, wingId) {
  if (!wingId) return;
  try {
    await api(`/admin/members/${memberId}`, { method: "PUT", body: { wing_id: Number(wingId) } });
    toast("Voter's wing updated.", "success");
  } catch (err) { toast(err.message, "error"); }
}

async function editMember(memberId) {
  const members = await api("/admin/members");
  const m = members.find(x => x.id === memberId);
  if (!m) return;
  const full_name = prompt("Full name:", m.full_name);
  if (full_name === null) return;
  if (!full_name.trim()) return toast("Name is required.", "error");
  const cnic = prompt("Phone number:", m.cnic || "");
  if (cnic === null) return;
  const department = prompt("Department:", m.department || "");
  if (department === null) return;
  try {
    await api(`/admin/members/${memberId}`, {
      method: "PUT",
      body: { full_name: full_name.trim(), cnic: cnic.trim(), department: department.trim() },
    });
    toast("Voter updated.", "success");
    router();
  } catch (err) { toast(err.message, "error"); }
}

async function deleteMember(memberId) {
  if (!confirm("Delete this voter? This cannot be undone.")) return;
  try {
    await api(`/admin/members/${memberId}`, { method: "DELETE" });
    toast("Voter deleted.", "success");
    router();
  } catch (err) { toast(err.message, "error"); }
}

async function renderAdminWings(main) {
  const wings = await fetchWings(true);
  main.innerHTML = `
    <section class="max-w-3xl mx-auto px-4 py-10 w-full">
      <div class="flex items-center justify-between mb-6">
        <h2 class="font-display text-2xl font-bold">Manage Wings</h2>
        <button id="new-wing-btn" class="btn-gold px-5 py-2.5"><i class="fa-solid fa-plus mr-1"></i>New Wing</button>
      </div>
      <div id="new-wing-form" class="hidden glass-card p-6 mb-6">
        <input id="new-wing-name" class="input-field mb-3" placeholder="Wing name (e.g. Male Wing)" />
        <button id="create-wing-btn" class="btn-gold px-6 py-2.5">Create</button>
      </div>
      <div class="space-y-3" id="wings-list"></div>
    </section>`;

  document.getElementById("wings-list").innerHTML = wings.map(w => `
    <div class="glass-card p-5 flex items-center justify-between gap-3" id="wing-row-${w.id}">
      <div>
        <p class="font-display font-semibold" id="wing-name-${w.id}">${escapeHtml(w.name)}</p>
        <p class="text-xs text-ink/50">${w.member_count} voter(s) &middot; ${w.election_count} election(s)</p>
      </div>
      <div class="flex gap-2">
        <button class="text-sm text-gold font-semibold" onclick="editWingName(${w.id})">Rename</button>
        <button class="text-sm text-red-600 font-semibold" onclick="deleteWing(${w.id})">Delete</button>
      </div>
    </div>`).join("") || `<p class="text-ink/50 text-center py-10">No wings yet. Create one to get started.</p>`;

  document.getElementById("new-wing-btn").addEventListener("click", () => {
    document.getElementById("new-wing-form").classList.toggle("hidden");
  });
  document.getElementById("create-wing-btn").addEventListener("click", async () => {
    const name = document.getElementById("new-wing-name").value.trim();
    if (!name) return toast("Wing name is required.", "error");
    try {
      await api("/admin/wings", { method: "POST", body: { name } });
      toast("Wing created.", "success");
      renderAdminWings(main);
    } catch (err) { toast(err.message, "error"); }
  });
}

async function editWingName(wingId) {
  const current = document.getElementById(`wing-name-${wingId}`).textContent;
  const name = prompt("Rename wing:", current);
  if (!name || !name.trim() || name.trim() === current) return;
  try {
    await api(`/admin/wings/${wingId}`, { method: "PUT", body: { name: name.trim() } });
    toast("Wing renamed.", "success");
    _wingsCache = null;
    router();
  } catch (err) { toast(err.message, "error"); }
}

async function deleteWing(wingId) {
  if (!confirm("Delete this wing? This is only possible if no voters or elections are assigned to it.")) return;
  try {
    await api(`/admin/wings/${wingId}`, { method: "DELETE" });
    toast("Wing deleted.", "success");
    _wingsCache = null;
    router();
  } catch (err) { toast(err.message, "error"); }
}

async function renderAdminAudit(main) {
  const logs = await api("/admin/audit-logs");
  main.innerHTML = `
    <section class="max-w-5xl mx-auto px-4 py-10 w-full">
      <h2 class="font-display text-2xl font-bold mb-6">Audit Logs</h2>
      <div class="glass-card overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-ink text-white text-left">
            <tr><th class="p-3">Time</th><th class="p-3">Actor</th><th class="p-3">Action</th><th class="p-3">Status</th></tr>
          </thead>
          <tbody>
            ${logs.map(l => `
              <tr class="border-b border-ink/5">
                <td class="p-3 text-xs">${new Date(l.created_at).toLocaleString()}</td>
                <td class="p-3 font-mono">${escapeHtml(l.actor_ssf_id || "—")}</td>
                <td class="p-3">${escapeHtml(l.action)}</td>
                <td class="p-3">${l.status === "success" ? '<span class="text-green-600">success</span>' : '<span class="text-red-600">failure</span>'}</td>
              </tr>`).join("") || `<tr><td class="p-6 text-center text-ink/50" colspan="4">No activity yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>`;
}

/* ---------------------------- Chrome interactions ---------------------------- */

document.getElementById("drawer-toggle").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("drawer-overlay").classList.toggle("hidden");
});
document.getElementById("drawer-overlay").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("drawer-overlay").classList.add("hidden");
});
document.getElementById("logout-btn").addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch (_) {}
  clearSession();
  navigate("home");
  toast("You have been logged out.", "info");
});

document.getElementById("footer-year").textContent = new Date().getFullYear();

/* ---------------------------- Init ---------------------------- */

window.addEventListener("hashchange", router);

async function init() {
  if (state.token) {
    try {
      state.member = await api("/auth/me");
    } catch (_) {
      clearSession();
    }
  }
  document.getElementById("loading-screen").style.display = "none";
  router();
}

init();
