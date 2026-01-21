const params = new URLSearchParams(window.location.search);
const token = params.get('t');
const apiParam = params.get('api');

const storedApi = localStorage.getItem('apiBase') || '';
const configApi = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '';
const apiBase = (apiParam || storedApi || configApi || window.location.origin).replace(/\/$/, '');
if (apiParam) localStorage.setItem('apiBase', apiParam);

document.getElementById('api-chip').textContent = `API: ${apiBase}`;

const studentName = document.getElementById('student-name');
const credits = document.getElementById('credits');
const nextLesson = document.getElementById('next-lesson');
const registrationOpen = document.getElementById('registration-open');
const registrationStatus = document.getElementById('registration-status');
const registerBtn = document.getElementById('register-btn');
const cancelBtn = document.getElementById('cancel-btn');

const adminStatus = document.getElementById('admin-status');
const adminTokenInput = document.getElementById('admin-token');
const toggleAdminTokenBtn = document.getElementById('toggle-admin-token');
const saveAdminTokenBtn = document.getElementById('save-admin-token');
const apiBaseInput = document.getElementById('api-base');
const saveApiBaseBtn = document.getElementById('save-api-base');
const studentNameInput = document.getElementById('student-name-input');
const addStudentBtn = document.getElementById('add-student-btn');
const newStudentToken = document.getElementById('new-student-token');
const copyStudentLink = document.getElementById('copy-student-link');
const purchaseStudentId = document.getElementById('purchase-student-id');
const purchaseCredits = document.getElementById('purchase-credits');
const purchaseValidity = document.getElementById('purchase-validity');
const addPurchaseBtn = document.getElementById('add-purchase-btn');
const lessonStarts = document.getElementById('lesson-starts');
const setLessonBtn = document.getElementById('set-lesson-btn');
const extendDays = document.getElementById('extend-days');
const extendBtn = document.getElementById('extend-btn');
const cancelStudentId = document.getElementById('cancel-student-id');
const cancelLessonId = document.getElementById('cancel-lesson-id');
const cancelRegistrationBtn = document.getElementById('cancel-registration-btn');
const exportLedgerBtn = document.getElementById('export-ledger-btn');
const backupStatusBtn = document.getElementById('backup-status-btn');
const exportResult = document.getElementById('export-result');
const studentOverview = document.getElementById('student-overview');
const adminList = document.getElementById('admin-list');
const refreshAdminBtn = document.getElementById('refresh-admin-btn');

function apiUrl(path) {
  return `${apiBase}${path}`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request_failed');
  return data;
}

function formatDate(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  return date.toLocaleString();
}

let lastStudentLink = '';
if (copyStudentLink) copyStudentLink.disabled = true;

async function loadStatus() {
  if (!token) {
    studentName.textContent = 'Missing token';
    registerBtn.disabled = true;
    cancelBtn.disabled = true;
    return;
  }

  const data = await fetchJson(apiUrl(`/status?t=${encodeURIComponent(token)}`));

  studentName.textContent = data.student.name;
  credits.textContent = data.credits_available;
  nextLesson.textContent = formatDate(data.next_lesson && data.next_lesson.starts_at);
  registrationOpen.textContent = data.registration_open ? 'Open' : 'Closed';
  registrationStatus.textContent = data.registered ? 'Registered' : 'Not registered';
  registerBtn.disabled = !data.registration_open || data.registered;
  cancelBtn.disabled = !data.registration_open || !data.registered;

}

registerBtn && registerBtn.addEventListener('click', async () => {
  try {
    await fetchJson(apiUrl(`/register?t=${encodeURIComponent(token)}`), { method: 'POST' });
    await loadStatus();
  } catch (err) {
    alert(`Register failed: ${err.message}`);
  }
});

cancelBtn && cancelBtn.addEventListener('click', async () => {
  try {
    await fetchJson(apiUrl(`/cancel?t=${encodeURIComponent(token)}`), { method: 'POST' });
    await loadStatus();
  } catch (err) {
    alert(`Cancel failed: ${err.message}`);
  }
});

const storedAdminToken = localStorage.getItem('adminToken') || '';
const validStoredToken = Boolean(storedAdminToken);
if (adminTokenInput) adminTokenInput.value = validStoredToken ? storedAdminToken : '';
if (apiBaseInput) apiBaseInput.value = apiBase;
if (adminStatus) adminStatus.textContent = validStoredToken ? 'Token set' : 'Token required';

toggleAdminTokenBtn && toggleAdminTokenBtn.addEventListener('click', () => {
  if (!adminTokenInput) return;
  const isPassword = adminTokenInput.type === 'password';
  adminTokenInput.type = isPassword ? 'text' : 'password';
  toggleAdminTokenBtn.textContent = isPassword ? 'Hide' : 'Show';
});

function adminHeaders() {
  const token = localStorage.getItem('adminToken');
  if (!token) return {};
  return { 'X-Admin-Token-Encoded': encodeURIComponent(token) };
}

saveAdminTokenBtn && saveAdminTokenBtn.addEventListener('click', () => {
  const value = adminTokenInput.value.trim();
  if (!value) return;
  if (value) {
    localStorage.setItem('adminToken', value);
    adminStatus.textContent = 'Token set';
  }
});

saveApiBaseBtn && saveApiBaseBtn.addEventListener('click', () => {
  const value = apiBaseInput.value.trim();
  if (value) {
    localStorage.setItem('apiBase', value);
    window.location.reload();
  }
});

addStudentBtn && addStudentBtn.addEventListener('click', async () => {
  const name = studentNameInput.value.trim();
  if (!name) return;
  try {
    const data = await fetchJson(apiUrl('/admin/addStudent'), {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const link = `${window.location.origin}?t=${data.student.token}&api=${encodeURIComponent(apiBase)}`;
    lastStudentLink = link;
    if (copyStudentLink) copyStudentLink.disabled = false;
    newStudentToken.textContent = `Token: ${data.student.token} | Link: ${link}`;
    studentNameInput.value = '';
  } catch (err) {
    alert(`Add student failed: ${err.message}`);
  }
});

copyStudentLink && copyStudentLink.addEventListener('click', async () => {
  if (!lastStudentLink) return;
  try {
    await navigator.clipboard.writeText(lastStudentLink);
    copyStudentLink.textContent = 'Copied!';
    setTimeout(() => {
      copyStudentLink.textContent = 'Copy student link';
    }, 1200);
  } catch (err) {
    alert('Clipboard copy failed');
  }
});

addPurchaseBtn && addPurchaseBtn.addEventListener('click', async () => {
  try {
    const studentIdValue = purchaseStudentId.value;
    if (!studentIdValue) return;
    const data = await fetchJson(apiUrl('/admin/addPurchase'), {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: Number(studentIdValue),
        credits_total: Number(purchaseCredits.value),
        validity_months: Number(purchaseValidity.value)
      })
    });
    alert(`Purchase added. Lot ${data.lot.id}`);
  } catch (err) {
    alert(`Add purchase failed: ${err.message}`);
  }
});

setLessonBtn && setLessonBtn.addEventListener('click', async () => {
  const value = lessonStarts.value;
  if (!value) return;
  const iso = new Date(value).toISOString();
  try {
    await fetchJson(apiUrl('/admin/setNextLesson'), {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ starts_at: iso })
    });
    alert('Lesson updated');
  } catch (err) {
    alert(`Set lesson failed: ${err.message}`);
  }
});

extendBtn && extendBtn.addEventListener('click', async () => {
  const days = Number(extendDays.value);
  if (!days) return;
  try {
    await fetchJson(apiUrl('/admin/extendValidity'), {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ extend_days: days })
    });
    alert('Lots extended');
  } catch (err) {
    alert(`Extend failed: ${err.message}`);
  }
});

cancelRegistrationBtn && cancelRegistrationBtn.addEventListener('click', async () => {
  const studentId = Number(cancelStudentId.value);
  const lessonId = Number(cancelLessonId.value);
  if (!studentId || !lessonId) return;
  try {
    await fetchJson(apiUrl('/admin/cancelRegistration'), {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, lesson_id: lessonId })
    });
    alert('Registration cancelled');
  } catch (err) {
    alert(`Cancel failed: ${err.message}`);
  }
});

exportLedgerBtn && exportLedgerBtn.addEventListener('click', async () => {
  try {
    const data = await fetchJson(apiUrl('/admin/exportLedger'), {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' }
    });
    if (exportResult) {
      exportResult.textContent = `Exported ${data.count} rows to ${data.key}`;
    }
    if (backupStatusBtn) {
      backupStatusBtn.click();
    }
  } catch (err) {
    if (exportResult) {
      exportResult.textContent = `Export failed: ${err.message}`;
    }
  }
});

async function loadBackupStatus() {
  if (!exportResult) return;
  const token = localStorage.getItem('adminToken');
  if (!token) {
    exportResult.textContent = 'Latest backup: unknown (admin token required).';
    return;
  }
  try {
    const data = await fetchJson(apiUrl('/admin/backupStatus'), { headers: adminHeaders() });
    if (!data.latest) {
      exportResult.textContent = 'No backups found yet.';
      return;
    }
    exportResult.textContent = `Latest backup: ${data.latest.key} (${data.latest.size} bytes)`;
  } catch (err) {
    exportResult.textContent = `Backup status failed: ${err.message}`;
  }
}

backupStatusBtn && backupStatusBtn.addEventListener('click', async () => {
  await loadBackupStatus();
});

refreshAdminBtn && refreshAdminBtn.addEventListener('click', async () => {
  try {
    const data = await fetchJson(apiUrl('/admin/list'), { headers: adminHeaders() });
    adminList.textContent = JSON.stringify(data, null, 2);
    if (purchaseStudentId) {
      purchaseStudentId.innerHTML = '';
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select student';
      purchaseStudentId.appendChild(defaultOption);
      (data.students || []).forEach((student) => {
        const option = document.createElement('option');
        option.value = student.id;
        option.textContent = `${student.name} (#${student.id})`;
        purchaseStudentId.appendChild(option);
      });
    }
    if (studentOverview) {
      const rows = data.student_overview || [];
      const table = document.createElement('table');
      table.innerHTML = `
        <thead>
          <tr>
            <th>Student</th>
            <th>Credits</th>
            <th>Registered</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${row.name} (#${row.id})</td>
              <td>${row.credits_available}</td>
              <td>${row.registered_for_next ? 'Yes' : 'No'}</td>
            </tr>
          `).join('')}
        </tbody>
      `;
      studentOverview.innerHTML = '';
      studentOverview.appendChild(table);
    }
  } catch (err) {
    adminList.textContent = `Admin list failed: ${err.message}`;
  }
});

if (token && studentName) {
  loadStatus().catch((err) => {
    registrationStatus.textContent = `Error: ${err.message}`;
  });
}

if (backupStatusBtn) {
  loadBackupStatus().catch(() => {});
}

if (refreshAdminBtn) {
  refreshAdminBtn.click();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      reg.update().catch(() => {});

      reg.onupdatefound = () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.onstatechange = () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        };
      };
    }).catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  });
}
