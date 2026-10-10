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
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
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
      .map(e => ({
        id: `${calendarInfo.id}::${e.id}`,
        title: e.summary || "(Tanpa judul)",
        start: eventDate(e),
        end: e.end?.dateTime || e.end?.date || undefined,
        allDay: Boolean(e.start?.date && !e.start?.dateTime),
        url: safeGoogleEventUrl(e.htmlLink),
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
      }));
  }

  function safeGoogleEventUrl(value) {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      return url.hostname === "calendar.google.com" ? url.href : undefined;
    } catch { return undefined; }
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
      colorByCalendar = new Map(calendars.map((c, i) => [c.id, c.backgroundColor || COLORS[i % COLORS.length]]));
      renderFilters();

      const settled = await Promise.allSettled(calendars.map(loadEvents));
      allEvents = [];
      const failures = [];
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") allEvents.push(...result.value);
        else failures.push(`${calendars[index].summary || calendars[index].id}: ${result.reason.message}`);
      });

      allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
      applyFilters();

      if (failures.length) {
        showMessage(`Data berhasil dimuat, tetapi ${failures.length} kalender tidak dapat dibaca. ${failures.slice(0, 2).join(" | ")}`, "error");
      } else if (!calendars.length) {
        showMessage("Tidak ditemukan kalender yang dapat dibaca. Pastikan akun memiliki kalender atau akses berbagi yang sesuai.", "error");
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
      buttonText: { today: "Hari ini", month: "Bulan", week: "Minggu", day: "Hari", list: "Agenda" },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventClick(info) {
        const p = info.event.extendedProps || {};
        const start = info.event.start ? info.event.start.toLocaleString("id-ID") : "";
        const details = [
          info.event.title,
          `Kalender: ${p.calendarName || "-"}`,
          `Waktu: ${start}`,
          p.location ? `Lokasi: ${p.location}` : "",
          p.description ? `\n${p.description}` : ""
        ].filter(Boolean).join("\n");
        if (info.event.url) {
          info.jsEvent.preventDefault();
          window.open(info.event.url, "_blank", "noopener,noreferrer");
        } else {
          alert(details);
        }
      }
    });
    calendar.render();
  }

  function initializeOAuth() {
    const clientId = window.APP_CONFIG?.GOOGLE_CLIENT_ID;
    if (!clientId || clientId.includes("GANTI_DENGAN")) {
      showMessage("Konfigurasi belum selesai: isi GOOGLE_CLIENT_ID di config.js, lalu muat ulang halaman.", "error");
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
        callback: async (response) => {
          if (response.error) {
            showMessage(`Google tidak memberikan akses: ${response.error}`, "error");
            return;
          }
          accessToken = response.access_token;
          setConnected(true);
          await refreshData();
        },
        error_callback: (error) => {
          showMessage(`Login Google tidak selesai: ${error?.message || error?.type || "coba lagi."}`, "error");
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
    showMessage("Akses aplikasi diputus. Jika ingin mencabut izin aplikasi sepenuhnya, tinjau akses pihak ketiga di Akun Google.");
  });

  searchInput.addEventListener("input", applyFilters);
  refreshButton.addEventListener("click", refreshData);

  toggleAllButton.addEventListener("click", () => {
    const inputs = [...filtersEl.querySelectorAll('input[type="checkbox"]')];
    const allChecked = inputs.length > 0 && inputs.every(input => input.checked);
    inputs.forEach(input => { input.checked = !allChecked; });
    toggleAllButton.textContent = allChecked ? "Pilih semua" : "Sembunyikan semua";
    applyFilters();
  });

  document.querySelectorAll(".view-button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".view-button").forEach(b => b.classList.toggle("active", b === button));
      currentView = button.dataset.view;
      calendar.changeView(currentView);
    });
  });

  setConnected(false);
  loginButton.disabled = true;
  initCalendar();
  initializeOAuth();
})();
