(() => {
  // Prevent duplicate message listeners if the popup injects this file again.
  if (window.__OLJ_JSON_EXTRACTOR_LOADED__) return;
  window.__OLJ_JSON_EXTRACTOR_LOADED__ = true;

  const cleanText = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  function htmlToText(value) {
    if (!value) return "";
    const doc = new DOMParser().parseFromString(String(value), "text/html");
    return cleanText(doc.body?.textContent || "");
  }

  function getMeta(...selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element?.getAttribute("content") || element?.getAttribute("datetime");
      if (value && cleanText(value)) return cleanText(value);
    }
    return null;
  }

  function collectJsonLd() {
    const results = [];
    const visited = new Set();

    function walk(value) {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }

      const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
      if (types.some(type => String(type || "").toLowerCase() === "jobposting")) {
        results.push(value);
      }

      if (value["@graph"]) walk(value["@graph"]);
      for (const [key, child] of Object.entries(value)) {
        if (key !== "@graph" && child && typeof child === "object") walk(child);
      }
    }

    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        walk(JSON.parse(script.textContent));
      } catch {
        // Ignore malformed JSON-LD blocks and continue with visible page content.
      }
    });

    return results[0] || null;
  }

  function toPlainString(value) {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "number") {
      const result = cleanText(value);
      return result || null;
    }
    if (Array.isArray(value)) {
      const result = value.map(toPlainString).filter(Boolean);
      return result.length ? result.join(", ") : null;
    }
    if (typeof value === "object") {
      if (value.name) return toPlainString(value.name);
      if (value.value) return toPlainString(value.value);
    }
    return null;
  }

  function salaryFromStructured(baseSalary) {
    if (!baseSalary) return null;
    if (typeof baseSalary === "string" || typeof baseSalary === "number") {
      return toPlainString(baseSalary);
    }

    const currency = baseSalary.currency || "";
    const value = baseSalary.value;
    if (value && typeof value === "object") {
      const min = value.minValue ?? value.value;
      const max = value.maxValue;
      const unit = value.unitText ? ` / ${value.unitText}` : "";
      if (min != null && max != null && min !== max) {
        return `${currency} ${min} - ${max}${unit}`.trim();
      }
      if (min != null) return `${currency} ${min}${unit}`.trim();
    }
    if (value != null) return `${currency} ${value}`.trim();
    return null;
  }

  function bodyLines() {
    return cleanText(document.body?.innerText || "")
      .split("\n")
      .map(line => cleanText(line))
      .filter(Boolean);
  }

  function findLabeledValue(lines, labels) {
    const labelPattern = labels.join("|");
    const sameLine = new RegExp(`^(?:${labelPattern})\\s*[:\\-–]\\s*(.+)$`, "i");
    const labelOnly = new RegExp(`^(?:${labelPattern})\\s*:?$`, "i");

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(sameLine);
      if (match && match[1]) return cleanText(match[1]);
      if (labelOnly.test(lines[i]) && lines[i + 1]) return cleanText(lines[i + 1]);
    }
    return null;
  }

  function findSalary(text) {
    const patterns = [
      /(?:₱|PHP|USD|US\$|\$)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:-|–|to)\s*(?:₱|PHP|USD|US\$|\$)?\s?\d[\d,]*(?:\.\d{1,2})?)?(?:\s*(?:\/|per)\s*(?:hour|hr|month|mo|week|year))?/i,
      /\d[\d,]*(?:\.\d{1,2})?\s*(?:PHP|USD)\s*(?:-|–|to)\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:PHP|USD)?/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return cleanText(match[0]);
    }
    return null;
  }

  function normalizeSkills(value) {
    if (!value) return [];
    const values = Array.isArray(value) ? value : String(value).split(/[,;\n|]/);
    return [...new Set(values.map(item => {
      if (typeof item === "object") return toPlainString(item);
      return cleanText(item);
    }).filter(Boolean))];
  }

  function getSkills(jobPosting, lines) {
    const structured = normalizeSkills(jobPosting?.skills || jobPosting?.experienceRequirements);
    if (structured.length) return structured;

    const keywordList = normalizeSkills(jobPosting?.keywords);
    if (keywordList.length > 1) return keywordList;

    const labelIndex = lines.findIndex(line => /^(skills required|required skills|skills|key skills)\s*:?\s*$/i.test(line));
    if (labelIndex >= 0) {
      const collected = [];
      for (let i = labelIndex + 1; i < Math.min(lines.length, labelIndex + 15); i++) {
        if (/^(about the job|job description|requirements|responsibilities|benefits|salary)\s*:?\s*$/i.test(lines[i])) break;
        const parts = lines[i].split(/[,;|]/).map(cleanText).filter(Boolean);
        collected.push(...parts);
      }
      return [...new Set(collected)].slice(0, 30);
    }
    return [];
  }

  function textFromElement(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, nav, footer, header, button, form, input, select, textarea").forEach(node => node.remove());
    return cleanText(clone.innerText || clone.textContent || "");
  }

  function getDescription(jobPosting) {
    const structured = htmlToText(jobPosting?.description);
    if (structured && structured.length > 50) return structured.slice(0, 30000);

    const selectors = [
      '[id*="job-description" i]',
      '[class*="job-description" i]',
      '[id*="description" i]',
      '[class*="description" i]',
      '[class*="job-detail" i]',
      '[class*="job-details" i]',
      "article",
      "main"
    ];

    let best = "";
    let bestScore = -1;

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(element => {
        const text = textFromElement(element);
        if (text.length < 80 || text.length > 30000) return;

        let score = Math.min(text.length, 5000) / 100;
        if (/responsibilities|requirements|qualifications|what you.ll do|about the role/i.test(text)) score += 15;
        if (/job description|description/i.test(element.id + " " + element.className)) score += 30;
        if (text.length > 15000) score -= 20;

        if (score > bestScore) {
          best = text;
          bestScore = score;
        }
      });
    }

    if (best) return best.slice(0, 30000);

    // Last resort: collect paragraph-like content rather than returning the
    // entire page (which usually contains navigation and unrelated links).
    const paragraphs = [...document.querySelectorAll("main p, article p, p")]
      .map(textFromElement)
      .filter(text => text.length > 35);
    return paragraphs.join("\n\n").slice(0, 30000) || null;
  }

  function getEmployer(jobPosting, lines) {
    const structured = toPlainString(jobPosting?.hiringOrganization);
    if (structured) return structured;

    const labeled = findLabeledValue(lines, ["employer", "company", "company name", "posted by", "client"]);
    if (labeled) return labeled;

    const org = document.querySelector('[itemprop="hiringOrganization"] [itemprop="name"], [itemprop="hiringOrganization"]');
    return cleanText(org?.innerText || org?.textContent || "") || null;
  }

  function getLocation(jobPosting, lines) {
    const location = jobPosting?.jobLocation;
    if (location) {
      const locations = Array.isArray(location) ? location : [location];
      const formatted = locations.map(item => {
        const address = item?.address || item;
        if (typeof address === "string") return cleanText(address);
        return [
          address?.addressLocality,
          address?.addressRegion,
          address?.addressCountry
        ].filter(Boolean).join(", ");
      }).filter(Boolean);
      if (formatted.length) return formatted.join(" | ");
    }
    return findLabeledValue(lines, ["location", "job location", "work location"]);
  }

  function getDatePosted(jobPosting) {
    if (jobPosting?.datePosted) return toPlainString(jobPosting.datePosted);
    return getMeta('meta[property="article:published_time"]', 'meta[name="date"]') ||
      document.querySelector("time[datetime]")?.getAttribute("datetime") ||
      null;
  }

  function getEmploymentType(jobPosting, lines) {
    const structured = toPlainString(jobPosting?.employmentType);
    if (structured) return structured;

    const labeled = findLabeledValue(lines, ["employment type", "job type", "work type"]);
    if (labeled) return labeled;

    const text = lines.join(" ").toLowerCase();
    for (const type of ["full-time", "full time", "part-time", "part time", "contract", "freelance", "temporary", "internship"]) {
      if (text.includes(type)) return type.replace("-", " ");
    }
    return null;
  }

  function getHoursPerWeek(lines, description) {
    const text = `${lines.join(" ")} ${description || ""}`;
    const match = text.match(/(\d{1,3}(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:per|\/|a)\s*week/i) ||
      text.match(/(?:weekly hours|hours per week)\s*[:\-]?\s*(\d{1,3}(?:\.\d+)?)/i);
    return match ? `${match[1]} hours/week` : null;
  }

  function getExperienceLevel(lines, description) {
    const labeled = findLabeledValue(lines, ["experience level", "experience required", "years of experience"]);
    if (labeled) return labeled;
    const text = `${lines.join(" ")} ${description || ""}`;
    const match = text.match(/(\d+\+?\s*(?:-|to)?\s*\d*\s*years?\s+(?:of\s+)?experience)/i);
    return match ? cleanText(match[1]) : null;
  }

  function getJobId(jobPosting) {
    if (jobPosting?.identifier) {
      const identifier = jobPosting.identifier;
      if (typeof identifier === "string" || typeof identifier === "number") return String(identifier);
      if (identifier.value != null) return String(identifier.value);
    }
    const match = location.pathname.match(/(?:job|jobs|jobseekers\/job)[/-](\d+)/i) ||
      location.pathname.match(/\/(\d{4,})(?:\/|$)/);
    return match ? match[1] : null;
  }

  function extractJob() {
    const jobPosting = collectJsonLd();
    const lines = bodyLines();
    const pageText = lines.join("\n");

    const title = toPlainString(jobPosting?.title) ||
      cleanText(document.querySelector("h1")?.innerText || "") ||
      getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') ||
      cleanText(document.title).replace(/\s*[|–-]\s*OnlineJobs\.ph.*$/i, "") ||
      null;

    const description = getDescription(jobPosting);
    const salary = salaryFromStructured(jobPosting?.baseSalary) ||
      findLabeledValue(lines, ["salary", "compensation", "pay", "rate"]) ||
      findSalary(pageText);

    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const skills = getSkills(jobPosting, lines);

    const data = {
      platform: "OnlineJobs.ph",
      job_id: getJobId(jobPosting),
      job_title: title,
      employer: getEmployer(jobPosting, lines),
      location: getLocation(jobPosting, lines),
      salary: salary,
      employment_type: getEmploymentType(jobPosting, lines),
      hours_per_week: getHoursPerWeek(lines, description),
      experience_level: getExperienceLevel(lines, description),
      date_posted: getDatePosted(jobPosting),
      skills: skills,
      description: description,
      job_url: canonical || location.href,
      extracted_at: new Date().toISOString(),
      extraction_warnings: []
    };

    if (!data.job_title) {
      throw new Error("No job title was found. Make sure you are viewing an individual job listing, not the search results page.");
    }
    if (!data.description) data.extraction_warnings.push("Job description was not detected.");
    if (!data.salary) data.extraction_warnings.push("Salary was not detected.");
    if (!data.employer) data.extraction_warnings.push("Employer name was not detected.");
    if (!data.skills.length) data.extraction_warnings.push("Skills were not detected.");

    return data;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "OLJ_EXTRACT_JOB") return false;

    try {
      const data = extractJob();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Extraction failed." });
    }
    return false;
  });
})();
