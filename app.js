"use strict";

/* ===========================
 * CONFIG
 * =========================== */
const SHEETDB_BASE = "https://sheetdb.io/api/v1/8pmdh33s9fvy8";
const SHEETS = {
  TESTS: "Tests",
  PATIENTS: "Patients",
  TOKENS: "LinkTokens"
};

const TEST_PREFIX = "";        // se usar prefixo nas colunas de teste
const DONE_SUFFIX = "_FEITO";  // sufixo de concluído

// Em Tests: usar coluna "source" com "Profissional" pros formulários desse painel
// Em Tests: usar "form_url" com o link do formulário do profissional

/* ===========================
 * ESTADO
 * =========================== */
let testsCatalog = [];   // {code,label,order,source,form_url}
let patients = [];       // linhas da aba Patients
let tokenMapByCPF = {};  // cpf -> token

/* ===========================
 * HELPERS BÁSICOS
 * =========================== */

const $ = (sel) => document.querySelector(sel);

function onlyDigits(s) {
  return (s || "").replace(/\D+/g, "");
}

function maskCPF(cpf) {
  const d = onlyDigits(cpf || "");
  if (d.length !== 11) return cpf || "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function buildUrl(base, params) {
  try {
    const u = new URL(base, location.href);
    Object.entries(params || {}).forEach(([k, v]) =>
      u.searchParams.set(k, v)
    );
    return u.toString();
  } catch {
    const q = Object.entries(params || {})
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
      )
      .join("&");
    return base + (base.includes("?") ? "&" : "?") + q;
  }
}

function setMsg(text = "", type = "ok") {
  const box = $("#msg");
  if (!box) return;

  if (!text) {
    box.className = "msg hidden";
    box.textContent = "";
    return;
  }

  const cls =
    type === "ok"
      ? "msg okbox"
      : type === "warn"
      ? "msg warnbox"
      : "msg errbox";

  box.className = cls;
  box.textContent = text;
}

/* ===========================
 * SHEET HELPERS
 * =========================== */

async function sheetAll(sheet) {
  const url = `${SHEETDB_BASE}?sheet=${encodeURIComponent(sheet)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Falha ao buscar " + sheet);
  return r.json();
}

async function sheetSearch(sheet, params) {
  const usp = new URLSearchParams(params || {});
  const url = `${SHEETDB_BASE}/search?sheet=${encodeURIComponent(
    sheet
  )}&${usp.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Falha ao buscar em " + sheet);
  return r.json();
}

/* ===========================
 * COLUNAS / SOURCE
 * =========================== */

function colFor(test) {
  return TEST_PREFIX ? TEST_PREFIX + test.code : test.code;
}

function doneColFor(test) {
  return colFor(test) + DONE_SUFFIX;
}

function normalizeSource(raw) {
  const s = (raw || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

  // Profissional / avaliador / psicólogo
  if (
    /\b(profiss(ional)?|avaliador(a)?|psico(logo|loga)?|neuropsico(logo|loga)?|terapeuta)\b/.test(
      s
    )
  ) {
    return { cls: "profissional", label: "Profissional" };
  }

  // fallback: tratamos como não-profissional
  return { cls: "outro", label: raw || "Outro" };
}

/* ===========================
 * CARREGAR DADOS
 * =========================== */

async function loadAllData() {
  // 1) Testes ativos
  const testRows = await sheetSearch(SHEETS.TESTS, { active: "sim" });

  testsCatalog = (testRows || [])
    .map((r) => {
      const code = (r.code || "").trim();
      if (!code) return null;
      const label = (r.label || code).trim();
      const order = Number(r.order || 9999);
      const source = (r.source || "profissional").trim();
      const form_url = (r.form_url || "").trim();
      return { code, label, order, source, form_url };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.order - b.order || a.label.localeCompare(b.label)
    );

  // 2) Pacientes
  patients = await sheetAll(SHEETS.PATIENTS);

  // 3) Tokens (cpf -> token válido mais recente)
  const tokenRows = await sheetAll(SHEETS.TOKENS);
  tokenMapByCPF = {};
  for (const row of tokenRows || []) {
    const cpf = onlyDigits(row.cpf || "");
    const token = (row.token || "").trim();
    if (!cpf || !token) continue;

    // se tiver múltiplos, o último da lista sobrescreve
    tokenMapByCPF[cpf] = token;
  }
}

/* ===========================
 * PENDÊNCIAS DO PROFISSIONAL
 * =========================== */

function getPendingForProfessional(pac) {
  const pendentes = [];

  for (const t of testsCatalog) {
    const n = normalizeSource(t.source);
    if (n.cls !== "profissional") continue;

    const col = colFor(t);
    const doneC = doneColFor(t);

    const liberado =
      String(pac[col] || "").toLowerCase() === "sim";
    const feito =
      String(pac[doneC] || "").toLowerCase() === "sim";

    if (liberado && !feito) {
      pendentes.push(t);
    }
  }

  return pendentes;
}

/* ===========================
 * RENDER LISTA
 * =========================== */

function renderPatientList() {
  const listEl = $("#pacList");
  if (!listEl) return;
  listEl.innerHTML = "";

  let totalComPendencias = 0;

  const ordered = [...patients].sort((a, b) => {
    const na = (a.nome || "").toLowerCase();
    const nb = (b.nome || "").toLowerCase();
    return na.localeCompare(nb);
  });

  for (const pac of ordered) {
    const pendentes = getPendingForProfessional(pac);
    if (!pendentes.length) continue;

    totalComPendencias++;

    const det = document.createElement("details");
    det.className = "pac-card";

    const sum = document.createElement("summary");
    sum.className = "pac-head";

    const main = document.createElement("div");
    main.className = "pac-main";

    const nome = document.createElement("div");
    nome.className = "pac-nome";
    nome.textContent = pac.nome || "Paciente sem nome";

    const extra = document.createElement("div");
    extra.className = "pac-extra";
    extra.textContent = `CPF: ${maskCPF(
      pac.cpf || ""
    )} • Pendentes: ${pendentes.length}`;

    main.appendChild(nome);
    main.appendChild(extra);

    const count = document.createElement("div");
    count.className = "pac-count";
    count.textContent = `${pendentes.length} pendente(s)`;

    sum.appendChild(main);
    sum.appendChild(count);
    det.appendChild(sum);

    const body = document.createElement("div");
    body.className = "pac-body";

    for (const t of pendentes) {
      const item = document.createElement("div");
      item.className = "form-item";

      const head = document.createElement("div");
      head.className = "form-head";

      const ttl = document.createElement("div");
      ttl.className = "form-title";
      ttl.textContent = t.label || t.code;

      const code = document.createElement("div");
      code.className = "form-code";
      code.textContent = t.code;

      head.appendChild(ttl);
      head.appendChild(code);

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const btn = document.createElement("button");
      btn.className = "btn-prof";
      btn.textContent = "Responder formulário";

      btn.addEventListener("click", () => {
        const cpf = onlyDigits(pac.cpf || "");
        const tok = tokenMapByCPF[cpf];

        if (!tok) {
          alert(
            "Não foi possível localizar o token desse paciente. Confirme o link/tokens na planilha."
          );
          return;
        }

        const baseUrl = t.form_url;
        if (!baseUrl) {
          alert(
            `Não há form_url configurada para o teste ${t.code}. Ajuste na aba Tests.`
          );
          return;
        }

        const finalUrl = buildUrl(baseUrl, { token: tok });
        window.open(finalUrl, "_self");
      });

      actions.appendChild(btn);
      item.appendChild(head);
      item.appendChild(actions);
      body.appendChild(item);
    }

    det.appendChild(body);
    listEl.appendChild(det);
  }

  if (totalComPendencias === 0) {
    listEl.innerHTML = `
      <div class="muted" style="text-align:center;padding:24px 12px;">
        Nenhum formulário pendente para o profissional no momento.
      </div>`;
  }
}

/* ===========================
 * THEME TOGGLE
 * =========================== */

(function initTheme() {
  const body = document.body;
  const btn = $("#themeToggle");

  function applyTheme(theme) {
    body.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(
        "integrada-painel-prof-theme",
        theme
      );
    } catch (e) {}
    if (btn) {
      btn.textContent =
        theme === "dark"
          ? "🌙 Modo escuro"
          : "☀️ Modo claro";
    }
  }

  let saved = null;
  try {
    saved = localStorage.getItem(
      "integrada-painel-prof-theme"
    );
  } catch (e) {}

  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    applyTheme("light");
  }

  if (btn) {
    btn.addEventListener("click", () => {
      const current =
        body.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark";
      applyTheme(current);
    });
  }
})();

/* ===========================
 * BOOT
 * =========================== */

async function boot() {
  try {
    setMsg(
      "Carregando pacientes e formulários pendentes...",
      "warn"
    );
    await loadAllData();
    renderPatientList();
    setMsg("");
  } catch (e) {
    console.error(e);
    setMsg(
      e.message || "Falha ao carregar dados.",
      "err"
    );
  }
}

boot();

/* ===========================
 * ATUALIZAR
 * =========================== */

$("#btnAtualizar")?.addEventListener("click", async () => {
  try {
    setMsg("Atualizando...", "warn");
    await loadAllData();
    renderPatientList();
    setMsg("Pronto.", "ok");
    setTimeout(() => setMsg(""), 1000);
  } catch (e) {
    console.error(e);
    setMsg("Erro ao atualizar.", "err");
  }
});
