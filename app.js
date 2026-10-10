(() => {
  "use strict";

  const API_ROOT = "https://www.googleapis.com/calendar/v3";
  const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
  const COLORS = ["#2864dc", "#15966a", "#c47a10", "#a142f4", "#d34836",
                  "#008b9a", "#bd4c83", "#607d3b", "#6b7280", "#8b5e34"];

  const $ = (id) => document.getElementById(id);
  const loginButton = $("login-button");
  const logoutButton = $("logout-button");
  const statusEl = $("account-status");
  const messageEl = $("message");
  const searchInput = $("search-input");
  const filtersEl = $("calendar-filters");
  const toggleAllButton = $("toggle-all");
  const refreshButton = $("refresh-button");
  const emptyState = $("empty-state");

  let tokenClient = null;
  let accessToken = null; // Deliberately memory-only; never persisted to localStorage.
  let calendars = [];
  let allEvents = [];
  let calendar = null;
  let currentView = "dayGridMonth";
  let colorByCalendar = new Map();

  function showMessage(message, type = "") {
    messageEl.textContent = message;
    messageEl.className = `message ${type}`.trim();
    messageEl.hidden = false;
  }

  function setConnected(connected) {
    loginButton.hidden = connected;
    logoutButton.hidden = !connected;
    searchInput.disabled = !connected;
    refreshButton.disabled = !connected;
    toggleAllButton.disabled = !connected;
    document.querySelectorAll(".view-button").forEach(b => b.disabled = !connected);
    statusEl.textContent = connected ? "Google terhubung" : "Belum terhubung";
    emptyState.hidden = connected;
  }

  function safeText(value) {
    return String(value || "").toLocaleLowerCase("id-ID");
  }

  async function apiGet(path, params = {}) {
    if (!accessToken) throw new Error("Sesi Google tidak aktif. Hubungkan kembali akun Anda.");
    const url = new URL(`${API_ROOT}/${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = data?.error?.message || `Permintaan Google Calendar gagal (${response.status}).`;
      throw new Error(reason);
    }
    return data;
  }

  async function listAllPages(path, params = {}, listKey) {
    let pageToken;
    const items = [];
    do {
      const data = await apiGet(path, { ...params, pageToken });
      items.push(...(data[listKey] || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }

  async function loadCalendars() {
    const result = await listAllPages("users/me/calendarList", {
      maxResults: 250,
      showHidden: true
    }, "items");
    return result.filter(c => c.id && c.accessRole !== "freeBusyReader");
  }

  function eventDate(event) {
    return event.start?.dateTime || event.start?.date || null;
  }

  async function loadEvents(calendarInfo) {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);

    // Single events expands recurring events; time window keeps the initial load manageable.
    const items = await listAllPages(
      `calendars/${encodeURIComponent(calendarInfo.id)}/events`,
      {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250
      },
      "items"
    );

    const color = colorByCalendar.get(calendarInfo.id);

    return items
      .filter(e => e.status !== "cancelled" && eventDate(e))
      .map(e => {
        const eventUrl = safeGoogleEventUrl(e.htmlLink);
        const event = {
          id: `${calendarInfo.id}::${e.id}`,
          title: e.summary || "(Tanpa judul)",
          start: eventDate(e),
          end: e.end?.dateTime || e.end?.date || undefined,
          allDay: Boolean(e.start?.date && !e.start?.dateTime),
          backgroundColor: color,
          borderColor: color,
          textColor: "#ffffff",
          extendedProps: {
            calendarId: calendarInfo.id,
            calendarName: calendarInfo.summary || calendarInfo.id,
            location: e.location || "",
            description: e.description || "",
            organizer: e.organizer?.displayName || ""
          }
        };

        if (eventUrl) {
          event.url = eventUrl;
        }

        return event;
      });
  }

  function safeGoogleEventUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;

    try {
      const url = new URL(value);
      const allowedHosts = ["calendar.google.com", "www.google.com"];

      if (url.protocol !== "https:") return null;
      if (!allowedHosts.includes(url.hostname)) return null;
      if (!url.pathname.startsWith("/calendar/")) return null;

      return url.href;
    } catch {
      return null;
    }
  }

  function ensureEventDialog() {
    let dialog = $("event-detail-dialog");
    if (dialog) return dialog;

    const styles = document.createElement("style");
    styles.textContent = `
      .event-detail-dialog {
        width: min(560px, calc(100vw - 32px));
        max-width: none;
        max-height: min(80vh, 760px);
        padding: 0;
        border: 0;
        border-radius: 16px;
        color: #18324f;
        background: #ffffff;
        box-shadow: 0 24px 80px rgba(12, 31, 56, 0.3);
      }

      .event-detail-dialog::backdrop {
        background: rgba(12, 31, 56, 0.58);
        backdrop-filter: blur(2px);
      }

      .event-detail-panel {
        padding: 24px;
      }

      .event-detail-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }

      .event-detail-kicker {
        margin: 0 0 6px;
        color: #2864dc;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .event-detail-title {
        margin: 0;
        color: #18324f;
        font-size: 22px;
        line-height: 1.3;
        overflow-wrap: anywhere;
      }

      .event-detail-close-icon {
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        color: #18324f;
        background: #eef3fa;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
      }

      .event-detail-fields {
        display: grid;
        gap: 14px;
      }

      .event-detail-row {
        padding-bottom: 12px;
        border-bottom: 1px solid #e6ebf2;
      }

      .event-detail-label {
        display: block;
        margin-bottom: 4px;
        color: #68788e;
        font-size: 12px;
        font-weight: 600;
      }

      .event-detail-value {
        color: #18324f;
        font-size: 14px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .event-detail-description {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .event-detail-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 22px;
      }

      .event-detail-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        padding: 9px 14px;
        border: 1px solid #d6dfeb;
        border-radius: 9px;
        color: #18324f;
        background: #ffffff;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
      }

      .event-detail-button-primary {
        border-color: #183f70;
        color: #ffffff;
        background: #183f70;
      }

      @media (max-width: 480px) {
        .event-detail-panel {
          padding: 20px;
        }

        .event-detail-title {
          font-size: 19px;
        }
      }
    `;
    document.head.append(styles);

    dialog = document.createElement("dialog");
    dialog.id = "event-detail-dialog";
    dialog.className = "event-detail-dialog";
    dialog.setAttribute("aria-labelledby", "event-detail-title");
    dialog.innerHTML = `
      <div class="event-detail-panel">
        <header class="event-detail-header">
          <div>
            <p class="event-detail-kicker">Detail kegiatan</p>
            <h2 class="event-detail-title" id="event-detail-title"></h2>
          </div>
          <button
            class="event-detail-close-icon"
            type="button"
            data-event-dialog-close
            aria-label="Tutup detail"
          >×</button>
        </header>

        <div class="event-detail-fields">
          <div class="event-detail-row">
            <span class="event-detail-label">Kalender</span>
            <div class="event-detail-value" id="event-detail-calendar"></div>
          </div>

          <div class="event-detail-row">
            <span class="event-detail-label">Waktu</span>
            <div class="event-detail-value" id="event-detail-time"></div>
          </div>

          <div class="event-detail-row" id="event-detail-location-row" hidden>
            <span class="event-detail-label">Lokasi</span>
            <div class="event-detail-value" id="event-detail-location"></div>
          </div>

          <div class="event-detail-row" id="event-detail-organizer-row" hidden>
            <span class="event-detail-label">Penyelenggara</span>
            <div class="event-detail-value" id="event-detail-organizer"></div>
          </div>

          <div class="event-detail-row" id="event-detail-description-row" hidden>
            <span class="event-detail-label">Deskripsi</span>
            <div
              class="event-detail-value event-detail-description"
              id="event-detail-description"
            ></div>
          </div>
        </div>

        <footer class="event-detail-actions">
          <a
            class="event-detail-button event-detail-button-primary"
            id="event-detail-google-link"
            target="_blank"
            rel="noopener noreferrer"
            hidden
          >Buka di Google Calendar</a>
          <button
            class="event-detail-button"
            type="button"
            data-event-dialog-close
          >Tutup</button>
        </footer>
      </div>
    `;

    document.body.append(dialog);

    dialog.querySelectorAll("[data-event-dialog-close]").forEach(button => {
      button.addEventListener("click", () => dialog.close());
    });

    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });

    return dialog;
  }

  function formatEventTime(event) {
    if (!event.start) return "Waktu tidak tersedia";

    const formatDate = date => date.toLocaleString(
      "id-ID",
      event.allDay
        ? { dateStyle: "full" }
        : { dateStyle: "full", timeStyle: "short" }
    );

    if (event.allDay || !event.end) {
      return formatDate(event.start);
    }

    return `${formatDate(event.start)} sampai ${formatDate(event.end)}`;
  }

  function showEventDetails(info) {
    // Prevent browser or FullCalendar fallback navigation such as /undefined.
    info.jsEvent.preventDefault();

    const event = info.event;
    const details = event.extendedProps || {};
    const dialog = ensureEventDialog();

    dialog.querySelector("#event-detail-title").textContent = event.title || "(Tanpa judul)";
    dialog.querySelector("#event-detail-calendar").textContent =
      details.calendarName || "Tidak diketahui";
    dialog.querySelector("#event-detail-time").textContent = formatEventTime(event);

    const locationRow = dialog.querySelector("#event-detail-location-row");
    const locationValue = dialog.querySelector("#event-detail-location");
    locationValue.textContent = details.location || "";
    locationRow.hidden = !details.location;

    const organizerRow = dialog.querySelector("#event-detail-organizer-row");
    const organizerValue = dialog.querySelector("#event-detail-organizer");
    organizerValue.textContent = details.organizer || "";
    organizerRow.hidden = !details.organizer;

    const descriptionRow = dialog.querySelector("#event-detail-description-row");
    const descriptionValue = dialog.querySelector("#event-detail-description");
    descriptionValue.textContent = details.description || "";
    descriptionRow.hidden = !details.description;

    const googleLink = dialog.querySelector("#event-detail-google-link");
    if (event.url) {
      googleLink.href = event.url;
      googleLink.hidden = false;
    } else {
      googleLink.removeAttribute("href");
      googleLink.hidden = true;
    }

    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function renderFilters() {
    filtersEl.replaceChildren();
    if (!calendars.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Tidak ada kalender yang dapat dibaca oleh akun ini.";
      filtersEl.append(p);
      return;
    }

    calendars.forEach(cal => {
      const label = document.createElement("label");
      label.className = "filter-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.calendarId = cal.id;
      checkbox.addEventListener("change", applyFilters);

      const color = document.createElement("span");
      color.className = "filter-color";
      color.style.backgroundColor = colorByCalendar.get(cal.id);

      const name = document.createElement("span");
      name.className = "filter-label";
      name.textContent = cal.summary || cal.id;
      label.append(checkbox, color, name);
      filtersEl.append(label);
    });
    toggleAllButton.textContent = "Sembunyikan semua";
  }

  function applyFilters() {
    const query = safeText(searchInput.value.trim());
    const enabled = new Set(
      [...filtersEl.querySelectorAll('input[type="checkbox"]:checked')]
        .map(input => input.dataset.calendarId)
    );

    const filtered = allEvents.filter(event => {
      const p = event.extendedProps || {};
      if (!enabled.has(p.calendarId)) return false;
      if (!query) return true;
      return [event.title, p.location, p.description, p.calendarName, p.organizer]
        .some(value => safeText(value).includes(query));
    });

    calendar.removeAllEvents();
    calendar.addEventSource(filtered);
    const count = filtered.length;
    showMessage(`${count} agenda ditampilkan dari ${enabled.size} kalender terpilih.`, "success");
  }

  async function refreshData() {
    showMessage("Memuat daftar kalender dan acara…");
    refreshButton.disabled = true;
    try {
      calendars = await loadCalendars();
      colorByCalendar = new Map(
        calendars.map((c, i) => [c.id, c.backgroundColor || COLORS[i % COLORS.length]])
      );
      renderFilters();

      const settled = await Promise.allSettled(calendars.map(loadEvents));
      allEvents = [];
      const failures = [];
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          allEvents.push(...result.value);
        } else {
          failures.push(
            `${calendars[index].summary || calendars[index].id}: ${result.reason.message}`
          );
        }
      });

      allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
      applyFilters();

      if (failures.length) {
        showMessage(
          `Data berhasil dimuat, tetapi ${failures.length} kalender tidak dapat dibaca. ${failures.slice(0, 2).join(" | ")}`,
          "error"
        );
      } else if (!calendars.length) {
        showMessage(
          "Tidak ditemukan kalender yang dapat dibaca. Pastikan akun memiliki kalender atau akses berbagi yang sesuai.",
          "error"
        );
      }
    } catch (error) {
      showMessage(error.message || "Terjadi kesalahan saat memuat kalender.", "error");
      if (/401|invalid credentials|expired|sesi google/i.test(error.message)) {
        accessToken = null;
        setConnected(false);
      }
    } finally {
      refreshButton.disabled = !accessToken;
    }
  }

  function initCalendar() {
    const calendarEl = $("calendar");
    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: currentView,
      height: "auto",
      locale: "id",
      firstDay: 1,
      nowIndicator: true,
      navLinks: true,
      dayMaxEvents: true,
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: ""
      },
      buttonText: {
        today: "Hari ini",
        month: "Bulan",
        week: "Minggu",
        day: "Hari",
        list: "Agenda"
      },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventClick(info) {
        showEventDetails(info);
      }
    });
    calendar.render();
  }

  function initializeOAuth() {
    const clientId = window.APP_CONFIG?.GOOGLE_CLIENT_ID;
    if (!clientId || clientId.includes("GANTI_DENGAN")) {
      showMessage(
        "Konfigurasi belum selesai: isi GOOGLE_CLIENT_ID di config.js, lalu muat ulang halaman.",
        "error"
      );
      loginButton.disabled = true;
      return;
    }

    const waitForGoogle = () => {
      if (!window.google?.accounts?.oauth2) {
        setTimeout(waitForGoogle, 150);
        return;
      }

      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: async response => {
          if (response.error) {
            showMessage(`Google tidak memberikan akses: ${response.error}`, "error");
            return;
          }
          accessToken = response.access_token;
          setConnected(true);
          await refreshData();
        },
        error_callback: error => {
          showMessage(
            `Login Google tidak selesai: ${error?.message || error?.type || "coba lagi."}`,
            "error"
          );
        }
      });
      loginButton.disabled = false;
    };

    waitForGoogle();
  }

  loginButton.addEventListener("click", () => {
    if (!tokenClient) {
      showMessage("Layanan login Google belum siap. Coba muat ulang halaman.", "error");
      return;
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });

  logoutButton.addEventListener("click", () => {
    if (accessToken && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    calendars = [];
    allEvents = [];
    filtersEl.replaceChildren();

    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Daftar kalender akan muncul setelah login.";
    filtersEl.append(p);

    calendar.removeAllEvents();
    setConnected(false);
    showMessage(
      "Akses aplikasi diputus. Jika ingin mencabut izin aplikasi sepenuhnya, tinjau akses pihak ketiga di Akun Google."
    );
  });

  searchInput.addEventListener("input", applyFilters);
  refreshButton.addEventListener("click", refreshData);

  toggleAllButton.addEventListener("click", () => {
    const inputs = [...filtersEl.querySelectorAll('input[type="checkbox"]')];
    const allChecked = inputs.length > 0 && inputs.every(input => input.checked);
    inputs.forEach(input => {
      input.checked = !allChecked;
    });
    toggleAllButton.textContent = allChecked ? "Pilih semua" : "Sembunyikan semua";
    applyFilters();
  });

  document.querySelectorAll(".view-button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".view-button").forEach(b => {
        b.classList.toggle("active", b === button);
      });
      currentView = button.dataset.view;
      calendar.changeView(currentView);
    });
  });

  setConnected(false);
  loginButton.disabled = true;
  initCalendar();
  initializeOAuth();
})();
