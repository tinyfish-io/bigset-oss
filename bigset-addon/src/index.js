// ─────────────────────────────────────────────────────────────────────────────
//  BigSet — Google Sheet Add-on
//  Entry point for Apps Script. All functions here are globally accessible
//  via google.script.run from the sidebar iframe.
// ─────────────────────────────────────────────────────────────────────────────
const ADDON_NAME = "BigSet";
const SCRIPT_PROPERTY_KEY = "BIGSET_API_KEY";
const SCRIPT_PROPERTY_URL = "BIGSET_BACKEND_URL";
const DEFAULT_BACKEND_URL = "";
// ─── Add-on lifecycle ─────────────────────────────────────────────────────────
function onOpen(_e) {
    SpreadsheetApp.getUi()
        .createAddonMenu()
        .addItem("Open", "showSidebar")
        .addToUi();
}
//on Install is called when the user installs the add-on for the first time. It calls onOpen to set up the menu.
function onInstall(_e) {
    onOpen(_e);
}
function showSidebar() {
    const ui = HtmlService.createTemplateFromFile("sidebar")
        .evaluate()
        .setTitle(ADDON_NAME);
    SpreadsheetApp.getUi().showSidebar(ui);
}
// ─── User settings (per-user, stored in script properties) ────────────────────
function getApiKey() {
    return PropertiesService.getUserProperties().getProperty(SCRIPT_PROPERTY_KEY) || "";
}
function setApiKey(key) {
    PropertiesService.getUserProperties().setProperty(SCRIPT_PROPERTY_KEY, key);
}
function getBackendUrl() {
    return PropertiesService.getUserProperties().getProperty(SCRIPT_PROPERTY_URL) || DEFAULT_BACKEND_URL;
}
function setBackendUrl(url) {
    PropertiesService.getUserProperties().setProperty(SCRIPT_PROPERTY_URL, url);
}
// ─── Backend HTTP proxy ────────────────────────────────────────────────────────
/**
 * Make an authenticated request to the BigSet backend.
 * Runs server-side via UrlFetchApp so CORS is not an issue.
 */
function callBackend(path, method, body) {
    const baseUrl = (PropertiesService.getUserProperties().getProperty(SCRIPT_PROPERTY_URL) || DEFAULT_BACKEND_URL).trim();
    const apiKey = PropertiesService.getUserProperties().getProperty(SCRIPT_PROPERTY_KEY) || "";
    if (!baseUrl) {
        throw new Error("Backend URL is not configured. Open the BigSet sidebar → Settings and set your backend URL.");
    }
    if (!/^https:\/\//i.test(baseUrl)) {
        throw new Error(`Backend URL must use HTTPS (got "${baseUrl}"). Update it in Settings to an https:// URL — the add-on sends your API key on every request.`);
    }
    const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const options = {
        method: (method || "POST"),
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        muteHttpExceptions: true,
        followRedirects: true,
        timeout: 30000,
    };
    if (apiKey) {
        options.headers["X-API-Key"] = apiKey;
        options.headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (body !== null && body !== undefined) {
        options.contentType = "application/json";
        options.payload = JSON.stringify(body);
    }
    const response = UrlFetchApp.fetch(url, options);
    const status = response.getResponseCode();
    const text = response.getContentText();
    let parsed = null;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        // not JSON
    }
    if (status >= 200 && status < 300) {
        return parsed;
    }
    const errorMsg = parsed && typeof parsed === "object" && parsed.error
        ? String(parsed.error)
        : `Backend responded with ${status}`;
    throw new Error(errorMsg);
}
// ─── Sheet operations ──────────────────────────────────────────────────────────
/**
 * Insert rows into the active sheet, optionally clearing existing content first.
 * Returns the range that was written.
 */
function insertRowsIntoActiveSheet(headers, rows, clearFirst) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (clearFirst) {
        sheet.clearContents();
        sheet.clearFormats();
    }
    if (!rows || rows.length === 0) {
        if (headers && headers.length > 0) {
            sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        }
        return { rowsInserted: 0, startCell: "A1", endCell: "A1" };
    }
    const data = [headers];
    for (const row of rows) {
        const values = headers.map((h) => {
            const val = row[h];
            return val !== null && val !== undefined ? val : "";
        });
        data.push(values);
    }
    const numRows = data.length;
    const numCols = headers.length;
    sheet.getRange(1, 1, numRows, numCols).setValues(data);
    return { rowsInserted: rows.length, startCell: "A1", endCell: `${columnLetter(numCols)}${numRows}` };
}
// ─── Column index helpers ───────────────────────────────────────────────────────
/** Convert 1-based column number to letters (1→A, 27→AA). */
function columnLetter(col) {
    let letter = "";
    while (col > 0) {
        col--;
        letter = String.fromCharCode(65 + (col % 26)) + letter;
        col = Math.floor(col / 26);
    }
    return letter;
}
/** Convert column letters to 1-based index (A→1, AA→27). */
function colToIndex(colStr) {
    let idx = 0;
    for (let i = 0; i < colStr.length; i++) {
        idx = idx * 26 + (colStr.charCodeAt(i) - 64);
    }
    return idx;
}
// ─── Enrichment — read / write ─────────────────────────────────────────────────
/**
 * Read the user's selected range from the active sheet.
 * Expects the first row of the selection to contain column headers.
 *
 * Returns: { headers: string[], rows: Array<{ rowIndex: number, data: {} }>, range: string }
 *
 * Only includes rows where at least one cell is non-empty.
 */
function getSelectedRange() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const activeRange = sheet.getActiveRange();
    if (!activeRange) {
        return { headers: [], rows: [], range: "" };
    }
    const rowStart = activeRange.getRow();
    const colStart = activeRange.getColumn();
    const numRows = activeRange.getNumRows();
    const numCols = activeRange.getNumColumns();
    const rawRangeStr = `${columnLetter(colStart)}${rowStart}:${columnLetter(colStart + numCols - 1)}${rowStart + numRows - 1}`;
    if (numRows < 2) {
        return { headers: [], rows: [], range: rawRangeStr };
    }
    const values = activeRange.getValues();
    // Find the last column with a non-empty header
    let lastCol = 0;
    for (let j = values[0].length - 1; j >= 0; j--) {
        const header = values[0][j];
        if (header !== "" && header !== null && header !== undefined) {
            lastCol = j + 1;
            break;
        }
    }
    if (lastCol === 0) {
        return { headers: [], rows: [], range: rawRangeStr };
    }
    // Find the last row with at least one non-empty value
    let lastRow = 0;
    for (let i = values.length - 1; i >= 1; i--) {
        for (let j = 0; j < lastCol; j++) {
            const val = values[i][j];
            if (val !== "" && val !== null && val !== undefined) {
                lastRow = i;
                break;
            }
        }
        if (lastRow > 0)
            break;
    }
    if (lastRow === 0) {
        return { headers: [], rows: [], range: rawRangeStr };
    }
    // Build headers from trimmed columns
    var headers = [];
    for (let j = 0; j < lastCol; j++) {
        headers.push(String(values[0][j]));
    }
    // Validate: every header must be non-empty and unique. rowData is keyed by
    // header text, so duplicates would collapse columns and updateSheetCells()
    // would route every update with that columnName to the first occurrence.
    for (let j = 0; j < headers.length; j++) {
        if (!headers[j]) {
            throw new Error(`Column ${columnLetter(colStart + j)} has a blank header. Add a header or remove the column before enriching.`);
        }
        if (headers.indexOf(headers[j]) !== j) {
            const first = columnLetter(colStart + headers.indexOf(headers[j]));
            const dup = columnLetter(colStart + j);
            throw new Error(`Duplicate header "${headers[j]}" at columns ${first} and ${dup}. Rename one to make headers unique.`);
        }
    }
    // Build rows from trimmed data
    const rowsData = [];
    for (let i = 1; i <= lastRow; i++) {
        const rowData = {};
        let hasValue = false;
        for (let j = 0; j < lastCol; j++) {
            const val = values[i][j];
            if (val !== "" && val !== null && val !== undefined) {
                rowData[headers[j]] = val;
                hasValue = true;
            }
            else {
                rowData[headers[j]] = null;
            }
        }
        if (hasValue) {
            rowsData.push({
                rowIndex: rowStart + i,
                data: rowData,
            });
        }
    }
    const trimmedRange = `${columnLetter(colStart)}${rowStart}:${columnLetter(colStart + lastCol - 1)}${rowStart + lastRow}`;
    return { headers, rows: rowsData, range: trimmedRange };
}
/**
 * Write enrichment results back to the sheet.
 * Only writes to cells that are currently empty — never overwrites data.
 *
 * @param updates       Array of { rowIndex, columnName, value } to write
 * @param rangeStr     Original range snapshot from getSelectedRange() — used to
 *                     resolve columns without re-querying the active selection
 */
function updateSheetCells(updates, rangeStr) {
    if (!updates || updates.length === 0) {
        return { updated: 0 };
    }
    if (!rangeStr)
        return { updated: 0 };
    const parts = rangeStr.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!parts)
        return { updated: 0 };
    const colStart = colToIndex(parts[1]);
    const rowStart = parseInt(parts[2], 10);
    const lastCol = colToIndex(parts[3]);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const headersRange = sheet.getRange(rowStart, colStart, 1, lastCol - colStart + 1);
    const headers = headersRange.getValues()[0].map(String);
    let updated = 0;
    for (const update of updates) {
        const colIndex = headers.indexOf(update.columnName);
        if (colIndex === -1)
            continue;
        const rowIndex = parseInt(String(update.rowIndex), 10);
        if (isNaN(rowIndex) || rowIndex < 2)
            continue;
        const cell = sheet.getRange(rowIndex, colStart + colIndex);
        if (cell.getFormula() !== "")
            continue;
        const currentValue = cell.getValue();
        if (currentValue !== "" && currentValue !== null && currentValue !== undefined) {
            continue;
        }
        cell.setValue(update.value);
        updated++;
    }
    return { updated };
}
