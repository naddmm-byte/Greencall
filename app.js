const csvInput = document.getElementById("csvInput");
const runExtract = document.getElementById("runExtract");
const extractStatus = document.getElementById("extractStatus");
const pdfMeta = document.getElementById("pdfMeta");
const shiftTable = document.getElementById("shiftTable");
const siteFilterWrap = document.getElementById("siteFilter");
const siteFilterToggle = document.getElementById("siteFilterToggle");
const siteFilterPanel = document.getElementById("siteFilterPanel");
const positionFilterWrap = document.getElementById("positionFilter");
const positionFilterToggle = document.getElementById("positionFilterToggle");
const positionFilterPanel = document.getElementById("positionFilterPanel");
const clearFilterBtn = document.getElementById("clearFilter");
const messageSelectedBtn = document.getElementById("messageSelected");
const clearSelectionBtn = document.getElementById("clearSelection");

let currentCsvFile = null;

csvInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  currentCsvFile = file;
  extractStatus.textContent = "CSV loaded. Ready to import.";
  pdfMeta.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
});

runExtract.addEventListener("click", async () => {
  if (!currentCsvFile) {
    extractStatus.textContent = "Please choose a CSV first.";
    return;
  }

  extractStatus.textContent = "Loading CSV...";
  runExtract.disabled = true;

  try {
    const text = await readFileAsText(currentCsvFile);
    const rows = parseAssignmentsFromCsv(text);
    fillTable(rows);
    extractStatus.textContent = `CSV loaded. Parsed ${rows.length} shifts.`;
  } catch (error) {
    extractStatus.textContent = "CSV load failed. Check the file format.";
  } finally {
    runExtract.disabled = false;
  }
});

clearFilterBtn.addEventListener("click", () => {
  clearPanelSelections(siteFilterPanel);
  clearPanelSelections(positionFilterPanel);
  rebuildPositionFilters();
  applyFilters();
  updateFilterToggles();
});

siteFilterToggle?.addEventListener("click", (event) => {
  event.preventDefault();
  togglePanel(siteFilterWrap, siteFilterToggle);
});

positionFilterToggle?.addEventListener("click", (event) => {
  event.preventDefault();
  togglePanel(positionFilterWrap, positionFilterToggle);
});

document.addEventListener("click", (event) => {
  if (siteFilterWrap && !siteFilterWrap.contains(event.target)) {
    closePanel(siteFilterWrap, siteFilterToggle);
  }
  if (positionFilterWrap && !positionFilterWrap.contains(event.target)) {
    closePanel(positionFilterWrap, positionFilterToggle);
  }
});

messageSelectedBtn?.addEventListener("click", () => {
  const rows = getSelectedRows();
  if (rows.length === 0) {
    extractStatus.textContent = "Select at least one row.";
    return;
  }

  const row = rows.find((candidate) =>
    formatSmsHref(
      candidate.dataset.phone || "",
      candidate.dataset.site || "",
      candidate.dataset.guard || "",
      candidate.dataset.timing || ""
    )
  );

  if (!row) {
    extractStatus.textContent = "Selected rows need valid phone numbers.";
    return;
  }

  const href = formatSmsHref(
    row.dataset.phone || "",
    row.dataset.site || "",
    row.dataset.guard || "",
    row.dataset.timing || ""
  );

  if (!href) {
    extractStatus.textContent = "Unable to create message link.";
    return;
  }

  markRowContacted(row);
  const checkbox = row.querySelector(".row-select");
  if (checkbox) {
    checkbox.checked = false;
  }
  row.classList.remove("row-selected");
  updateSelectionState();

  const remaining = rows.filter((candidate) => candidate !== row).length;
  const name = row.dataset.guard || "guard";
  extractStatus.textContent =
    remaining > 0
      ? `Opened message for ${name}. ${remaining} remaining.`
      : `Opened message for ${name}.`;

  window.location.href = href;
});

clearSelectionBtn?.addEventListener("click", () => {
  shiftTable.querySelectorAll(".row-select").forEach((checkbox) => {
    checkbox.checked = false;
  });
  shiftTable.querySelectorAll("tr").forEach((row) => row.classList.remove("row-selected"));
  updateSelectionState();
});


async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function parseAssignmentsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);
  const indexMap = buildHeaderMap(headers);

  return rows.slice(1).map((row) => {
    return {
      date: getCell(row, indexMap.date),
      guardName: getCell(row, indexMap.guardName),
      phone: normalizePhone(getCell(row, indexMap.phone)),
      site: getCell(row, indexMap.site),
      position: cleanPosition(getCell(row, indexMap.position)),
      timing: getCell(row, indexMap.timing),
    };
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      current = "";
      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => String(cell).trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildHeaderMap(headers) {
  const map = {
    date: findHeader(headers, ["date"]),
    guardName: findHeader(headers, ["guard name", "guard", "employee", "name"]),
    phone: findHeader(headers, ["phone", "phone number", "mobile", "contact"]),
    site: findHeader(headers, ["site allocated", "site", "location"]),
    position: findHeader(headers, ["shift position", "position", "role"]),
    timing: findHeader(headers, ["timings", "time", "shift time", "shift timings"]),
  };

  return map;
}

function findHeader(headers, variants) {
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (variants.some((variant) => header.includes(variant))) {
      return i;
    }
  }
  return -1;
}

function getCell(row, index) {
  if (index < 0) {
    return "";
  }
  return String(row[index] || "").trim();
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("61") && digits.length === 11) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function cleanPosition(text) {
  return String(text || "")
    .replace(/\b\d{4}\s*-\s*\d{4}\b/g, " ")
    .replace(/\b\d{4}\s*\/\s*\d{4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fillTable(rows) {
  shiftTable.innerHTML = "";
  rows.filter(Boolean).forEach(addShiftRow);
  rebuildSiteFilters();
  rebuildPositionFilters();
  applyFilters();
  updateFilterToggles();
  updateSelectionState();
}

function addShiftRow({ date, guardName, phone, site, position, timing }) {
  const row = document.createElement("tr");
  row.dataset.date = date || "";
  row.dataset.guard = guardName || "";
  row.dataset.phone = phone || "";
  row.dataset.site = site || "";
  row.dataset.position = position || "";
  row.dataset.timing = timing || "";

  row.innerHTML = `
    <td class="guard" data-label="Guard">${escapeHtml(guardName)}</td>
    <td class="site" data-label="Site">${escapeHtml(site)}</td>
    <td class="timing" data-label="Timing">${escapeHtml(timing)}</td>
    <td data-label="Call"><a class="call-btn" href="#" aria-label="Call guard">Call</a></td>
    <td data-label="Message"><a class="msg-btn" href="#" aria-label="Message guard">Message</a></td>
    <td data-label="Select">
      <input type="checkbox" class="row-select" aria-label="Select row" />
    </td>
  `;

  shiftTable.appendChild(row);
  updateCallLink(row);
  updateMessageLink(row);
  row.querySelector(".call-btn")?.addEventListener("click", () => {
    markRowContacted(row);
  });
  row.querySelector(".msg-btn")?.addEventListener("click", () => {
    markRowContacted(row);
  });
  row.querySelector(".row-select")?.addEventListener("change", () => {
    row.classList.toggle("row-selected", row.querySelector(".row-select").checked);
    updateSelectionState();
  });
  rebuildSiteFilters();
  rebuildPositionFilters();
  applyFilters();
  updateFilterToggles();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateCallLink(row) {
  const phoneValue = row.dataset.phone || "";
  const callButton = row.querySelector(".call-btn");
  if (!callButton) {
    return;
  }
  const href = formatTelHref(phoneValue);
  if (!href) {
    callButton.setAttribute("aria-disabled", "true");
    callButton.classList.add("disabled");
    callButton.setAttribute("tabindex", "-1");
    callButton.removeAttribute("href");
  } else {
    callButton.classList.remove("disabled");
    callButton.removeAttribute("aria-disabled");
    callButton.removeAttribute("tabindex");
    callButton.setAttribute("href", href);
  }
}

function updateMessageLink(row) {
  const phoneValue = row.dataset.phone || "";
  const messageButton = row.querySelector(".msg-btn");
  if (!messageButton) {
    return;
  }
  const href = formatSmsHref(
    phoneValue,
    row.dataset.site,
    row.dataset.guard,
    row.dataset.timing
  );
  if (!href) {
    messageButton.setAttribute("aria-disabled", "true");
    messageButton.classList.add("disabled");
    messageButton.setAttribute("tabindex", "-1");
    messageButton.removeAttribute("href");
  } else {
    messageButton.classList.remove("disabled");
    messageButton.removeAttribute("aria-disabled");
    messageButton.removeAttribute("tabindex");
    messageButton.setAttribute("href", href);
  }
}

function markRowContacted(row) {
  row.classList.add("row-contacted");
}

function updateSelectionState() {
  if (!messageSelectedBtn) {
    return;
  }
  const selected = getSelectedRows();
  messageSelectedBtn.disabled = selected.length === 0;
}

function getSelectedRows() {
  return Array.from(shiftTable.querySelectorAll("tr")).filter((row) => {
    const checkbox = row.querySelector(".row-select");
    return checkbox && checkbox.checked;
  });
}

function formatTelHref(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return `tel:${hasPlus ? "+" : ""}${digits}`;
}

function formatSmsHref(value, site, guard, timing) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  const safeGuard = (guard || "").trim();
  const safeSite = (site || "").trim();
  const sitePart = safeSite ? ` at ${safeSite}` : "";
  const timePart = timing ? ` (${timing})` : "";
  const closing = "\nRegards-Allied Ops Team";
  const body = safeGuard
    ? `Hi ${safeGuard}, please reply to confirm your shift${sitePart}${timePart}.${closing}`
    : `Hi, please reply to confirm your shift${sitePart}${timePart}.${closing}`;
  const encoded = encodeURIComponent(body);
  return `sms:${hasPlus ? "+" : ""}${digits}?&body=${encoded}`;
}

function rebuildSiteFilters() {
  if (!siteFilterPanel) {
    return;
  }

  const selected = getSelectedSites();
  const groups = collectSiteGroups();
  const available = new Set(groups.map((group) => normalizeSite(group)));
  const validSelected = new Set(
    Array.from(selected).filter((value) => available.has(value))
  );

  siteFilterPanel.innerHTML = "";
  if (groups.length === 0) {
    siteFilterPanel.innerHTML = "<p class=\"muted\">No sites yet.</p>";
    return;
  }

  groups.forEach((group) => {
    const option = buildCheckboxOption(group, validSelected.has(normalizeSite(group)));
    option.input.addEventListener("change", () => {
      rebuildPositionFilters();
      applyFilters();
      updateFilterToggles();
    });
    siteFilterPanel.appendChild(option.label);
  });
  updateFilterToggles();
}

function collectSiteGroups() {
  const rows = Array.from(shiftTable.querySelectorAll("tr"));
  const groups = new Map();

  rows.forEach((row) => {
    const site = (row.dataset.site || "").trim();
    if (!site) {
      return;
    }
    const group = deriveSiteGroup(site);
    const key = normalizeSite(group);
    if (!groups.has(key)) {
      groups.set(key, group);
    }
  });

  return Array.from(groups.values()).sort((a, b) => a.localeCompare(b));
}

function rebuildPositionFilters() {
  if (!positionFilterPanel) {
    return;
  }

  const selectedSites = getSelectedSites();
  const selectedPositions = getSelectedPositions();
  const groups = collectPositionGroups(selectedSites);
  const available = new Set(groups.map((group) => normalizePosition(group)));
  const validSelected = new Set(
    Array.from(selectedPositions).filter((value) => available.has(value))
  );

  positionFilterPanel.innerHTML = "";
  if (groups.length === 0) {
    positionFilterPanel.innerHTML = "<p class=\"muted\">No positions yet.</p>";
    return;
  }

  groups.forEach((group) => {
    const option = buildCheckboxOption(group, validSelected.has(normalizePosition(group)));
    option.input.addEventListener("change", () => {
      applyFilters();
      updateFilterToggles();
    });
    positionFilterPanel.appendChild(option.label);
  });
  updateFilterToggles();
}

function collectPositionGroups(selectedSites) {
  const rows = Array.from(shiftTable.querySelectorAll("tr"));
  const groups = new Map();

  rows.forEach((row) => {
    if (selectedSites && selectedSites.size > 0) {
      const site = (row.dataset.site || "").trim();
      const siteGroup = site ? normalizeSite(deriveSiteGroup(site)) : "";
      if (!selectedSites.has(siteGroup)) {
        return;
      }
    }

    const position = (row.dataset.position || "").trim();
    if (!position) {
      return;
    }
    const group = derivePositionGroup(position);
    const key = normalizePosition(group);
    if (!groups.has(key)) {
      groups.set(key, group);
    }
  });

  return Array.from(groups.values()).sort((a, b) => a.localeCompare(b));
}

function applyFilters() {
  const selectedSites = getSelectedSites();
  const selectedPositions = getSelectedPositions();
  const rows = Array.from(shiftTable.querySelectorAll("tr"));

  rows.forEach((row) => {
    const site = (row.dataset.site || "").trim();
    const position = (row.dataset.position || "").trim();

    const siteGroup = site ? normalizeSite(deriveSiteGroup(site)) : "";
    const positionGroup = position ? normalizePosition(derivePositionGroup(position)) : "";

    const siteMatch = selectedSites.size === 0 || selectedSites.has(siteGroup);
    const positionMatch =
      selectedPositions.size === 0 || selectedPositions.has(positionGroup);

    row.style.display = siteMatch && positionMatch ? "" : "none";
  });
}

function normalizeSite(value) {
  return String(value || "").trim().toLowerCase();
}

function deriveSiteGroup(site) {
  const cleaned = String(site || "").trim();
  if (!cleaned) {
    return "";
  }
  const firstToken = cleaned.split(/\s+/)[0];
  return firstToken.toUpperCase();
}

function normalizePosition(value) {
  return String(value || "").trim().toLowerCase();
}

function derivePositionGroup(position) {
  const cleaned = String(position || "").trim();
  if (!cleaned) {
    return "";
  }
  const firstToken = cleaned.split(/\s+/)[0];
  return firstToken.toUpperCase();
}

function getSelectedSites() {
  return getSelectedValues(siteFilterPanel, normalizeSite);
}

function getSelectedPositions() {
  return getSelectedValues(positionFilterPanel, normalizePosition);
}

function getSelectedValues(panelEl, normalizer) {
  if (!panelEl) {
    return new Set();
  }
  const values = Array.from(panelEl.querySelectorAll("input[type='checkbox']:checked")).map(
    (input) => normalizer(input.value)
  );
  return new Set(values.filter(Boolean));
}

function clearPanelSelections(panelEl) {
  if (!panelEl) {
    return;
  }
  panelEl.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
}

function buildCheckboxOption(labelText, checked) {
  const label = document.createElement("label");
  label.className = "multi-option";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = labelText;
  input.checked = checked;

  const span = document.createElement("span");
  span.textContent = labelText;

  label.appendChild(input);
  label.appendChild(span);

  return { label, input };
}

function updateFilterToggles() {
  updateToggleLabel(siteFilterToggle, siteFilterPanel, "Site groups");
  updateToggleLabel(positionFilterToggle, positionFilterPanel, "Positions");
}

function updateToggleLabel(toggle, panel, labelText) {
  if (!toggle || !panel) {
    return;
  }
  const selected = Array.from(panel.querySelectorAll("input[type='checkbox']:checked")).map(
    (input) => input.value
  );
  if (selected.length === 0) {
    toggle.textContent = `${labelText}: All`;
  } else if (selected.length === 1) {
    toggle.textContent = `${labelText}: ${selected[0]}`;
  } else {
    toggle.textContent = `${labelText}: ${selected.length} selected`;
  }
}

function togglePanel(wrapper, toggle) {
  if (!wrapper || !toggle) {
    return;
  }
  const isOpen = wrapper.classList.toggle("open");
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function closePanel(wrapper, toggle) {
  if (!wrapper || !toggle) {
    return;
  }
  wrapper.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

updateFilterToggles();
updateSelectionState();
