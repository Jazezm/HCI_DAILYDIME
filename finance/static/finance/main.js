const apiBase = '/api/';
// normalize token from several possible localStorage keys and guard against literal 'null'/'undefined'
let token = (() => {
    const keys = ['token', 'access', 'auth_token'];
    for (const k of keys) {
        const v = localStorage.getItem(k);
        if (v && v !== 'null' && v !== 'undefined') return v;
    }
    return null;
})();
function saveToken(t) {
    if (t && t !== 'null' && t !== 'undefined') {
        localStorage.setItem('token', t);
        token = t;
    } else {
        localStorage.removeItem('token');
        token = null;
    }
}
// <-- added: restore detached sidebar storage used by initApp
let _detachedSidebar = null;

// add a client-side cache of categories (names)
let CATEGORIES = [];

// Store transaction data for categories (keyed by category name or null for "All")
let CATEGORY_TRANSACTIONS = {};

// fallback categories kept for compatibility
const DEFAULT_CATEGORIES = {
    expense: ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Health', 'Rent', 'Utilities'],
    income: ['Salary', 'Business', 'Investment', 'Gift', 'Bonus']
};

async function fetchAllTransactions() {
    const res = await fetch(apiBase + 'transactions/', { headers: authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || data;
}
// fetch transactions with optional search (category/title/description)
async function fetchTransactions(search = null) {
    let url = apiBase + 'transactions/';
    if (search) url += '?search=' + encodeURIComponent(search);
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || data;
}
function authHeaders() {
    // ensure token is trimmed and valid before sending Authorization header
    if (token && typeof token === 'string') {
        const t = token.trim();
        if (t && t !== 'null' && t !== 'undefined') {
            return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` };
        }
    }
    return { 'Content-Type': 'application/json' };
}

function safeGet(id) {
    return document.getElementById(id);
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- INIT APP ---
async function initApp() {
    wireNav();
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('logout') === '1') {
        // use central saveToken helper to clear token
        saveToken(null);
        return showLoginForm();
    }
    if (!token) return showLoginForm();

    try {
        const res = await fetch(apiBase + 'user/', { headers: authHeaders() });
        if (res.status === 401) {
            logout();
            return;
        }
        if (!res.ok) {
            logout();
            return;
        }
        // reveal the main app layout (remove auth-only state)
        // reattach sidebar if it was detached earlier
        if (_detachedSidebar && !document.querySelector('.sidebar')) {
            const container = document.querySelector('.container');
            const main = document.querySelector('.main-content');
            if (container && main) container.insertBefore(_detachedSidebar, main);
            // re-wire nav handlers (elements preserved, but ensure listeners exist)
            try { wireNav(); } catch (e) { console.warn('wireNav failed on restore', e); }
            _detachedSidebar = null;
        }
        document.body.classList.remove('no-sidebar');

        // ensure categories are loaded for transaction forms & selects
        try { await refreshCategories(); } catch (e) { /* ignore */ }

        switchPage('dashboard');
        loadDashboard();
        loadProfile();
    } catch (err) {
        console.error('initApp: token verification failed', err);

        logout();
    }
}

// --- LOGIN / REGISTER ---
async function login(username, password) {
    try {
        const res = await fetch(apiBase + 'token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        let data;
        try { data = await res.json(); } catch (e) { data = await res.text(); }
        console.debug('login response', res.status, data);
        // accept multiple possible token fields
        const tok = (data && (data.access || data.token || data.auth_token)) || (typeof data === 'string' ? data : null);
        if (res.ok && tok) {
            saveToken(tok);
            // reload to ensure full app initialisation with the new token
            window.location.reload();
        } else {
            const errMsg = (data && (data.detail || data.non_field_errors || data)) || ('HTTP ' + res.status);
            const errEl = safeGet('auth-errors');
            if (errEl) errEl.innerText = errMsg;
            else alert('Login failed: ' + errMsg);
        }
    } catch (err) {
        console.error('Login error', err);
        alert('Network error during login');
    }
}

async function registerUser(username, password, email) {
    if (!username) {
        username = prompt('Choose a username:');
        if (!username) return alert('Cancelled');
    }
    if (!password) {
        password = prompt('Choose a password:');
        if (!password) return alert('Cancelled');
    }
    if (typeof email === 'undefined') {
        email = prompt('Email (optional):');
    }

    try {
        const res = await fetch(apiBase + 'register/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, email })
        });
        const data = await res.json();
        // accept various token field names returned by the API
        const tok = (data && (data.access || data.token || data.auth_token)) || null;
        if (tok) {
            saveToken(tok);
            window.location.reload();
        } else {
            const errMsg = data.detail || JSON.stringify(data);
            const errEl = safeGet('auth-errors');
            if (errEl) errEl.innerText = errMsg;
            else alert('Registration failed: ' + errMsg);
        }
    } catch (err) {
        console.error('Register error', err);
        alert('Network error during registration');
    }
}

function logout() {
    // centralize token removal and keep _detachedSidebar handling consistent
    saveToken(null);
    showLoginForm();
}

// --- SPA NAVIGATION ---
function wireNav() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const page = link.dataset.page;
            switchPage(page);
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });

    const newTxBtn = safeGet('new-transaction-trigger');
    if (newTxBtn) newTxBtn.onclick = () => switchPage('new-transaction-page');
    // wire the sidebar logout button (if present)
    const logoutBtn = safeGet('pf-logout');
    if (logoutBtn) logoutBtn.onclick = () => {
        if (confirm('Sign out?')) logout();
    };
    // mobile nav toggle: show/hide sidebar by toggling class on body
    const mobileToggle = safeGet('mobile-nav-toggle');
    if (mobileToggle) mobileToggle.onclick = () => document.body.classList.toggle('sidebar-open');
}

function switchPage(pageId) {
    // Set a friendly title and ensure pages are hidden/shown
    try { document.title = 'Daily Dime - ' + (pageId.charAt(0).toUpperCase() + pageId.slice(1)); } catch (e) { }
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const el = safeGet(pageId);
    if (!el) return console.warn('Page not found:', pageId);
    el.style.display = 'block';

    switch (pageId) {
        case 'dashboard': loadDashboard(); break;
        case 'transactions': loadTransactions(); break;
        case 'budgets': loadBudgets(); break;
        case 'profile': loadProfile(); break;
        case 'new-transaction-page': renderNewTransactionForm(); break;
        // ADDED: new components
        case 'categories': loadCategories(); break;
        case 'accounts': loadAccounts(); break;
        case 'goals': loadGoals(); break;
    }
}

// --- LOGIN FORM ---
function showLoginForm() {
    // hide sidebar for unauthenticated views
    document.body.classList.add('no-sidebar');
    // detach sidebar DOM so it's not present at all on auth pages
    try {
        const sb = document.querySelector('.sidebar');
        if (sb) {
            // remove and keep reference to reattach later
            _detachedSidebar = sb.parentNode.removeChild(sb);
        }
    } catch (e) {
        console.warn('Failed to detach sidebar', e);
    }
    const main = document.querySelector('.main-content');
    main.innerHTML = `
        <div class="page" id="login" style="display:block; padding:20px">
            <div class="auth-card">
                <h2 class="auth-title">Financial Tracker</h2>
                <div class="auth-tabs">
                    <button class="auth-tab active" data-mode="login">Login</button>
                    <button class="auth-tab" data-mode="signup">Signup</button>
                </div>
                <div class="auth-body">
                    <div id="auth-errors" class="auth-errors" style="color:#c0392b;margin-bottom:10px;"></div>
                    <div class="auth-form" id="auth-form">
                        <input id="auth-username" class="auth-input" placeholder="Username or Email" autocomplete="username">
                        <input id="auth-password" class="auth-input" type="password" placeholder="Password" autocomplete="current-password">
                        <div id="auth-extra"></div>
                        <button class="auth-button" id="auth-action">Login</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    function setAuthMode(mode) {
        const loginBtn = document.querySelector('.auth-tab[data-mode=login]');
        const signupBtn = document.querySelector('.auth-tab[data-mode=signup]');
        const authAction = safeGet('auth-action');
        const extra = safeGet('auth-extra');
        const errors = safeGet('auth-errors');
        errors.innerText = '';

        if (mode === 'signup') {
            loginBtn.classList.remove('active');
            signupBtn.classList.add('active');
            authAction.innerText = 'Signup';
            extra.innerHTML = `<input id="auth-email" class="auth-input" type="email" placeholder="Email (optional)"><input id="auth-confirm" class="auth-input" type="password" placeholder="Confirm password">`;
        } else {
            loginBtn.classList.add('active');
            signupBtn.classList.remove('active');
            authAction.innerText = 'Login';
            extra.innerHTML = '';
        }
    }
    const tabs = document.querySelectorAll('.auth-tab');
    if (tabs && tabs.length) {
        tabs.forEach(t => t.addEventListener('click', e => setAuthMode(t.dataset.mode)));
    } else { console.warn('No auth tabs found to wire'); }

    const authSwitch = safeGet('auth-switch');
    if (authSwitch) authSwitch.onclick = e => { e.preventDefault(); setAuthMode('signup'); };
    // auth-switch is optional in some layouts - silently ignore if it's not present

    const authActionEl = safeGet('auth-action');
    if (authActionEl) {
        authActionEl.onclick = async () => {
            const mode = document.querySelector('.auth-tab.active').dataset.mode;
            const username = safeGet('auth-username').value.trim();
            const password = safeGet('auth-password').value;
            if (!username || !password) return safeGet('auth-errors').innerText = 'Username and password required';
            if (mode === 'login') {
                await login(username, password);
            } else {
                const confirm = safeGet('auth-confirm').value;
                const email = safeGet('auth-email')?.value || '';
                if (password !== confirm) return safeGet('auth-errors').innerText = 'Passwords do not match';
                await registerUser(username, password, email);
            }
        };
    } else { console.warn('auth-action element not found - login action not wired'); }
    setAuthMode('login');
}

let pieChartInstance = null;
let barChartInstance = null;

// fetch categories from API and update cache + any open selects
async function refreshCategories() {
    try {
        // Derive categories from actual transactions (so it matches dashboard charts)
        const transactions = await fetchAllTransactions();
        const set = new Set();
        transactions.forEach(tx => {
            const nm = (tx.category && tx.category.trim()) ? tx.category.trim() : 'Uncategorized';
            set.add(nm);
        });
        CATEGORIES = Array.from(set);
        updateCategorySelects();
    } catch (err) {
        console.warn('refreshCategories error', err);
    }
}

// update all visible tx-category selects to reflect cached categories
function updateCategorySelects() {
    // find all elements that might be transaction category selects
    const selects = document.querySelectorAll('#tx-category');
    selects.forEach(sel => {
        const current = sel.value || '';
        // build options
        let opts = `<option value="">-- Select --</option>`;
        const list = (CATEGORIES && CATEGORIES.length) ? CATEGORIES : (DEFAULT_CATEGORIES.expense);
        list.forEach(name => {
            opts += `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(name)}</option>`;
        });
        opts += `<option value="__other"${current && !list.includes(current) ? ' selected' : ''}>Other...</option>`;
        sel.innerHTML = opts;
        // show/hide other input based on selection
        const other = sel.closest('.form-group')?.querySelector('#tx-category-other') || document.getElementById('tx-category-other');
        if (other) other.style.display = (sel.value === '__other' || (current && !list.includes(current))) ? 'block' : 'none';
    });
}

// format numbers with comma separators and two decimals
function formatCurrency(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadDashboard() {
    const dash = safeGet('dashboard');
    if (!dash) return;

    dash.innerHTML = `
        <div class="header">
            <h1>Dashboard</h1>
            <p>Welcome back! Here's your financial overview</p>
        </div>
        <div class="stats-row" id="dash-totals">Loading totals...</div>
        <div class="charts-section">
            <div class="chart-card"><h3>Spending by Category</h3><canvas id="pieChart"></canvas></div>
            <div class="chart-card"><h3>Income vs Expenses</h3><canvas id="barChart"></canvas></div>
        </div>
    `;

    try {
        // Totals
        const res = await fetch(apiBase + 'budgets/totals/', { headers: authHeaders() });
        if (!res.ok) return dash.querySelector('#dash-totals').innerText = 'Unable to load totals';
        const totals = await res.json();
        dash.querySelector('#dash-totals').innerHTML = `
            <div class="stat-card income-card"><h3>Total Income</h3><div class="amount pos">₱${formatCurrency(totals.total_income || 0)}</div></div>
            <div class="stat-card expense-card"><h3>Total Expenses</h3><div class="amount neg">₱${formatCurrency(totals.total_expense || 0)}</div></div>
            <div class="stat-card balance-card"><h3>Total Balance</h3><div class="amount">₱${formatCurrency(totals.total_balance || 0)}</div></div>
        `;


        const transactions = await fetchAllTransactions();

        const pieLabels = [];
        const pieData = [];
        const pieColors = [];
        const colorMap = {
            expense: ['#FF6384', '#FF9F40', '#FFCE56', '#9966FF', '#C0C0C0', '#4BC0C0'],
            income: ['#36A2EB', '#00b27a', '#8dd3c7', '#b3de69', '#80b1d3', '#fdb462']
        };
        let expenseIdx = 0, incomeIdx = 0;
        const pieTotals = {};
        transactions.forEach(tx => {
            const key = `${tx.transaction_type}: ${tx.category || 'Uncategorized'}`;
            if (!pieTotals[key]) pieTotals[key] = 0;
            pieTotals[key] += Number(tx.amount);
        });
        Object.entries(pieTotals).forEach(([key, value]) => {
            pieLabels.push(key);
            if (key.startsWith('expense')) {
                pieColors.push(colorMap.expense[expenseIdx % colorMap.expense.length]);
                expenseIdx++;
            } else {
                pieColors.push(colorMap.income[incomeIdx % colorMap.income.length]);
                incomeIdx++;
            }
            pieData.push(value);
        });

        if (pieChartInstance) pieChartInstance.destroy();
        const pieCtx = document.getElementById('pieChart').getContext('2d');
        pieChartInstance = new Chart(pieCtx, {
            type: 'pie',
            data: {
                labels: pieLabels,
                datasets: [{ data: pieData, backgroundColor: pieColors }]
            },
            options: { responsive: true }
        });

        if (barChartInstance) barChartInstance.destroy();
        const barCtx = document.getElementById('barChart').getContext('2d');
        const income = transactions.filter(t => t.transaction_type === 'income').reduce((a, b) => a + Number(b.amount), 0);
        const expense = transactions.filter(t => t.transaction_type === 'expense').reduce((a, b) => a + Number(b.amount), 0);
        barChartInstance = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: ['Income', 'Expenses'],
                datasets: [{ label: 'Amount', data: [income, expense], backgroundColor: ['#36A2EB', '#FF6384'] }]
            },
            options: { responsive: true }
        });

    } catch (err) {
        console.error('Dashboard error', err);
        dash.querySelector('#dash-totals').innerText = 'Network error loading totals';
    }
}

// --- PROFILE ---
async function loadProfile() {
    const el = safeGet('profile');
    if (!el) return;
    if (!token) return showLoginForm();

    el.innerHTML = '<div id="profile-info">Loading...</div>';

    try {
        const res = await fetch(apiBase + 'user/', { headers: authHeaders() });
        if (res.status === 401) return logout();
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            el.querySelector('#profile-info').innerHTML = `<p>Error loading profile (${res.status})</p><pre>${escapeHtml(text.slice(0, 1000))}</pre>`;
            console.error('loadProfile unexpected response', res.status, text);
            return;
        }
        const user = await res.json();
        const p = user.profile || {};
        let avatarSrc = '/static/finance/avatar_placeholder.svg';
        if (p.avatar) {
            if (p.avatar.startsWith('http') || p.avatar.startsWith('//') || p.avatar.startsWith('/')) avatarSrc = p.avatar;
            else avatarSrc = '/media/' + p.avatar;
        }
        // Render a read-only profile view with an Edit button.
        el.querySelector('#profile-info').innerHTML = `
            <div class="profile-grid">
                <div class="profile-card left">
                    <div class="profile-avatar">
                        <img id="pf-avatar-img" src="${avatarSrc}" alt="avatar">
                    </div>
                    <h2 id="pf-display-username">${escapeHtml(user.username)}</h2>
                    <div class="profile-badge">${escapeHtml(p.role || 'Member')}</div>
                </div>
                <div class="profile-card right">
                    <div class="profile-section">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                            <h3>Account Information</h3>
                            <button class="primary-btn" id="pf-edit">Edit Profile</button>
                        </div>
                        <div class="profile-fields" style="grid-template-columns: 1fr;">
                            <div><strong>First Name:</strong> <span id="pf-display-first">${escapeHtml(user.first_name || '')}</span></div>
                            <div><strong>Last Name:</strong> <span id="pf-display-last">${escapeHtml(user.last_name || '')}</span></div>
                            <div><strong>Username:</strong> <span id="pf-display-username2">${escapeHtml(user.username || '')}</span></div>
                            <div><strong>Email:</strong> <span id="pf-display-email">${escapeHtml(user.email || '')}</span></div>
                            <div><strong>Phone:</strong> <span id="pf-display-phone">${escapeHtml(p.phone || '')}</span></div>
                            <div><strong>Date of Birth:</strong> <span id="pf-display-dob">${escapeHtml(p.date_of_birth || '')}</span></div>
                            <div><strong>Address:</strong> <span id="pf-display-address">${escapeHtml(p.address || '')}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Update sidebar footer info (if present)
        const sidebarAvatar = safeGet('sidebar-avatar');
        const sidebarName = safeGet('sidebar-username');
        const sidebarRole = safeGet('sidebar-role');
        if (sidebarAvatar) sidebarAvatar.src = avatarSrc;
        if (sidebarName) sidebarName.innerText = escapeHtml(user.username || '');
        if (sidebarRole) sidebarRole.innerText = (p.role || 'Member');

        // Wire Edit button to replace the view with an editable form
        const editBtn = safeGet('pf-edit');
        if (editBtn) editBtn.onclick = () => {
            // render editable form (reuse previous structure)
            el.querySelector('#profile-info').innerHTML = `
                <div class="profile-grid">
                    <div class="profile-card left">
                        <div class="profile-avatar">
                            <img id="pf-avatar-img" src="${avatarSrc}" alt="avatar">
                            <div class="avatar-overlay"><button id="pf-avatar-btn">Change avatar</button></div>
                        </div>
                        <input type="file" id="pf-avatar-file" accept="image/*" style="display:none;">
                        <h2>${escapeHtml(user.username)}</h2>
                    </div>
                    <div class="profile-card right">
                        <div class="profile-section">
                            <h3>Edit Personal Information</h3>
                            <div class="profile-fields">
                                <label>First Name</label><input id="pf-first_name" value="${escapeHtml(user.first_name || '')}">
                                <label>Last Name</label><input id="pf-last_name" value="${escapeHtml(user.last_name || '')}">
                                <label>Username</label><input id="pf-username" value="${escapeHtml(user.username || '')}">
                                <label>Email Address</label><input id="pf-email" value="${escapeHtml(user.email || '')}">
                                <label>Phone Number</label><input id="pf-phone" value="${escapeHtml(p.phone || '')}">
                                <label>Date of Birth</label><input id="pf-date_of_birth" type="date" value="${p.date_of_birth || ''}">
                                <label>Address</label><input id="pf-address" value="${escapeHtml(p.address || '')}">
                            </div>
                            <div style="margin-top:14px; display:flex; gap:8px;">
                                <button class="primary-btn" id="pf-save">Save</button>
                                <button class="btn" id="pf-cancel">Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // wire save/cancel/avatar
            safeGet('pf-save').onclick = submitProfile;
            safeGet('pf-cancel').onclick = loadProfile;
            const avatarBtn = safeGet('pf-avatar-btn');
            const avatarFile = safeGet('pf-avatar-file');
            const avatarImg = safeGet('pf-avatar-img');
            if (avatarBtn && avatarFile && avatarImg) {
                avatarBtn.onclick = () => avatarFile.click();
                avatarFile.onchange = async () => {
                    const file = avatarFile.files[0];
                    if (!file) return;
                    
                    // Validate file size (5MB max)
                    if (file.size > 5 * 1024 * 1024) {
                        alert('File is too large. Maximum size is 5MB.');
                        avatarFile.value = '';
                        return;
                    }
                    
                    // Validate file type
                    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                    if (!validTypes.includes(file.type)) {
                        alert('Invalid file type. Please upload an image (JPG, PNG, GIF, or WebP).');
                        avatarFile.value = '';
                        return;
                    }
                    
                    // Show preview
                    const reader = new FileReader();
                    reader.onload = e => {
                        avatarImg.src = e.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            }
        };
    } catch (err) {
        console.error('loadProfile error', err);
        el.querySelector('#profile-info').innerHTML = '<p>Network error</p>';
    }
}

async function submitProfile() {
    try {
        const data = {
            first_name: safeGet('pf-first_name').value.trim(),
            last_name: safeGet('pf-last_name').value.trim(),
            username: safeGet('pf-username').value.trim(),
            email: safeGet('pf-email').value.trim(),
            profile: {
                phone: safeGet('pf-phone').value.trim(),
                address: safeGet('pf-address').value.trim(),
                date_of_birth: safeGet('pf-date_of_birth').value || null,
            }
        };
        const avatarInput = safeGet('pf-avatar-file');
        if (avatarInput && avatarInput.files && avatarInput.files.length) {
            await uploadAvatar(avatarInput.files[0]);
        }
        const res = await fetch(apiBase + 'user/', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(data) });
        if (res.ok) {
            await loadProfile();
        } else {
            const err = await res.json().catch(() => ({}));
            console.error('Profile save error', err);
            const msg = (function () {
                if (err.detail) return err.detail;
                if (err.profile && typeof err.profile === 'object') return JSON.stringify(err.profile);
                return JSON.stringify(err);
            })();
            alert('Failed to save profile: ' + msg);
        }
    } catch (err) {
        console.error(err);
        alert('Network error while saving profile');
    }
}

async function uploadAvatar(file) {
    try {
        // Validate file before upload
        const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            alert('Invalid file type. Please use JPG, PNG, GIF, or WebP.');
            return null;
        }
        if (file.size > 5 * 1024 * 1024) {
            alert('File too large. Maximum size is 5MB.');
            return null;
        }
        
        const fd = new FormData();
        fd.append('avatar', file);
        
        const res = await fetch(apiBase + 'user/avatar/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });
        
        if (!res.ok) {
            let errorMsg = 'Failed to upload avatar';
            try {
                const errorData = await res.json();
                if (errorData.error) {
                    errorMsg = errorData.error;
                }
            } catch (e) {
                console.error('Could not parse error response', e);
            }
            console.error('Avatar upload failed', res.status, errorMsg);
            alert(errorMsg);
            return null;
        }
        
        const result = await res.json();
        console.log('Avatar upload successful', result);
        return result;
    } catch (err) {
        console.error('Avatar upload error', err);
        alert('Network error uploading avatar');
        return null;
    }
}

// --- TRANSACTIONS ---
async function loadTransactions(search = null) {
    const el = safeGet('transactions');
    if (!el) return;
    const txList = el.querySelector('#tx-list');
    txList.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';

    try {
        const transactions = await fetchTransactions(search);
        // if a search term (category) was passed, show a header note
        const hdr = el.querySelector('.header');
        if (hdr) {
            const note = safeGet('category-filter-note') || document.createElement('div');
            note.id = 'category-filter-note';
            note.style.fontSize = '13px';
            note.style.color = 'var(--muted)';
            note.style.marginTop = '6px';
            note.innerText = search ? `Filtering by category or text: "${search}"` : '';
            if (!safeGet('category-filter-note')) hdr.appendChild(note);
            else hdr.replaceChild(note, safeGet('category-filter-note'));
        }
        if (!transactions.length) {
            txList.innerHTML = '<tr><td colspan="6">No transactions yet. Add one using the "+ New Transaction" button.</td></tr>';
            return;
        }

        txList.innerHTML = transactions.map(t => `
            <tr data-id="${t.id}">
                <td>${escapeHtml(t.title)}</td>
                <td>${escapeHtml((t.transaction_type || '').charAt(0).toUpperCase() + (t.transaction_type || '').slice(1))}</td>
                <td class="${t.transaction_type === 'expense' ? 'neg' : 'pos'}">₱${formatCurrency(t.amount)}</td>
                <td>${escapeHtml(t.category || '')}</td>
                <td>${escapeHtml(t.date)}</td>
                <td>
                    <button class="btn" onclick="editTransaction(${t.id})">Edit</button>
                    <button class="btn danger-btn" onclick="deleteTransaction(${t.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        txList.innerHTML = '<tr><td colspan="6">Network error loading transactions</td></tr>';
    }
}

// Called when a category is clicked in the categories page
function filterByCategory(name) {
    // use search API to filter by category (search covers category field)
    switchPage('transactions');
    // delay a tick so the transactions page is visible
    setTimeout(() => loadTransactions(name), 50);
}

// replace tx-category input with a select using DEFAULT_CATEGORIES
function renderCategorySelect(type, selected = '') {
    const list = DEFAULT_CATEGORIES[type] || [];
    let options = `<option value="">-- Select --</option>`;
    list.forEach(c => options += `<option value="${escapeHtml(c)}"${c === selected ? ' selected' : ''}>${escapeHtml(c)}</option>`);
    options += `<option value="__other"${selected && !list.includes(selected) ? ' selected' : ''}>Other...</option>`;
    return `<select id="tx-category" class="form-input">${options}</select>
            <input id="tx-category-other" class="form-input" placeholder="Custom category" style="display:${selected && !list.includes(selected) ? 'block' : 'none'};margin-top:8px;" value="${escapeHtml(list.includes(selected) ? '' : selected)}">`;
}

function renderNewTransactionForm(transaction = null) {
    let el = safeGet('new-transaction-form');
    if (!el) el = safeGet('new-transaction-page');
    if (!el) return;

    const t = transaction || {
        title: '', transaction_type: 'expense', amount: '', category: '', description: '', date: new Date().toISOString().slice(0, 10)
    };

    // build category selection markup (use cache if available)
    // the select id is tx-category; updateCategorySelects will populate it after DOM insert
    const initialCategory = t.category || '';
    let categoryMarkup = `<select id="tx-category" class="form-input"><option value="">Loading…</option></select>
		<input id="tx-category-other" class="form-input" placeholder="Custom category" style="display:none;margin-top:8px;" value="${escapeHtml(initialCategory)}">`;

    el.innerHTML = `
        <div class="transaction-form modern-form">
            <h2 class="form-title">${transaction ? 'Edit' : 'New'} Transaction</h2>
            <p class="form-subtitle">Create a new transaction record</p>
            <div class="form-section">
                <div class="form-label">Transaction Type</div>
                <div class="transaction-type-selector">
                    <div class="type-option${t.transaction_type === 'expense' ? ' active expense' : ''}" id="type-expense" onclick="document.getElementById('tx-type').value='expense';document.getElementById('type-expense').classList.add('active','expense');document.getElementById('type-income').classList.remove('active','income');">
                        <div class="type-icon"><span style="font-size:40px;color:#ff4757;">&#8595;</span></div>
                        <h3>Expense</h3>
                        <p>Money Spent</p>
                    </div>
                    <div class="type-option${t.transaction_type === 'income' ? ' active income' : ''}" id="type-income" onclick="document.getElementById('tx-type').value='income';document.getElementById('type-income').classList.add('active','income');document.getElementById('type-expense').classList.remove('active','expense');">
                        <div class="type-icon"><span style="font-size:40px;color:#00b27a;">&#8593;</span></div>
                        <h3>Income</h3>
                        <p>Money received</p>
                    </div>
                </div>
                <select id="tx-type" style="display:none;">
                    <option value="expense" ${t.transaction_type === 'expense' ? 'selected' : ''}>Expense</option>
                    <option value="income" ${t.transaction_type === 'income' ? 'selected' : ''}>Income</option>
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="tx-title">Title</label>
                    <input class="form-input" id="tx-title" type="text" placeholder="Title" value="${escapeHtml(t.title)}">
                </div>
                <div class="form-group">
                    <label class="form-label" for="tx-amount">&#x1F4B0; Amount</label>
                    <input class="form-input" id="tx-amount" type="number" placeholder="Input Amount" value="${t.amount}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="tx-category">&#128230; Category</label>
                    ${categoryMarkup}
                </div>
                <div class="form-group">
                    <label class="form-label" for="tx-date">&#128197; Date</label>
                    <input class="form-input" id="tx-date" type="date" value="${t.date.slice(0, 10)}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label class="form-label" for="tx-desc">&#128221; Description</label>
                    <input class="form-input" id="tx-desc" placeholder="What was this for?" value="${escapeHtml(t.description)}">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-cancel" onclick="switchPage('transactions')">Cancel</button>
                <button type="button" class="btn btn-submit" onclick="submitTransaction(${transaction ? transaction.id : 'null'})">${transaction ? 'Save' : 'Add Transaction'}</button>
            </div>
        </div>
    `;

    // after insertion, populate select from cache (or refresh then populate)
    updateCategorySelects();

    // ensure onchange shows/hides "other" input
    const sel = safeGet('tx-category');
    const other = safeGet('tx-category-other');
    if (sel) {
        sel.onchange = () => {
            if (other) other.style.display = (sel.value === '__other') ? 'block' : 'none';
        };
        // if cache empty, trigger a refresh to populate
        if ((!CATEGORIES || !CATEGORIES.length)) refreshCategories();
    }
}

// ensure submitTransaction reads category correctly (handle "Other")
async function submitTransaction(id = null) {
    // read category value from select and optional other input
    let category = '';
    const catEl = safeGet('tx-category');
    if (catEl) {
        category = catEl.value === '__other' ? (safeGet('tx-category-other')?.value || '') : catEl.value;
    } else {
        category = safeGet('tx-category')?.value || '';
    }

    const payload = {
        title: safeGet('tx-title').value,
        transaction_type: safeGet('tx-type').value,
        amount: Number(safeGet('tx-amount').value),
        category: category,
        description: safeGet('tx-desc').value,
        date: safeGet('tx-date').value
    };

    try {
        const res = await fetch(apiBase + 'transactions/' + (id ? id + '/' : ''), {
            method: id ? 'PUT' : 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            // refresh categories cache so it includes the new transaction's category
            await refreshCategories();
            // reload categories page to show updated list
            await loadCategories();
            switchPage('transactions');
            setTimeout(() => loadTransactions(), 100);
            await loadDashboard();
        } else {
            if (res.status === 401) { alert('Session expired. Please log in again.'); logout(); return; }
            const parsed = await _safeRequest(res);
            console.error('submitTransaction error', parsed.data || parsed.text || res.status);
            alert(parsed.data?.detail || 'Error saving transaction');
        }
    } catch (err) {
        console.error(err);
        alert('Network error');
    }
}

function editTransaction(id) {
    fetch(apiBase + 'transactions/' + id + '/', { headers: authHeaders() })
        .then(r => r.json())
        .then(t => {
            renderNewTransactionForm(t);
            switchPage('new-transaction-page');
        })
        .catch(err => alert('Unable to load transaction'));
}

async function deleteTransaction(id) {
    if (!confirm('Delete this transaction?')) return;
    try {
        const res = await fetch(apiBase + 'transactions/' + id + '/', { method: 'DELETE', headers: authHeaders() });
        if (res.ok) {
            await loadTransactions();
            await loadDashboard();
        } else alert('Failed to delete transaction');
    } catch (err) {
        console.error(err);
        alert('Network error');
    }
}

// --- BUDGETS ---
function renderNewBudgetForm(budget = null) {
    const el = safeGet('budgets');
    if (!el) return;
    // Remove existing form if present so we can re-open for edit
    if (safeGet('new-budget-form')) safeGet('new-budget-form').remove();

    const b = budget || { name: '', amount: '', spent: '' };
    const header = el.querySelector('.budget-header');

    header.insertAdjacentHTML('afterend', `
        <div id="new-budget-form" style="margin:10px 0; padding:10px; border:1px solid #ccc; border-radius:8px; background:#fff;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <input id="budget-name" placeholder="Budget Name" value="${escapeHtml(b.name)}" style="flex:2;">
                <input type="number" id="budget-amount" placeholder="Total Amount" value="${b.amount}" style="flex:1;">
                <input type="number" id="budget-spent" placeholder="Amount Spent" value="${b.spent}" style="flex:1;">
                <div style="display:flex;gap:8px;">
                    <button class="primary-btn" onclick="createBudget(${budget ? budget.id : 'null'})">${budget ? 'Save' : 'Create'}</button>
                    <button onclick="document.getElementById('new-budget-form').remove()" class="btn">Cancel</button>
                </div>
            </div>
        </div>
    `);
}

async function loadBudgets() {
    const el = safeGet('budgets');
    if (!el) return;

    el.innerHTML = `
        <div class="header budget-header">
            <div>
                <h1>Budgets</h1>
                <p>Manage your budgets and view statistics</p>
            </div>
            <button class="primary-btn" id="new-budget-btn"><i class="fas fa-plus"></i> New Budget</button>
        </div>
        <div class="budget-stats stats-row" id="budget-totals">Loading...</div>
        <div id="bud-list"></div>
    `;

    safeGet('new-budget-btn').onclick = renderNewBudgetForm;

    try {
        const res = await fetch(apiBase + 'budgets/', { headers: authHeaders() });
        if (!res.ok) { safeGet('bud-list').innerHTML = '<p>Failed to load budgets</p>'; return; }
        const payload = await res.json();
        const data = payload.results || payload;
        if (!data.length) {
            safeGet('bud-list').innerHTML = '<p>No budgets yet</p>';
            safeGet('budget-totals').innerHTML = '';
            return;
        }

        safeGet('bud-list').innerHTML = data.map(b => `
            <div class="budget-item" data-id="${b.id}">
                <div>
                    <strong>${escapeHtml(b.name)}</strong>
                    <div style="font-size:13px;color:var(--muted);">Amount: ₱${formatCurrency(b.amount)} • Spent: ₱${formatCurrency(b.spent || 0)}</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <div style="text-align:right;margin-right:8px;">Remaining<br><strong>₱${formatCurrency(b.remaining || (Number(b.amount || 0) - Number(b.spent || 0)))}</strong></div>
                    <button class="btn" onclick="editBudget(${b.id})">Edit</button>
                    <button class="btn danger-btn" onclick="deleteBudget(${b.id})">Delete</button>
                </div>
            </div>
        `).join('');

        const totalBudget = data.reduce((a, b) => a + Number(b.amount), 0);
        const totalSpent = data.reduce((a, b) => a + Number(b.spent || 0), 0);
        const totalRemaining = data.reduce((a, b) => a + Number(b.remaining || (Number(b.amount || 0) - Number(b.spent || 0))), 0);

        safeGet('budget-totals').innerHTML = `
            <div class="stat-card"><h3>Total Budget</h3><div class="amount">₱${formatCurrency(totalBudget)}</div></div>
            <div class="stat-card"><h3>Total Spent</h3><div class="amount neg">₱${formatCurrency(totalSpent)}</div></div>
            <div class="stat-card"><h3>Total Remaining</h3><div class="amount pos">₱${formatCurrency(totalRemaining)}</div></div>
        `;
    } catch (err) {
        console.error(err);
        safeGet('bud-list').innerHTML = '<p>Network error loading budgets</p>';
    }
}

async function createBudget(id = null) {
    const name = safeGet('budget-name').value.trim();
    const amount = parseFloat(safeGet('budget-amount').value);
    const spent = parseFloat(safeGet('budget-spent').value) || 0;

    if (!name || isNaN(amount) || isNaN(spent)) {
        alert('Invalid budget name, amount, or spent value');
        return;
    }

    try {
        const res = await fetch(apiBase + 'budgets/' + (id ? id + '/' : ''), {
            method: id ? 'PUT' : 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name, amount, spent })
        });
        if (res.ok) {
            safeGet('new-budget-form')?.remove();
            await loadBudgets();
            await loadDashboard();
        } else {
            if (res.status === 401) { alert('Session expired. Please log in again.'); logout(); return; }
            const parsed = await _safeRequest(res);
            console.error('createBudget error', parsed.data || parsed.text || res.status);
            alert(parsed.data?.detail || 'Failed to save budget');
        }
    } catch (err) {
        console.error(err);
        alert('Network error saving budget');
    }
}

async function deleteBudget(id) {
    if (!confirm('Delete this budget?')) return;
    try {
        const res = await fetch(apiBase + 'budgets/' + id + '/', { method: 'DELETE', headers: authHeaders() });
        if (res.ok) {
            await loadBudgets();
            await loadDashboard();
        } else alert('Failed to delete budget');
    } catch (err) {
        console.error(err);
        alert('Network error');
    }
}

function editBudget(id) {
    fetch(apiBase + 'budgets/' + id + '/', { headers: authHeaders() })
        .then(r => r.json())
        .then(b => {
            switchPage('budgets');
            renderNewBudgetForm(b);
            setTimeout(() => {
                const f = safeGet('new-budget-form');
                if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
        })
        .catch(err => alert('Unable to load budget'));
}

// -------------------- CATEGORIES --------------------
function renderNewCategoryForm(category = null) {
    // Category form removed - categories are now auto-derived from transactions
    return;
}

async function loadCategories() {
    const page = safeGet('categories');
    if (!page) return;
    const list = safeGet('cat-list');
    if (!list) return;
    list.innerHTML = '<div>Loading categories...</div>';
    try {
        // Attempt to get transactions (primary source)
        let transactions = [];
        try {
            transactions = await fetchAllTransactions();
            console.debug('loadCategories: fetched transactions count=', (transactions && transactions.length) || 0);
        } catch (err) {
            console.warn('loadCategories: fetchAllTransactions threw', err);
            transactions = [];
        }

        // If no transactions, fall back to cached CATEGORIES (from refreshCategories)
        let usedFromCache = false;
        if ((!transactions || !transactions.length) && (CATEGORIES && CATEGORIES.length)) {
            console.debug('loadCategories: no transactions, using cached CATEGORIES count=', CATEGORIES.length);
            // build a fake transactions-like set with zero totals
            transactions = CATEGORIES.map(n => ({ id: null, title: '', transaction_type: '', amount: 0, category: n, date: '' }));
            usedFromCache = true;
        }

        if (!transactions || !transactions.length) {
            list.innerHTML = `<div>No categories found${token ? ', add transactions to create categories' : ' — please log in'}.</div>`;
            return;
        }

        // Build category stats - grouped by category name only (combining all transaction types)
        const categoryStats = {};
        transactions.forEach(tx => {
            const catName = tx.category || 'Uncategorized';
            if (!categoryStats[catName]) {
                categoryStats[catName] = {
                    name: catName,
                    total: 0,
                    count: 0,
                    expenses: 0,
                    income: 0,
                    transactions: []
                };
            }
            categoryStats[catName].total += Number(tx.amount || 0);
            categoryStats[catName].count += 1;
            if (tx.transaction_type === 'expense') {
                categoryStats[catName].expenses += Number(tx.amount || 0);
            } else {
                categoryStats[catName].income += Number(tx.amount || 0);
            }
            categoryStats[catName].transactions.push(tx);
        });

        const categoryNames = Object.keys(categoryStats).sort();
        const rows = [];
        const totalSum = transactions.reduce((a, b) => a + Number(b.amount || 0), 0);

        // Clear and rebuild the global transactions cache
        CATEGORY_TRANSACTIONS = {};
        CATEGORY_TRANSACTIONS['__all__'] = transactions;

        // Add "All Transactions" row
        rows.push(`
            <div class="category-row" data-expanded="false" data-category-key="__all__" style="background:#f9f9f9;border-left:4px solid #36A2EB;cursor:pointer;" onclick="toggleCategoryDetails(this)">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;">
                    <div>
                        <strong>All Transactions</strong>
                        <div style="font-size:13px;color:var(--muted);margin-top:2px;">Combined view</div>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <div style="text-align:right;margin-right:8px;">
                            <strong>₱${formatCurrency(totalSum || 0)}</strong><br>
                            <span style="font-size:12px;">${transactions.length} transactions</span>
                        </div>
                        <span class="category-toggle" style="font-size:18px;display:inline-block;transition:transform 0.3s ease;transform-origin:center;">▼</span>
                    </div>
                </div>
                <div class="category-details" style="display:none;max-height:0;overflow:hidden;transition:max-height 0.3s ease,opacity 0.3s ease;opacity:0;"></div>
            </div>
        `);

        // Add category rows (grouped by name, clickable to toggle details)
        categoryNames.forEach(catName => {
            const stats = categoryStats[catName];
            CATEGORY_TRANSACTIONS[catName] = stats.transactions;
            
            const hasExpenses = stats.expenses > 0;
            const hasIncome = stats.income > 0;
            let typeLabel = '';
            if (hasExpenses && hasIncome) typeLabel = '💸 Expenses & 💰 Income';
            else if (hasExpenses) typeLabel = '💸 Expenses';
            else typeLabel = '💰 Income';
            
            rows.push(`
                <div class="category-row" data-expanded="false" data-category-key="${escapeHtml(catName)}" style="border-left:4px solid ${hasExpenses ? '#FF6384' : '#36A2EB'};cursor:pointer;" onclick="toggleCategoryDetails(this)">
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff;">
                        <div>
                            <strong>${escapeHtml(stats.name)}</strong>
                            <div style="font-size:13px;color:var(--muted);margin-top:2px;">${typeLabel}</div>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            <div style="text-align:right;margin-right:8px;">
                                <strong>₱${formatCurrency(stats.total || 0)}</strong><br>
                                <span style="font-size:12px;">${stats.count} transaction${stats.count !== 1 ? 's' : ''}</span>
                            </div>
                            <span class="category-toggle" style="font-size:18px;display:inline-block;transition:transform 0.3s ease;transform-origin:center;">▼</span>
                        </div>
                    </div>
                    <div class="category-details" style="display:none;max-height:0;overflow:hidden;transition:max-height 0.3s ease,opacity 0.3s ease;opacity:0;"></div>
                </div>
            `);
        });

        list.innerHTML = rows.join('');
    } catch (err) {
        console.error('loadCategories', err);
        list.innerHTML = `<div>Network error loading categories: ${escapeHtml(err && err.message ? err.message : String(err))}</div>`;
    }
}

// Toggle category details with slide animation
function toggleCategoryDetails(element) {
    const detailsDiv = element.querySelector('.category-details');
    const toggleSpan = element.querySelector('.category-toggle');
    const categoryKey = element.getAttribute('data-category-key');
    const isExpanded = element.getAttribute('data-expanded') === 'true';

    if (isExpanded) {
        // Collapse
        element.setAttribute('data-expanded', 'false');
        detailsDiv.style.maxHeight = '0px';
        detailsDiv.style.opacity = '0';
        setTimeout(() => { 
            detailsDiv.style.display = 'none'; 
        }, 300);
        if (toggleSpan) {
            toggleSpan.style.transform = 'rotate(0deg)';
        }
    } else {
        // Expand and show details
        element.setAttribute('data-expanded', 'true');
        detailsDiv.style.display = 'block';
        
        // Get transactions from global cache
        const transactions = CATEGORY_TRANSACTIONS[categoryKey] || [];
        
        // Build details content
        let filtered = transactions;
        let categoryTitle = 'All Transactions';
        
        if (categoryKey !== '__all__') {
            categoryTitle = categoryKey;
            filtered = transactions.filter(tx => (tx.category || 'Uncategorized') === categoryKey);
        }

        const total = filtered.reduce((a, b) => a + Number(b.amount || 0), 0);
        const expenses = filtered.filter(t => t.transaction_type === 'expense').reduce((a, b) => a + Number(b.amount || 0), 0);
        const income = filtered.filter(t => t.transaction_type === 'income').reduce((a, b) => a + Number(b.amount || 0), 0);

        const detailsHTML = `
            <div style="padding:16px;background:#fafafa;border-top:1px solid #eee;">
                <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:120px;padding:12px;background:#fff;border-radius:6px;border-left:4px solid #36A2EB;">
                        <div style="font-size:12px;color:var(--muted);">Total</div>
                        <div style="font-size:20px;font-weight:bold;color:#333;">₱${formatCurrency(total)}</div>
                    </div>
                    ${expenses > 0 ? `
                    <div style="flex:1;min-width:120px;padding:12px;background:#fff;border-radius:6px;border-left:4px solid #FF6384;">
                        <div style="font-size:12px;color:var(--muted);">Expenses</div>
                        <div style="font-size:20px;font-weight:bold;color:#ff4757;">-₱${formatCurrency(expenses)}</div>
                    </div>
                    ` : ''}
                    ${income > 0 ? `
                    <div style="flex:1;min-width:120px;padding:12px;background:#fff;border-radius:6px;border-left:4px solid #00b27a;">
                        <div style="font-size:12px;color:var(--muted);">Income</div>
                        <div style="font-size:20px;font-weight:bold;color:#00b27a;">+₱${formatCurrency(income)}</div>
                    </div>
                    ` : ''}
                </div>
                <div style="background:#fff;border-radius:6px;overflow:hidden;border:1px solid #eee;">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f5f5f5;border-bottom:1px solid #ddd;">
                                <th style="padding:10px;text-align:left;color:#666;">Date</th>
                                <th style="padding:10px;text-align:left;color:#666;">Title</th>
                                <th style="padding:10px;text-align:left;color:#666;">Type</th>
                                <th style="padding:10px;text-align:right;color:#666;">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.map(tx => `
                                <tr style="border-bottom:1px solid #eee;">
                                    <td style="padding:10px;color:#666;">${escapeHtml(tx.date)}</td>
                                    <td style="padding:10px;color:#333;">${escapeHtml(tx.title)}</td>
                                    <td style="padding:10px;color:#666;">${tx.transaction_type === 'expense' ? '💸 Expense' : '💰 Income'}</td>
                                    <td style="padding:10px;text-align:right;color:${tx.transaction_type === 'expense' ? '#ff4757' : '#00b27a'};font-weight:bold;">
                                        ${tx.transaction_type === 'expense' ? '-' : '+'}₱${formatCurrency(tx.amount)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        detailsDiv.innerHTML = detailsHTML;
        
        // Force reflow before animation
        detailsDiv.offsetHeight;
        detailsDiv.style.maxHeight = '2000px';
        detailsDiv.style.opacity = '1';
        
        if (toggleSpan) {
            toggleSpan.style.transform = 'rotate(180deg)';
        }
    }
}

async function createCategory(id = null) {
    // Category creation removed - categories are auto-derived from transactions
    return;
}

function editCategory(id) {
    // Category editing removed
    return;
}

async function deleteCategory(id) {
    // Category deletion removed
    return;
}

// -------------------- ACCOUNTS --------------------
function renderNewAccountForm(account = null) {
    const page = safeGet('accounts');
    if (!page) return;
    safeGet('new-account-form')?.remove();
    const a = account || { name: '', account_type: 'Checking', balance: '' };
    const container = safeGet('acc-list') || page;
    container.insertAdjacentHTML('afterbegin', `
		<div id="new-account-form" style="background:#fff;padding:12px;border-radius:8px;margin-bottom:12px;">
			<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
				<input id="account-name" placeholder="Account Name" value="${escapeHtml(a.name)}" style="flex:2;">
				<select id="account-type" style="flex:1;">
					<option${a.account_type === 'Checking' ? ' selected' : ''}>Checking</option>
					<option${a.account_type === 'Savings' ? ' selected' : ''}>Savings</option>
					<option${a.account_type === 'Cash' ? ' selected' : ''}>Cash</option>
					<option${a.account_type === 'Credit Card' ? ' selected' : ''}>Credit Card</option>
				</select>
				<input id="account-balance" type="number" placeholder="Balance" value="${a.balance}" style="flex:1;">
				<div style="display:flex;gap:8px;">
					<button class="primary-btn" id="account-save">${account ? 'Save' : 'Create'}</button>
					<button class="btn" id="account-cancel">Cancel</button>
				</div>
			</div>
		</div>
	`);
    safeGet('account-cancel').onclick = () => safeGet('new-account-form')?.remove();
    safeGet('account-save').onclick = () => createAccount(account ? account.id : null);
}

async function loadAccounts() {
    const el = safeGet('accounts');
    if (!el) return;
    const list = safeGet('acc-list');
    if (!list) return;
    list.innerHTML = '<div>Loading accounts...</div>';
    try {
        const res = await fetch(apiBase + 'accounts/', { headers: authHeaders() });
        if (!res.ok) { list.innerHTML = '<div>Failed to load accounts</div>'; return; }
        const payload = await res.json();
        const data = payload.results || payload;
        if (!data.length) { list.innerHTML = '<div>No accounts yet</div>'; return; }
        list.innerHTML = data.map(a => `
			<div class="budget-item">
				<div><strong>${escapeHtml(a.name)}</strong><div style="font-size:13px;color:var(--muted)">${escapeHtml(a.account_type || '')}</div></div>
				<div style="display:flex;gap:8px;align-items:center;">
					<div style="text-align:right;margin-right:8px;">Balance<br><strong>₱${formatCurrency(a.balance || 0)}</strong></div>
					<button class="btn" onclick="editAccount(${a.id})">Edit</button>
					<button class="btn danger-btn" onclick="deleteAccount(${a.id})">Delete</button>
				</div>
			</div>
		`).join('');
    } catch (err) {
        console.error('loadAccounts', err);
        list.innerHTML = '<div>Network error loading accounts</div>';
    }
}

async function createAccount(id = null) {
    const name = safeGet('account-name')?.value.trim();
    const type = safeGet('account-type')?.value;
    const balance = parseFloat(safeGet('account-balance')?.value) || 0;
    if (!name) return alert('Account name required');
    try {
        const res = await fetch(apiBase + 'accounts/' + (id ? id + '/' : ''), {
            method: id ? 'PUT' : 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name, account_type: type, balance })
        });
        if (res.ok) {
            safeGet('new-account-form')?.remove();
            await loadAccounts();
        } else {
            // parse safely and handle 401
            if (res.status === 401) {
                alert('Session expired. Please log in again.');
                logout();
                return;
            }
            const parsed = await _safeRequest(res);
            console.error('createAccount error', parsed.data || parsed.text || res.status);
            alert(parsed.data?.detail || 'Failed to save account');
        }
    } catch (err) {
        console.error(err);
        alert('Network error saving account');
    }
}

function editAccount(id) {
    fetch(apiBase + 'accounts/' + id + '/', { headers: authHeaders() })
        .then(r => r.json())
        .then(a => renderNewAccountForm(a))
        .catch(() => alert('Unable to load account'));
}

async function deleteAccount(id) {
    if (!confirm('Delete this account?')) return;
    try {
        const res = await fetch(apiBase + 'accounts/' + id + '/', { method: 'DELETE', headers: authHeaders() });
        if (res.ok) await loadAccounts();
        else alert('Failed to delete account');
    } catch (err) {
        console.error(err);
        alert('Network error');
    }
}

// -------------------- GOALS --------------------
function renderNewGoalForm(goal = null) {
    const page = safeGet('goals');
    if (!page) return;
    safeGet('new-goal-form')?.remove();
    const g = goal || { name: '', target_amount: '', current_amount: 0, target_date: '' };
    const container = safeGet('goal-list') || page;
    container.insertAdjacentHTML('afterbegin', `
		<div id="new-goal-form" style="background:#fff;padding:12px;border-radius:8px;margin-bottom:12px;">
			<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
				<input id="goal-name" placeholder="Goal Name" value="${escapeHtml(g.name)}" style="flex:2;">
				<input id="goal-target" type="number" placeholder="Target Amount" value="${g.target_amount}" style="flex:1;">
				<input id="goal-current" type="number" placeholder="Current Amount" value="${g.current_amount || 0}" style="flex:1;">
				<input id="goal-date" type="date" value="${g.target_date || ''}" style="flex:1;">
				<div style="display:flex;gap:8px;">
					<button class="primary-btn" id="goal-save">${goal ? 'Save' : 'Create'}</button>
					<button class="btn" id="goal-cancel">Cancel</button>
				</div>
			</div>
		</div>
	`);
    safeGet('goal-cancel').onclick = () => safeGet('new-goal-form')?.remove();
    safeGet('goal-save').onclick = () => createGoal(goal ? goal.id : null);
}

async function loadGoals() {
    const el = safeGet('goals');
    if (!el) return;
    const list = safeGet('goal-list');
    if (!list) return;
    list.innerHTML = '<div>Loading goals...</div>';
    try {
        const res = await fetch(apiBase + 'goals/', { headers: authHeaders() });
        if (!res.ok) { list.innerHTML = '<div>Failed to load goals</div>'; return; }
        const payload = await res.json();
        const data = payload.results || payload;
        if (!data.length) { list.innerHTML = '<div>No goals yet</div>'; return; }
        list.innerHTML = data.map(g => {
            const pct = g.target_amount ? Math.min(100, Math.round((g.current_amount || 0) / g.target_amount * 100)) : 0;
            return `
			<div class="budget-item">
				<div>
					<strong>${escapeHtml(g.name)}</strong>
					<div style="font-size:13px;color:var(--muted)">Target: ₱${formatCurrency(g.target_amount || 0)} • Current: ₱${formatCurrency(g.current_amount || 0)}</div>
				</div>
				<div style="display:flex;gap:8px;align-items:center;">
					<div style="text-align:right;margin-right:8px;">${pct}%</div>
					<button class="btn" onclick="editGoal(${g.id})">Edit</button>
					<button class="btn danger-btn" onclick="deleteGoal(${g.id})">Delete</button>
				</div>
			</div>`;
        }).join('');
    } catch (err) {
        console.error('loadGoals', err);
        list.innerHTML = '<div>Network error loading goals</div>';
    }
}

async function createGoal(id = null) {
    const name = safeGet('goal-name')?.value.trim();
    const target = parseFloat(safeGet('goal-target')?.value) || 0;
    const current = parseFloat(safeGet('goal-current')?.value) || 0;
    const date = safeGet('goal-date')?.value || null;
    if (!name || !target) return alert('Goal name and target amount required');
    try {
        const res = await fetch(apiBase + 'goals/' + (id ? id + '/' : ''), {
            method: id ? 'PUT' : 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name, target_amount: target, current_amount: current, target_date: date })
        });
        if (res.ok) {
            safeGet('new-goal-form')?.remove();
            await loadGoals();
        } else {
            if (res.status === 401) { alert('Session expired. Please log in again.'); logout(); return; }
            const parsed = await _safeRequest(res);
            console.error('createGoal error', parsed.data || parsed.text || res.status);
            alert(parsed.data?.detail || 'Failed to save goal');
        }
    } catch (err) {
        console.error(err);
        alert('Network error saving goal');
    }
}

function editGoal(id) {
    fetch(apiBase + 'goals/' + id + '/', { headers: authHeaders() })
        .then(r => r.json())
        .then(g => renderNewGoalForm(g))
        .catch(() => alert('Unable to load goal'));
}

async function deleteGoal(id) {
    if (!confirm('Delete this goal?')) return;
    try {
        const res = await fetch(apiBase + 'goals/' + id + '/', { method: 'DELETE', headers: authHeaders() });
        if (res.ok) await loadGoals();
        else alert('Failed to delete goal');
    } catch (err) {
        console.error(err);
        alert('Network error');
    }
}

// Wire page buttons when page loads (defensive - in case elements exist)
document.addEventListener('click', e => {
    // new page buttons might exist in DOM and are handled by loadX functions,
    // but guard here to attach if clicked before load finished.
    // Category creation removed - categories are auto-derived from transactions
    if (e.target && e.target.id === 'new-account-btn') renderNewAccountForm();
    if (e.target && e.target.id === 'new-goal-btn') renderNewGoalForm();
});

window.addEventListener('DOMContentLoaded', initApp);
