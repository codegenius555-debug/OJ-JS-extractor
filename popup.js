const notice = document.getElementById("notice");
const output = document.getElementById("jsonOutput");
const extractBothButton = document.getElementById("extractBoth");
const extractOnlyButton = document.getElementById("extractOnly");
const copyButton = document.getElementById("copy");
const downloadButton = document.getElementById("download");
const fieldCount = document.getElementById("fieldCount");

let latestData = null;

function setBusy(isBusy) {
  extractBothButton.disabled = isBusy;
  extractOnlyButton.disabled = isBusy;
  extractBothButton.textContent = isBusy ? "Extracting..." : "Extract & Export Both";
  extractOnlyButton.textContent = isBusy ? "Please wait..." : "Extract Only";
}

function setNotice(message, kind = "info") {
  notice.textContent = message;
  notice.style.borderColor = kind === "error" ? "#f2b8b5" : "#dbe5ee";
  notice.style.background = kind === "error" ? "#fff5f4" : "#fff";
  notice.style.color = kind === "error" ? "#9b2721" : "#475467";
}

function safeFilename(value) {
  const cleaned = String(value || "onlinejobs-job")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return cleaned || "onlinejobs-job";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

async function requestExtraction(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "OLJ_EXTRACT_JOB" });
  } catch (firstError) {
    // The content script may not have loaded yet (for example, immediately
    // after navigating to a listing). Inject it once and retry.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return await chrome.tabs.sendMessage(tabId, { type: "OLJ_EXTRACT_JOB" });
  }
}

async function extractJob() {
  const tab = await getActiveTab();

  if (!tab || !tab.id || !tab.url) {
    throw new Error("Could not find the active browser tab.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(tab.url);
  } catch {
    throw new Error("The current tab does not have a valid web address.");
  }

  if (!["onlinejobs.ph", "www.onlinejobs.ph"].includes(parsedUrl.hostname)) {
    throw new Error("Open an OnlineJobs.ph job listing before extracting.");
  }

  const response = await requestExtraction(tab.id);

  if (!response || !response.ok) {
    throw new Error(response?.error || "Could not extract job information from this page.");
  }

  return response.data;
}

function renderData(data) {
  latestData = data;
  const json = JSON.stringify(data, null, 2);
  output.value = json;
  copyButton.disabled = false;
  downloadButton.disabled = false;

  const populated = Object.entries(data).filter(([, value]) => {
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }).length;

  fieldCount.textContent = `${populated} populated fields`;
}

async function copyJson() {
  if (!latestData) return;
  const json = JSON.stringify(latestData, null, 2);

  try {
    await navigator.clipboard.writeText(json);
    setNotice("JSON copied to your clipboard.", "success");
  } catch {
    output.focus();
    output.select();
    const copied = document.execCommand("copy");
    setNotice(copied ? "JSON copied to your clipboard." : "Select the JSON preview and copy it manually.",
      copied ? "success" : "error");
  }
}

async function downloadJson() {
  if (!latestData) return;
  const json = JSON.stringify(latestData, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${safeFilename(latestData.job_title)}-${date}.json`;
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: true
    });
    setNotice(`JSON download started: ${filename}`, "success");
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
}

async function runExtraction(exportBoth) {
  setBusy(true);
  setNotice("Reading the current job listing...");
  try {
    const data = await extractJob();
    renderData(data);

    const warnings = Array.isArray(data.extraction_warnings) ? data.extraction_warnings : [];
    if (exportBoth) {
      const results = await Promise.allSettled([copyJson(), downloadJson()]);
      const copyFailed = results[0].status === "rejected";
      const downloadFailed = results[1].status === "rejected";

      if (copyFailed || downloadFailed) {
        setNotice(
          `Extracted successfully. ${copyFailed ? "Clipboard copy failed. " : ""}${downloadFailed ? "Download failed." : "Download started."}`,
          "error"
        );
      } else if (warnings.length) {
        setNotice(`Exported both formats. Some fields were not found: ${warnings.join(" ")}`, "success");
      } else {
        setNotice("Success! JSON copied and download started.", "success");
      }
    } else if (warnings.length) {
      setNotice(`Extraction complete. Some fields were not found: ${warnings.join(" ")}`);
    } else {
      setNotice("Extraction complete. Review the JSON below.");
    }
  } catch (error) {
    setNotice(error?.message || "Something went wrong during extraction.", "error");
  } finally {
    setBusy(false);
  }
}

extractBothButton.addEventListener("click", () => runExtraction(true));
extractOnlyButton.addEventListener("click", () => runExtraction(false));
copyButton.addEventListener("click", copyJson);
downloadButton.addEventListener("click", downloadJson);
