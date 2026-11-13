(() => {
  // Prevent duplicate message listeners if the popup injects this file again.
  if (window.__JOB_JSON_EXTRACTOR_LOADED__) return;
  window.__JOB_JSON_EXTRACTOR_LOADED__ = true;

  const cleanText = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const host = location.hostname.toLowerCase();
  const isJobStreet = host === "ph.jobstreet.com" ||
    host === "jobstreet.com" ||
    host.endsWith(".jobstreet.com") ||
    host === "jobstreet.com.ph" ||
    host.endsWith(".jobstreet.com.ph");
  const platformName = isJobStreet ? "JobStreet Philippines" : "OnlineJobs.ph";

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

      for (const child of Object.values(value)) {
        if (child && typeof child === "object") walk(child);
      }
    }

    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try { walk(JSON.parse(script.textContent)); } catch { /* Ignore invalid JSON-LD. */ }
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
      if (value.value != null) return toPlainString(value.value);
    }
    return null;
  }

  function salaryFromStructured(baseSalary) {
    if (!baseSalary) return null;
    if (typeof baseSalary === "string" || typeof baseSalary === "number") return toPlainString(baseSalary);

    const currency = baseSalary.currency || "";
    const value = baseSalary.value;
    if (value && typeof value === "object") {
      const min = value.minValue ?? value.value;
      const max = value.maxValue;
      const unit = value.unitText ? ` / ${value.unitText}` : "";
      if (min != null && max != null && min !== max) return `${currency} ${min} - ${max}${unit}`.trim();
      if (min != null) return `${currency} ${min}${unit}`.trim();
    }
    if (value != null) return `${currency} ${value}`.trim();
    return null;
  }

  function bodyLines() {
    return cleanText(document.body?.innerText || "")
      .split("\n").map(cleanText).filter(Boolean);
  }

  function findLabeledValue(lines, labels) {
    const labelPattern = labels.join("|");
    const sameLine = new RegExp(`^(?:${labelPattern})\\s*[:\\-–]\\s*(.+)$`, "i");
    const labelOnly = new RegExp(`^(?:${labelPattern})\\s*:?$`, "i");

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(sameLine);
      if (match?.[1]) return cleanText(match[1]);
      if (labelOnly.test(lines[i]) && lines[i + 1]) return cleanText(lines[i + 1]);
    }
    return null;
  }

  function findPostedText(lines) {
    return lines.find(line => /^(?:posted|listed)\s+(?:\d+\s*(?:m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)\s*ago|today|yesterday)/i.test(line)) || null;
  }

  function salaryFromVisibleText(lines, wholeText) {
    const explicit = findLabeledValue(lines, ["salary", "compensation", "pay", "rate"]);
    if (explicit) return explicit;
    const undisclosed = lines.find(line => /^salary\s+(?:is\s+)?undisclosed$/i.test(line));
    if (undisclosed) return "Undisclosed";

    const patterns = [
      /(?:₱|PHP|USD|US\$|\$)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:-|–|to)\s*(?:₱|PHP|USD|US\$|\$)?\s?\d[\d,]*(?:\.\d{1,2})?)?(?:\s*(?:\/|per)\s*(?:hour|hr|month|mo|week|year))?/i
    ];
    for (const pattern of patterns) {
      const match = wholeText.match(pattern);
      if (match) return cleanText(match[0]);
    }
    return null;
  }

  function normalizeSkills(value) {
    if (!value) return [];
    const values = Array.isArray(value) ? value : String(value).split(/[,;\n|]/);
    return [...new Set(values.map(item => typeof item === "object" ? toPlainString(item) : cleanText(item)).filter(Boolean))];
  }

  function getStructuredSkills(jobPosting) {
    const raw = jobPosting?.skills || jobPosting?.experienceRequirements || jobPosting?.qualifications;
    return normalizeSkills(raw);
  }

  function getRequiredSkills(lines, jobPosting) {
    const structured = getStructuredSkills(jobPosting);
    if (structured.length) return structured;

    const labelIndex = lines.findIndex(line => /^(required skills|skills required|technical skills|required qualifications|key skills)\s*:?\s*$/i.test(line));
    if (labelIndex >= 0) {
      const collected = [];
      for (let i = labelIndex + 1; i < Math.min(lines.length, labelIndex + 20); i++) {
        if (/^(about the job|job description|responsibilities|benefits|salary|requirements)\s*:?\s*$/i.test(lines[i])) break;
        collected.push(...lines[i].split(/[,;|]/).map(cleanText).filter(Boolean));
      }
      return [...new Set(collected)].slice(0, 40);
    }
    return [];
  }


  // OnlineJobs.ph presents its description and its platform skill taxonomy
  // in separate sections. These helpers read those sections independently.
  function getOnlineJobsSection(lines, headingNames) {
    const headingPattern = new RegExp(`^(?:${headingNames.join("|")})\\s*:?$`, "i");
    const stopPattern = /^(?:TYPE OF WORK|WAGE\s*\/\s*SALARY|HOURS PER WEEK|DATE UPDATED|JOB OVERVIEW|SKILL REQUIREMENT|ABOUT THE COMPANY|ABOUT US|HOW TO APPLY|APPLICATION INSTRUCTIONS)\s*:?$/i;
    const start = lines.findIndex(line => headingPattern.test(line));
    if (start < 0) return null;

    const collected = [];
    for (let i = start + 1; i < Math.min(lines.length, start + 180); i++) {
      if (stopPattern.test(lines[i])) break;
      if (/^(?:please login|please log in|register as jobseeker|apply now|save job)$/i.test(lines[i])) break;
      collected.push(lines[i]);
      if (collected.join("\n").length > 18000) break;
    }
    return cleanText(collected.join("\n")) || null;
  }

  function getOnlineJobsSectionValue(lines, headingNames) {
    const headingPattern = new RegExp(`^(?:${headingNames.join("|")})\\s*:?$`, "i");
    const index = lines.findIndex(line => headingPattern.test(line));
    if (index < 0) return null;
    const value = lines[index + 1];
    if (!value || /^(?:TYPE OF WORK|WAGE\s*\/\s*SALARY|HOURS PER WEEK|DATE UPDATED|JOB OVERVIEW|SKILL REQUIREMENT)$/i.test(value)) {
      return null;
    }
    return value;
  }

  function getOnlineJobsSectionElement(headingText) {
    const normalize = value => cleanText(value).replace(/:$/, "").toLowerCase();
    const candidates = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,b,p,div,span,dt")];
    return candidates.find(element =>
      normalize(element.textContent || "") === normalize(headingText) &&
      (element.children.length === 0 || /^H[1-6]$/.test(element.tagName) || ["STRONG", "B", "DT"].includes(element.tagName)
      )
    ) || null;
  }

  function collectSkillNodes(root) {
    if (!root) return [];
    const nodes = [...root.querySelectorAll("li, a, [class*='skill' i], [class*='tag' i], [class*='badge' i]")];
    const values = nodes
      .map(node => cleanText(node.innerText || node.textContent || ""))
      .filter(value => value && value.length <= 120 && !/^skill requirement$/i.test(value));
    return [...new Set(values)];
  }

  function getOnlineJobsSkillRequirement(lines) {
    const heading = getOnlineJobsSectionElement("SKILL REQUIREMENT");
    let domText = "";
    let domSkills = [];

    if (heading) {
      // The heading is commonly followed by a list or a group of skill tags.
      const collectFollowing = start => {
        const parts = [];
        let node = start;
        for (let i = 0; node && i < 12; i++, node = node.nextElementSibling) {
          const text = textFromElement(node);
          if (!text) continue;
          if (/^(?:JOB OVERVIEW|TYPE OF WORK|WAGE\s*\/\s*SALARY|HOURS PER WEEK|DATE UPDATED)$/i.test(text)) break;
          parts.push(node);
          if (parts.map(textFromElement).join("\n").length > 5000) break;
        }
        return parts;
      };

      let siblings = collectFollowing(heading.nextElementSibling);
      if (!siblings.length && heading.parentElement) {
        siblings = collectFollowing(heading.parentElement.nextElementSibling);
      }

      if (siblings.length) {
        domText = cleanText(siblings.map(textFromElement).filter(Boolean).join("\n"));
        domSkills = [...new Set(siblings.flatMap(collectSkillNodes))];
        // A list item's own text is more useful than a flattened parent block.
        if (!domSkills.length) {
          domSkills = [...new Set(siblings.flatMap(node =>
            [...node.querySelectorAll("li")].map(item => cleanText(item.innerText || item.textContent || ""))
          ).filter(Boolean))];
        }
      }
    }

    const textSection = getOnlineJobsSection(lines, ["SKILL REQUIREMENT"]);
    const rawText = domText || textSection || null;
    let skills = domSkills;

    if (!skills.length && rawText) {
      skills = rawText.split(/\n+/)
        .map(line => cleanText(line.replace(/^[\s•·▪◦\-–—*]+/, "")))
        .filter(line => line && line.length <= 160)
        .filter(line => !/^(?:skill requirement|please login|register|apply now)$/i.test(line));
    }

    // Some page versions flatten the skill tags into a single text line.
    // Split only on repeated separators; do not split multiword skill names.
    if (skills.length === 1 && !/[,;|]/.test(skills[0]) && skills[0].length > 90) {
      const parts = skills[0].split(/\s{2,}|[•·▪◦]/).map(cleanText).filter(Boolean);
      if (parts.length > 1) skills = parts;
    } else if (skills.length === 1 && /[,;|]/.test(skills[0])) {
      skills = skills[0].split(/[,;|]/).map(cleanText).filter(Boolean);
    }

    return {
      text: rawText,
      skills: [...new Set(skills)].slice(0, 80)
    };
  }


  function extractOverviewSections(overviewText) {
    const result = {
      responsibilities: null,
      requirements: null,
      qualifications: null,
      preferred_qualifications: null,
      how_to_apply: null,
      benefits: null,
      other_sections: {}
    };
    if (!overviewText) return result;

    const aliases = [
      ["responsibilities", /^(?:what you(?:'|’)ll do|responsibilities|duties|key responsibilities)\s*:?$/i],
      ["requirements", /^(?:requirements|required skills|skills required|technical skills|required experience|must have|what you(?:'|’)ll need)\s*:?$/i],
      ["qualifications", /^(?:qualifications|minimum qualifications|basic qualifications)\s*:?$/i],
      ["preferred_qualifications", /^(?:preferred qualifications|nice to have|bonus points|strong bonus|preferred skills)\s*:?$/i],
      ["how_to_apply", /^(?:how to apply|application instructions|to apply|application process)\s*:?$/i],
      ["benefits", /^(?:benefits|what we offer|perks and benefits)\s*:?$/i]
    ];
    const allHeadings = aliases.map(([, pattern]) => pattern);
    const lines = overviewText.split(/\n+/).map(cleanText).filter(Boolean);
    const collected = {};
    let current = null;

    for (const line of lines) {
      const inlineMatch = line.match(/^([^:]{2,55}):\s*(.+)$/);
      let matched = null;
      let content = null;

      for (const [key, pattern] of aliases) {
        if (pattern.test(line)) {
          matched = key;
          break;
        }
        if (inlineMatch && pattern.test(`${inlineMatch[1]}:`)) {
          matched = key;
          content = cleanText(inlineMatch[2]);
          break;
        }
      }

      if (matched) {
        current = matched;
        if (!collected[current]) collected[current] = [];
        if (content) collected[current].push(content);
        continue;
      }

      // A new bold-style heading without a colon is usually one of the common
      // job-ad sections. Keep unrecognized lines as part of the active section.
      if (current) collected[current].push(line);
    }

    for (const [key, values] of Object.entries(collected)) {
      result[key] = cleanText(values.join("\n")) || null;
    }
    return result;
  }

  function skillsFromRequirementText(requirementText) {
    if (!requirementText) return [];
    const items = requirementText.split(/\n+/)
      .map(line => cleanText(line.replace(/^[\s•·▪◦\-–—*]+/, "")))
      .filter(Boolean)
      .flatMap(line => {
        if (line.length < 100 && /[,;|]/.test(line)) {
          return line.split(/[,;|]/).map(cleanText).filter(Boolean);
        }
        return [line];
      })
      .filter(line => line.length <= 180)
      .filter(line => !/^(?:requirements|required skills|skills required|technical skills|required experience|must have)$/i.test(line));
    return [...new Set(items)].slice(0, 100);
  }

  function getOnlineJobsDescription(jobPosting, lines) {
    const overview = getOnlineJobsSection(lines, ["JOB OVERVIEW"]);
    if (overview && overview.length > 40) return overview.slice(0, 40000);
    return getDescription(jobPosting);
  }

  function getMatchedSkills(lines) {
    const start = lines.findIndex(line => /^how you match$/i.test(line));
    if (start < 0) return [];

    const results = [];
    for (let i = start + 1; i < Math.min(lines.length, start + 18); i++) {
      const line = lines[i];
      if (/^\+\s*\d+\s+more$/i.test(line) || /^work setup\s*:/i.test(line) || /^shift schedule\s*:/i.test(line)) break;
      if (/^matches based on your career history$/i.test(line)) continue;
      if (/^(work setup|shift schedule|job description|about the job)\b/i.test(line)) break;

      const cleaned = line.replace(/\s*\+\s*$/, "").trim();
      if (!cleaned || cleaned.length > 65 || /^how you match$/i.test(cleaned)) continue;
      if (/^(matches based on|based on your)/i.test(cleaned)) continue;
      if (/^\+/.test(cleaned)) continue;
      results.push(cleaned);
    }
    return [...new Set(results)];
  }

  function textFromElement(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, nav, footer, header, button, form, input, select, textarea").forEach(node => node.remove());
    return cleanText(clone.innerText || clone.textContent || "");
  }

  function getDescription(jobPosting) {
    const structured = htmlToText(jobPosting?.description);
    if (structured && structured.length > 50) return structured.slice(0, 40000);

    const selectors = [
      '[data-automation="jobDescription"]',
      '[data-testid*="job-description" i]',
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
        if (text.length < 100 || text.length > 40000) return;

        let score = Math.min(text.length, 7000) / 100;
        if (/responsibilities|requirements|qualifications|what you.ll do|about the role|about the job/i.test(text)) score += 20;
        if (/job description|description/i.test(`${element.id} ${element.className} ${element.getAttribute("data-automation") || ""}`)) score += 35;
        if (text.length > 18000) score -= 25;
        if (score > bestScore) { best = text; bestScore = score; }
      });
    }

    if (best) return best.slice(0, 40000);

    const paragraphs = [...document.querySelectorAll("main p, article p, p")]
      .map(textFromElement).filter(text => text.length > 35);
    return paragraphs.join("\n\n").slice(0, 40000) || null;
  }

  function getEmployer(jobPosting, lines, title) {
    const structured = toPlainString(jobPosting?.hiringOrganization);
    if (structured) return structured;

    const labeled = findLabeledValue(lines, ["employer", "company", "company name", "posted by", "client"]);
    if (labeled) return labeled;

    // JobStreet commonly shows the employer immediately below the job title.
    const titleIndex = lines.findIndex(line => title && line.toLowerCase() === title.toLowerCase());
    if (titleIndex >= 0) {
      for (let i = titleIndex + 1; i < Math.min(lines.length, titleIndex + 5); i++) {
        const candidate = lines[i]
          .replace(/\bView all jobs\b/ig, "")
          .replace(/[★☆]\s*[\d.]+/g, "")
          .replace(/\s+\d\.\d\s*$/, "")
          .trim();
        if (!candidate || candidate.length > 100) continue;
        if (/^(?:verified|view all jobs|full time|part time|salary|posted|pasig city|manila|remote)/i.test(candidate)) continue;
        if (/^(?:location|work setup|shift schedule)\s*:/i.test(candidate)) continue;
        return candidate;
      }
    }

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
        return [address?.addressLocality, address?.addressRegion, address?.addressCountry].filter(Boolean).join(", ");
      }).filter(Boolean);
      if (formatted.length) return formatted.join(" | ");
    }
    const labeled = findLabeledValue(lines, ["location", "job location", "work location"]);
    if (labeled) return labeled;

    // JobStreet's summary card often presents the location as a standalone line.
    const candidate = lines.find(line =>
      /\b(?:city|metro manila|cebu|davao|laguna|cavite|remote|philippines)\b/i.test(line) &&
      line.length < 150 &&
      !/^(?:work setup|shift schedule)\s*:/i.test(line)
    );
    return candidate || null;
  }

  function getJobCategory(lines) {
    const labeled = findLabeledValue(lines, ["job category", "classification", "category", "industry"]);
    if (labeled) return labeled;

    const knownCategoryLine = lines.find(line =>
      /-\s*(?:software|information|engineering|accounting|administration|sales|marketing|human resources|healthcare|education|customer service|manufacturing|construction)/i.test(line) &&
      line.length < 180
    );
    return knownCategoryLine || null;
  }

  function getEmploymentType(jobPosting, lines) {
    const structured = toPlainString(jobPosting?.employmentType);
    if (structured) return structured;

    const labeled = findLabeledValue(lines, ["employment type", "job type", "work type"]);
    if (labeled) return labeled;

    const exact = lines.find(line => /^(full[- ]time|part[- ]time|contract|casual|temporary|freelance|internship)$/i.test(line));
    if (exact) return exact.toLowerCase();
    return null;
  }

  function getWorkArrangement(lines) {
    const labeled = findLabeledValue(lines, ["work setup", "work arrangement", "work location type", "work mode"]);
    if (labeled) return labeled;

    const line = lines.find(line => /^(remote|hybrid|onsite|on-site|work from home)$/i.test(line));
    return line || null;
  }

  function getShiftSchedule(lines) {
    return findLabeledValue(lines, ["shift schedule", "work schedule", "schedule"]);
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
    const match = location.pathname.match(/\/(?:job|jobs)\/(\d+)/i) ||
      location.pathname.match(/(?:job|jobs)[/-](\d+)/i) ||
      location.pathname.match(/\/(\d{6,})(?:\/|$)/);
    return match ? match[1] : null;
  }

  function extractJob() {
    const jobPosting = collectJsonLd();
    const lines = bodyLines();
    const pageText = lines.join("\n");

    const title = toPlainString(jobPosting?.title) ||
      cleanText(document.querySelector("h1")?.innerText || "") ||
      getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') ||
      cleanText(document.title).replace(/\s*[|–-]\s*(?:OnlineJobs\.ph|Jobstreet).*$/i, "") ||
      null;

    if (!title) {
      throw new Error("No job title was found. Open an individual job detail page, not the search results page.");
    }

    const onlineJobsType = !isJobStreet ? getOnlineJobsSectionValue(lines, ["TYPE OF WORK"]) : null;
    const onlineJobsWage = !isJobStreet ? getOnlineJobsSectionValue(lines, ["WAGE / SALARY"]) : null;
    const onlineJobsHours = !isJobStreet ? getOnlineJobsSectionValue(lines, ["HOURS PER WEEK"]) : null;
    const onlineJobsDateUpdated = !isJobStreet ? getOnlineJobsSectionValue(lines, ["DATE UPDATED"]) : null;
    const onlineJobsOverview = !isJobStreet ? getOnlineJobsSection(lines, ["JOB OVERVIEW"]) : null;
    const onlineJobsSkillData = !isJobStreet ? getOnlineJobsSkillRequirement(lines) : { text: null, skills: [] };
    const overviewSections = !isJobStreet
      ? extractOverviewSections(onlineJobsOverview)
      : { responsibilities: null, requirements: null, qualifications: null, preferred_qualifications: null, how_to_apply: null, benefits: null, other_sections: {} };
    const explicitOverviewSkills = !isJobStreet
      ? skillsFromRequirementText(overviewSections.requirements || overviewSections.qualifications || overviewSections.preferred_qualifications)
      : [];

    const description = !isJobStreet
      ? (onlineJobsOverview || getOnlineJobsDescription(jobPosting, lines))
      : getDescription(jobPosting);
    const salary = (!isJobStreet && onlineJobsWage) ||
      salaryFromStructured(jobPosting?.baseSalary) ||
      salaryFromVisibleText(lines, pageText);
    const salaryDisclosed = salary ? !/undisclosed/i.test(salary) : null;
    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const postedText = findPostedText(lines);
    const datePosted = toPlainString(jobPosting?.datePosted) ||
      onlineJobsDateUpdated ||
      getMeta('meta[property="article:published_time"]', 'meta[name="date"]') ||
      postedText ||
      document.querySelector("time[datetime]")?.getAttribute("datetime") ||
      null;

    const data = {
      platform: platformName,
      job_id: getJobId(jobPosting),
      job_title: title,
      employer: getEmployer(jobPosting, lines, title),
      location: getLocation(jobPosting, lines),
      salary: salary,
      salary_disclosed: salaryDisclosed,
      employment_type: (!isJobStreet && onlineJobsType) || getEmploymentType(jobPosting, lines),
      job_category: isJobStreet ? getJobCategory(lines) : null,
      work_arrangement: isJobStreet ? getWorkArrangement(lines) : null,
      shift_schedule: isJobStreet ? getShiftSchedule(lines) : null,
      hours_per_week: (!isJobStreet && onlineJobsHours) || getHoursPerWeek(lines, description),
      experience_level: getExperienceLevel(lines, description),
      date_posted: datePosted,
      date_updated: onlineJobsDateUpdated,
      posted_text: postedText,
      job_overview: onlineJobsOverview,
      responsibilities: overviewSections.responsibilities,
      requirements: overviewSections.requirements,
      qualifications: overviewSections.qualifications,
      preferred_qualifications: overviewSections.preferred_qualifications,
      benefits: overviewSections.benefits,
      how_to_apply: overviewSections.how_to_apply,
      skill_requirement_text: onlineJobsSkillData.text,
      skill_requirement_categories: onlineJobsSkillData.skills,
      required_skills: !isJobStreet
        ? (explicitOverviewSkills.length ? explicitOverviewSkills : onlineJobsSkillData.skills)
        : getRequiredSkills(lines, jobPosting),
      skills: !isJobStreet
        ? (explicitOverviewSkills.length ? explicitOverviewSkills : onlineJobsSkillData.skills)
        : getRequiredSkills(lines, jobPosting),
      matched_skills: isJobStreet ? getMatchedSkills(lines) : [],
      description: description,
      job_url: canonical,
      extracted_at: new Date().toISOString(),
      extraction_warnings: []
    };

    if (!data.description) data.extraction_warnings.push("Job description was not detected.");
    if (!data.salary) data.extraction_warnings.push("Salary was not detected or is not displayed.");
    if (!data.employer) data.extraction_warnings.push("Employer name was not detected.");
    if (!data.skills.length && !data.matched_skills.length) data.extraction_warnings.push(
      isJobStreet ? "No skill information was detected." : "The OnlineJobs.ph SKILL REQUIREMENT section was not detected. Check the page layout or share a screenshot of that section."
    );

    return data;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "OLJ_EXTRACT_JOB") return false;
    try {
      sendResponse({ ok: true, data: extractJob() });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Extraction failed." });
    }
    return false;
  });
})();
