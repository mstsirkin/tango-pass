(function () {
  const config = window.APP_CONFIG || {};
  const API_URL = config.API_URL || "";

  const formatDateTime = (isoString) => {
    if (!isoString) return "Not scheduled";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const setStatus = (el, message, type) => {
    if (!el) return;
    el.textContent = message;
    el.classList.remove("ok", "error");
    if (type) el.classList.add(type);
  };

  const getQueryParam = (name) => {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  };

  const postAction = async (action, payload) => {
    if (!API_URL || API_URL.includes("PASTE")) {
      throw new Error("API URL is not configured. Update js/config.js.");
    }
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  };

  const registerServiceWorker = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("../service-worker.js").catch(() => null);
    }
  };

  const initStudent = async () => {
    const token = getQueryParam("t");
    const statusEl = document.getElementById("statusMessage");
    const registerButton = document.getElementById("registerButton");
    const calendarButton = document.getElementById("calendarButton");

    if (!token) {
      setStatus(statusEl, "Missing student token. Check the link.", "error");
      registerButton.disabled = true;
      calendarButton.disabled = true;
      return;
    }

    const loadStatus = async (message) => {
      if (message) setStatus(statusEl, message);
      const data = await postAction("studentStatus", { token });
      document.getElementById("studentGreeting").textContent =
        data.studentName ? `Hi ${data.studentName}` : "Welcome";
      document.getElementById("lessonsRemaining").textContent = data.lessonsRemaining;
      document.getElementById("registrationStatus").textContent =
        data.isRegistered ? "Registered" : "Not registered";
      document.getElementById("nextLesson").textContent = formatDateTime(data.nextLessonISO);
      registerButton.disabled = data.isRegistered || data.lessonsRemaining <= 0;
      calendarButton.disabled = !data.nextLessonISO;
      registerButton.textContent = data.isRegistered
        ? "Already registered"
        : "Register for next lesson";
      setStatus(statusEl, "Ready.", "ok");
      return data;
    };

    let cachedStatus = null;
    try {
      cachedStatus = await loadStatus("Loading your lesson bundle...");
    } catch (err) {
      setStatus(statusEl, err.message, "error");
    }

    registerButton.addEventListener("click", async () => {
      try {
        registerButton.disabled = true;
        setStatus(statusEl, "Registering your spot...");
        await postAction("register", { token });
        cachedStatus = await loadStatus("Registration confirmed.");
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      } finally {
        if (cachedStatus) {
          registerButton.disabled = cachedStatus.isRegistered || cachedStatus.lessonsRemaining <= 0;
        }
      }
    });

    calendarButton.addEventListener("click", () => {
      if (!cachedStatus || !cachedStatus.nextLessonISO) return;
      const eventTitle = cachedStatus.eventTitle || "Tango Lesson";
      const eventLocation = cachedStatus.eventLocation || "";
      const start = new Date(cachedStatus.nextLessonISO);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const formatICS = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Tango Lesson Pass//EN",
        "BEGIN:VEVENT",
        `UID:${token}-${start.getTime()}@dancepass`,
        `DTSTAMP:${formatICS(new Date())}`,
        `DTSTART:${formatICS(start)}`,
        `DTEND:${formatICS(end)}`,
        `SUMMARY:${eventTitle}`,
        eventLocation ? `LOCATION:${eventLocation}` : "",
        "END:VEVENT",
        "END:VCALENDAR"
      ].filter(Boolean).join("\r\n");

      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "dance-lesson.ics";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    });
  };

  const initTeacher = async () => {
    const adminToken = getQueryParam("admin");
    const statusEl = document.getElementById("teacherStatus");

    if (!adminToken) {
      setStatus(statusEl, "Missing admin token in the URL.", "error");
      return;
    }

    const studentSelect = document.getElementById("studentSelect");
    const registrationsTable = document.getElementById("registrationsTable").querySelector("tbody");
    const nextLessonStatus = document.getElementById("nextLessonStatus");

    const loadStudents = async (message) => {
      if (message) setStatus(statusEl, message);
      const data = await postAction("teacherListStudents", { adminToken });
      studentSelect.innerHTML = "";
      registrationsTable.innerHTML = "";

      data.students.forEach((student) => {
        const option = document.createElement("option");
        option.value = student.token;
        option.textContent = student.studentName || student.token.slice(0, 6);
        studentSelect.appendChild(option);

        const row = document.createElement("tr");
        const cells = [
          student.studentName || "(unnamed)",
          student.lessonsRemaining,
          student.isRegistered ? "Yes" : "No",
          student.registeredAt || "-"
        ];
        cells.forEach((cell) => {
          const td = document.createElement("td");
          td.textContent = cell;
          row.appendChild(td);
        });
        registrationsTable.appendChild(row);
      });

      nextLessonStatus.textContent = data.nextLessonISO
        ? `Next lesson: ${formatDateTime(data.nextLessonISO)}`
        : "Not set yet.";
      setStatus(statusEl, "Loaded.", "ok");
      return data;
    };

    try {
      await loadStudents("Loading admin data...");
    } catch (err) {
      setStatus(statusEl, err.message, "error");
    }

    document.getElementById("refreshButton").addEventListener("click", async () => {
      try {
        await loadStudents("Refreshing...");
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });

    document.getElementById("addStudentButton").addEventListener("click", async () => {
      const nameInput = document.getElementById("studentNameInput");
      const newLink = document.getElementById("newStudentLink");
      const studentName = nameInput.value.trim();
      if (!studentName) {
        setStatus(newLink, "Enter a student name.", "error");
        return;
      }
      try {
        setStatus(newLink, "Creating student link...");
        const baseUrl = new URL("..", window.location.href).toString().replace(/\/$/, "");
        const data = await postAction("teacherAddStudent", {
          adminToken,
          studentName,
          baseUrl
        });
        nameInput.value = "";
        setStatus(newLink, data.studentLink || "Student created.", "ok");
        await loadStudents("Refreshing list...");
      } catch (err) {
        setStatus(newLink, err.message, "error");
      }
    });

    document.getElementById("adjustLessonsButton").addEventListener("click", async () => {
      const deltaInput = document.getElementById("lessonDeltaInput");
      const allowSubtract = document.getElementById("allowSubtract").checked;
      const delta = Number(deltaInput.value);
      if (!Number.isInteger(delta)) {
        setStatus(statusEl, "Lesson delta must be an integer.", "error");
        return;
      }
      if (delta < 0 && !allowSubtract) {
        setStatus(statusEl, "Enable subtract to apply a negative delta.", "error");
        return;
      }
      try {
        setStatus(statusEl, "Updating lessons...");
        await postAction("teacherAdjustLessons", {
          adminToken,
          token: studentSelect.value,
          delta
        });
        await loadStudents("Refreshing list...");
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });

    document.getElementById("setNextLessonButton").addEventListener("click", async () => {
      const nextLessonInput = document.getElementById("nextLessonInput");
      const isoValue = nextLessonInput.value;
      if (!isoValue) {
        setStatus(statusEl, "Pick a date and time.", "error");
        return;
      }
      const iso = new Date(isoValue).toISOString();
      try {
        setStatus(statusEl, "Saving schedule...");
        await postAction("teacherSetNextLesson", { adminToken, nextLessonISO: iso });
        await loadStudents("Refreshing list...");
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });

    document.getElementById("clearRegistrationsButton").addEventListener("click", async () => {
      try {
        setStatus(statusEl, "Clearing registrations...");
        await postAction("teacherClearRegistrations", { adminToken });
        await loadStudents("Refreshing list...");
      } catch (err) {
        setStatus(statusEl, err.message, "error");
      }
    });
  };

  registerServiceWorker();

  if (window.location.pathname.includes("/teacher")) {
    initTeacher();
  } else {
    initStudent();
  }
})();
