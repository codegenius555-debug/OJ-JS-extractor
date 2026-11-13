# OnlineJobs.ph JSON Extractor

A lightweight Google Chrome Manifest V3 extension for extracting information from the **currently open individual OnlineJobs.ph job listing**.

## Features

- Extracts one job from the active OnlineJobs.ph tab.
- Looks for structured `JobPosting` data (JSON-LD) first, then falls back to visible page content.
- Extracts:
  - Platform
  - Job ID
  - Job title
  - Employer
  - Location
  - Salary
  - Employment type
  - Hours per week
  - Experience level
  - Date posted
  - Skills
  - Job description
  - Job URL
  - Extraction timestamp
- Shows a formatted JSON preview.
- Copies JSON to the clipboard.
- Downloads a `.json` file.
- Does not send page data to an external server.

## Install on Windows

1. Download and extract `onlinejobs-json-extractor.zip`.
2. Open Google Chrome.
3. Enter `chrome://extensions` in the address bar.
4. Turn on **Developer mode** in the upper-right corner.
5. Click **Load unpacked**.
6. Select the extracted `onlinejobs-json-extractor` folder (the folder containing `manifest.json`).
7. Pin **OnlineJobs.ph JSON Extractor** to the Chrome toolbar if you want quick access.

## Use

1. Open an individual job listing on `https://www.onlinejobs.ph/`.
2. Click the extension icon.
3. Click **Extract & Export Both**.
4. The extension will attempt to copy the JSON to your clipboard and open Chrome's save dialog for the `.json` file.
5. Review the JSON preview in the popup.

You can also click **Extract Only**, then use **Copy JSON** or **Download JSON** separately.

## Example output

```json
{
  "platform": "OnlineJobs.ph",
  "job_id": null,
  "job_title": "Example Job Title",
  "employer": "Example Employer",
  "location": "Remote",
  "salary": "$1,000 - $1,500/month",
  "employment_type": "full time",
  "hours_per_week": "40 hours/week",
  "experience_level": null,
  "date_posted": "2026-11-12",
  "skills": ["React", "JavaScript", "Node.js"],
  "description": "Example job description...",
  "job_url": "https://www.onlinejobs.ph/jobseekers/job/123456",
  "extracted_at": "2026-11-13T12:00:00.000Z",
  "extraction_warnings": []
}
```

Values in this example are illustrative. The extension does not invent missing information; fields it cannot detect are `null`, empty arrays, or listed in `extraction_warnings`.

## Troubleshooting

### "Open an OnlineJobs.ph job listing"
Make sure the active tab is on `onlinejobs.ph` or `www.onlinejobs.ph`.

### "No job title was found"
Open an individual job detail page, not the search results page. If the page has loaded dynamically, refresh it and try again.

### Some fields are missing
OnlineJobs.ph may change its page layout, and employers may use different formats. The extension uses structured data when available and several page-content fallbacks. Missing fields are left blank rather than guessed.

### Extension changes do not appear
Open `chrome://extensions`, find the extension, and click the reload icon. Refresh the OnlineJobs.ph job page afterward.

## Project files

- `manifest.json` — Chrome extension configuration.
- `popup.html` — Extension popup.
- `popup.css` — Popup styling.
- `popup.js` — Extraction and export controls.
- `content.js` — Reads the active job page and builds the JSON object.

## Privacy

The extension runs locally in the browser. It does not include analytics, tracking, remote APIs, or external data uploads. It reads the current OnlineJobs.ph page only when you click an extraction button.
