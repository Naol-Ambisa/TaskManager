
  //  TaskFlow — script.js
  //  Sections: constants & state · storage · date helpers · task
  //  operations (CRUD) · filter/search/sort · rendering · modals ·
  //  toasts · event wiring · init
  //  User text is only ever inserted with textContent (never innerHTML),
  //  so it cannot inject HTML.
"use strict";

/* ---------- Constants & state ---------- */

const STORAGE_KEY = "taskflow.tasks.v1";
const THEME_STORAGE_KEY = "taskflow.theme.v1";
const CATEGORIES = ["Work", "Personal", "Study"];
const STATUS_LABELS = { all: "All Tasks", active: "Active Tasks", completed: "Completed Tasks" };

const state = {
  tasks: [],
  status: "all",      // all | active | completed
  category: "all",    // all | work | personal | study
  search: "",
  sort: "recent",     // recent | due | name
  editingId: null     // id of the task being edited, or null when creating
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/* ---------- Storage ---------- */
// Accept only well-formed tasks so bad saved data can never break the app.

function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const now = Date.now();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : generateId(),
    title,
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    category: CATEGORIES.includes(raw.category) ? raw.category : "Work",
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : "",
    completed: raw.completed === true,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now
  };
}

function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(normalizeTask).filter(Boolean) : [];
  } catch (error) {
    console.warn("TaskFlow: could not read saved tasks.", error);
    showToast("Saved tasks could not be loaded.", "error");
    return [];
  }
}

function saveTasks() {
  const indicator = $("#save-state");
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    indicator.textContent = "✓ Saved automatically";
    indicator.classList.remove("is-error");
    return true;
  } catch (error) {
    indicator.textContent = "⚠ Not saved";
    indicator.classList.add("is-error");
    showToast("Storage error: your changes could not be saved.", "error");
    return false;
  }
}

function generateId() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ---------- Date helpers (local calendar dates, no timezone conversion) ---------- */

function todayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDueDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function renderToday() {
  const label = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const el = $("#today-date");
  el.textContent = label;
  el.dateTime = todayString();
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const isDark = theme === "dark";
  const label = `Switch to ${isDark ? "light" : "dark"} mode`;
  const button = $("#theme-btn");
  button.textContent = isDark ? "☀" : "☾";
  button.setAttribute("aria-label", label);
  button.title = label;
  $('meta[name="theme-color"]').content = isDark ? "#111827" : "#5B67E8";
}

function loadTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    applyTheme(savedTheme === "dark" ? "dark" : "light");
  } catch (error) {
    console.warn("TaskFlow: could not read saved theme.", error);
    applyTheme("light");
  }
}

function toggleTheme() {
  const theme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("TaskFlow: could not save theme preference.", error);
    showToast("Theme changed, but could not be saved for future visits.", "error");
  }
}

/* ---------- Task operations ---------- */
function createTask({ title, description, category, dueDate }) {
  const now = Date.now();
  state.tasks.push({ id: generateId(), title, description, category, dueDate, completed: false, createdAt: now, updatedAt: now });
  saveTasks();
  render();
  showToast("Task created");
}

function updateTask(id, changes) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, changes, { updatedAt: Date.now() });
  saveTasks();
  render();
  showToast("Task updated");
}

async function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const ok = await askConfirm({ title: "Delete task?", message: `“${task.title}” will be permanently removed.`, confirmText: "Delete" });
  if (!ok) return;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  saveTasks();
  render();
  showToast("Task deleted");
}

function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  task.updatedAt = Date.now();
  saveTasks();
  render();
  showToast(task.completed ? "Task completed" : "Task reactivated");
}

async function clearCompleted() {
  const count = state.tasks.filter((t) => t.completed).length;
  if (!count) return;
  const ok = await askConfirm({
    title: "Clear completed tasks?",
    message: `${count} completed ${count === 1 ? "task" : "tasks"} will be permanently removed.`,
    confirmText: "Clear"
  });
  if (!ok) return;
  state.tasks = state.tasks.filter((t) => !t.completed);
  saveTasks();
  render();
  showToast("Completed tasks cleared");
}

/* ---------- Filter, search, sort (never modify the stored tasks) ---------- */

function filterTasks(tasks) {
  return tasks.filter((task) => {
    const statusOk = state.status === "all" || (state.status === "completed" ? task.completed : !task.completed);
    const categoryOk = state.category === "all" || task.category.toLowerCase() === state.category;
    return statusOk && categoryOk;
  });
}

function searchTasks(tasks) {
  const query = state.search.trim().toLowerCase();
  if (!query) return tasks;
  return tasks.filter((task) => `${task.title} ${task.description} ${task.category}`.toLowerCase().includes(query));
}

function sortTasks(tasks) {
  const sorted = [...tasks]; // copy so the original order is untouched
  if (state.sort === "name") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  } else if (state.sort === "due") {
    sorted.sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || b.createdAt - a.createdAt;
      if (a.dueDate) return -1;   // tasks with a due date come first
      if (b.dueDate) return 1;
      return b.createdAt - a.createdAt;
    });
  } else {
    sorted.sort((a, b) => b.createdAt - a.createdAt);
  }
  return sorted;
}

const getVisibleTasks = () => sortTasks(searchTasks(filterTasks(state.tasks)));

/* ---------- Rendering ---------- */

function renderStatistics() {
  const total = state.tasks.length;
  const completed = state.tasks.filter((t) => t.completed).length;
  const active = total - completed;
  const rate = total === 0 ? 0 : Math.round((completed / total) * 100);

  $("#stat-total").textContent = total;
  $("#stat-active").textContent = active;
  $("#stat-completed").textContent = completed;
  $("#stat-rate").textContent = `${rate}%`;
  $("#completion-chart").style.setProperty("--completion-rate", `${rate}%`);
  $("#completion-chart").setAttribute("aria-label", `Completion rate: ${rate}%`);

  // Sidebar counts

  const counts = { all: total, active, completed };
  CATEGORIES.forEach((c) => { counts[c.toLowerCase()] = state.tasks.filter((t) => t.category === c).length; });
  $$("[data-count]").forEach((el) => { el.textContent = counts[el.dataset.count]; });

  // Encouragement card

  const text = $("#encourage-text");
  if (total === 0) text.textContent = "Add your first task and start your day with a plan.";
  else if (active === 0) text.textContent = "All tasks done. Great work!";
  else text.textContent = `${active} ${active === 1 ? "task" : "tasks"} to go. You're ${rate}% there.`;
  $("#encourage-bar").style.width = `${rate}%`;

  // Footer + clear button

  $("#footer-counts").textContent = `${total} ${total === 1 ? "task" : "tasks"} · ${active} active · ${completed} completed`;
  $("#clear-completed-btn").disabled = completed === 0;
}

function renderFilterState() {
  $$("[data-status]").forEach((btn) => {
    const on = btn.dataset.status === state.status;
    btn.classList.toggle("is-active", on);
    if (btn.classList.contains("chip")) btn.setAttribute("aria-pressed", String(on));
    else if (on) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
  });
  $$("[data-category]").forEach((btn) => {
    const on = btn.dataset.category === state.category;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const categoryLabel = state.category === "all" ? "" : ` · ${state.category[0].toUpperCase()}${state.category.slice(1)}`;
  $("#breadcrumb-current").textContent = STATUS_LABELS[state.status] + categoryLabel;
}

function buildTaskElement(task) {
  const today = todayString();
  const li = document.createElement("li");
  li.className = "task" + (task.completed ? " is-done" : "");
  li.dataset.id = task.id;

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "task-check";
  check.checked = task.completed;
  check.setAttribute("aria-label", `${task.completed ? "Mark as active" : "Mark as completed"}: ${task.title}`);
  check.dataset.action = "toggle";

  const body = document.createElement("div");
  body.className = "task-body";
  const title = Object.assign(document.createElement("h3"), { className: "task-title", textContent: task.title });
  const desc = document.createElement("p");
  desc.className = "task-desc" + (task.description ? "" : " is-empty");
  desc.textContent = task.description || "No description";

  const meta = document.createElement("div");
  meta.className = "task-meta";
  const badge = Object.assign(document.createElement("span"), { className: `badge cat-${task.category.toLowerCase()}`, textContent: task.category });
  const due = document.createElement("span");
  due.className = "due";
  if (!task.dueDate) {
    due.textContent = "No due date";
  } else {
    due.textContent = "📅 " + formatDueDate(task.dueDate);
    if (!task.completed && task.dueDate < today) { due.classList.add("is-overdue"); due.textContent += " · Overdue"; }
    else if (!task.completed && task.dueDate === today) { due.classList.add("is-today"); due.textContent += " · Today"; }
  }
  meta.append(badge, due);
  body.append(title, desc, meta);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  const edit = Object.assign(document.createElement("button"), { type: "button", className: "mini-btn", textContent: "✎ Edit" });
  edit.dataset.action = "edit";
  edit.setAttribute("aria-label", `Edit task: ${task.title}`);
  const del = Object.assign(document.createElement("button"), { type: "button", className: "mini-btn danger", textContent: "✕ Delete" });
  del.dataset.action = "delete";
  del.setAttribute("aria-label", `Delete task: ${task.title}`);
  actions.append(edit, del);

  li.append(check, body, actions);
  return li;
}

function renderTasks() {
  const list = $("#task-list");
  const visible = getVisibleTasks();
  list.replaceChildren(...visible.map(buildTaskElement));

  $("#visible-count").textContent = `${visible.length} ${visible.length === 1 ? "task" : "tasks"} shown`;

  const empty = $("#empty-state");
  const addBtn = $("#empty-add-btn");
  empty.hidden = visible.length > 0;
  list.hidden = visible.length === 0;
  if (visible.length === 0) {
    if (state.tasks.length === 0) {
      $("#empty-title").textContent = "No tasks here yet";
      $("#empty-text").textContent = "Create your first task to start organizing your day.";
      addBtn.hidden = false;
    } else {
      $("#empty-title").textContent = "No matching tasks";
      $("#empty-text").textContent = "Try a different search or change the filters to see more tasks.";
      addBtn.hidden = true;
    }
  }
}

function render() {
  renderFilterState();
  renderStatistics();
  renderTasks();
}

/* ---------- Modals ---------- */

let lastFocused = null;

function showModal(modal, focusTarget) {
  lastFocused = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  (focusTarget || $("input, button, select, textarea", modal)).focus();
}

function hideModal(modal) {
  modal.hidden = true;
  if ($("#task-modal").hidden && $("#confirm-modal").hidden) document.body.style.overflow = "";
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
}

function clearFormErrors() {
  ["title", "category"].forEach((name) => { $(`#${name}-error`).textContent = ""; });
  $$("#task-form [aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

function openCreateModal() {
  state.editingId = null;
  $("#task-form").reset();
  clearFormErrors();
  $("#modal-title").textContent = "Add New Task";
  $("#modal-submit").textContent = "Add Task";
  showModal($("#task-modal"), $("#task-title"));
}

function openEditModal(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  state.editingId = id;
  clearFormErrors();
  $("#task-title").value = task.title;
  $("#task-description").value = task.description;
  $("#task-category").value = task.category;
  $("#task-due").value = task.dueDate;
  $("#modal-title").textContent = "Edit Task";
  $("#modal-submit").textContent = "Save Changes";
  showModal($("#task-modal"), $("#task-title"));
}

function closeModal() {
  if (!$("#task-modal").hidden) hideModal($("#task-modal"));
  state.editingId = null;
}

function handleFormSubmit(event) {
  event.preventDefault();
  clearFormErrors();
  const title = $("#task-title").value.trim().replace(/\s+/g, " ");
  const description = $("#task-description").value.trim();
  const category = $("#task-category").value;
  const dueDate = $("#task-due").value;

  let valid = true;
  if (!title) {
    $("#title-error").textContent = "Please enter a task title.";
    $("#task-title").setAttribute("aria-invalid", "true");
    $("#task-title").focus();
    valid = false;
  }
  if (!CATEGORIES.includes(category)) {
    $("#category-error").textContent = "Please choose a category.";
    $("#task-category").setAttribute("aria-invalid", "true");
    if (valid) $("#task-category").focus();
    valid = false;
  }
  if (!valid) return;

  const data = { title, description, category, dueDate };
  const editingId = state.editingId;
  closeModal();
  if (editingId) updateTask(editingId, data); else createTask(data);
}

// Promise-based confirmation dialog: resolves true (confirm) or false (cancel).

let resolveConfirm = null;
function askConfirm({ title, message, confirmText }) {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = message;
  $("#confirm-ok").textContent = confirmText;
  showModal($("#confirm-modal"), $("#confirm-cancel"));
  return new Promise((resolve) => { resolveConfirm = resolve; });
}

function settleConfirm(result) {
  if (!resolveConfirm) return;
  const resolve = resolveConfirm;
  resolveConfirm = null;
  hideModal($("#confirm-modal"));
  resolve(result);
}

// Keep Tab focus inside the open dialog.

function trapFocus(event, modal) {
  const items = $$("button:not([disabled]), input, select, textarea", modal).filter((el) => !el.hidden);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/* ---------- Toasts ---------- */

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast${type === "success" ? "" : ` is-${type}`}`;
  toast.textContent = message;
  $("#toasts").appendChild(toast);
  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 300);
  }, type === "error" ? 4500 : 2600);
}

/* ---------- Sidebar (mobile) ---------- */

function setSidebarOpen(open) {
  const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
  $("#sidebar").classList.toggle("is-open", open);
  $("#scrim").hidden = !open || isDesktop;
  document.body.classList.toggle("sidebar-open", open && isDesktop);
  $("#menu-btn").textContent = open ? "×" : "☰";
  $("#menu-btn").setAttribute("aria-expanded", String(open));
  $("#menu-btn").setAttribute("aria-label", open ? "Close menu" : "Open menu");
  $("#menu-btn").title = open ? "Hide sidebar" : "Show sidebar";
}

function toggleSidebar() {
  setSidebarOpen(!$("#sidebar").classList.contains("is-open"));
}

/* ---------- Event wiring ---------- */

function bindEvents() {
  $("#theme-btn").addEventListener("click", toggleTheme);

  // "Add task" entry points
  
  $("#add-task-btn").addEventListener("click", openCreateModal);
  $("#empty-add-btn").addEventListener("click", openCreateModal);

  // Status + category filters (sidebar and panel share the same state)

  document.addEventListener("click", (event) => {
    const statusBtn = event.target.closest("[data-status]");
    const categoryBtn = event.target.closest("[data-category]");
    if (statusBtn) {
      state.status = statusBtn.dataset.status;
    } else if (categoryBtn) {
      const value = categoryBtn.dataset.category;

      // clicking the selected sidebar category again clears it

      state.category = state.category === value && value !== "all" ? "all" : value;
    } else {
      return;
    }
    render();
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setSidebarOpen(false);
    }
  });

  // Search + sort

  $("#search-input").addEventListener("input", (e) => { state.search = e.target.value; renderTasks(); });
  $("#sort-select").addEventListener("change", (e) => { state.sort = e.target.value; renderTasks(); });

  // Task list actions (event delegation)

  $("#task-list").addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    const item = event.target.closest(".task");
    if (!target || !item) return;
    const id = item.dataset.id;
    if (target.dataset.action === "edit") openEditModal(id);
    if (target.dataset.action === "delete") deleteTask(id);
  });
  $("#task-list").addEventListener("change", (event) => {
    if (event.target.dataset.action !== "toggle") return;
    toggleTask(event.target.closest(".task").dataset.id);
  });

  $("#clear-completed-btn").addEventListener("click", clearCompleted);

  // Task modal

  $("#task-form").addEventListener("submit", handleFormSubmit);
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#task-title").addEventListener("input", () => { $("#title-error").textContent = ""; $("#task-title").removeAttribute("aria-invalid"); });
  $("#task-category").addEventListener("change", () => { $("#category-error").textContent = ""; $("#task-category").removeAttribute("aria-invalid"); });

  // Click outside a dialog closes it

  $("#task-modal").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) closeModal(); });
  $("#confirm-modal").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) settleConfirm(false); });

  // Confirm modal

  $("#confirm-ok").addEventListener("click", () => settleConfirm(true));
  $("#confirm-cancel").addEventListener("click", () => settleConfirm(false));

  // Sidebar toggle
  $("#menu-btn").addEventListener("click", toggleSidebar);
  $("#scrim").addEventListener("click", () => setSidebarOpen(false));
  window.matchMedia("(min-width: 1024px)").addEventListener("change", (event) => {
    setSidebarOpen(event.matches);
  });

  // Keyboard: Escape closes the top-most layer; Tab stays inside open dialogs

  document.addEventListener("keydown", (event) => {
    const confirmOpen = !$("#confirm-modal").hidden;
    const taskOpen = !$("#task-modal").hidden;
    if (event.key === "Escape") {
      if (confirmOpen) settleConfirm(false);
      else if (taskOpen) closeModal();
      else setSidebarOpen(false);
    } else if (event.key === "Tab") {
      if (confirmOpen) trapFocus(event, $("#confirm-modal"));
      else if (taskOpen) trapFocus(event, $("#task-modal"));
    }
  });

  // Refresh "today"/overdue highlighting when the tab becomes visible again

  document.addEventListener("visibilitychange", () => { if (!document.hidden) { renderToday(); renderTasks(); } });
}
/* ---------- Init ---------- */

function init() {
  loadTheme();
  state.tasks = loadTasks();
  renderToday();
  bindEvents();
  setSidebarOpen(window.matchMedia("(min-width: 1024px)").matches);
  render();
}

init();