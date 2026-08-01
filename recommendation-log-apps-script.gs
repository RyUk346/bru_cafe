/**
 * Bru Café — Recommendation Log Apps Script
 *
 * Deploy this as a Web App in the same Google Sheet that holds your
 * "Food Recommendations" tab. Then put the Web App URL into your
 * server's .env as:
 *
 *   RECOMMENDATION_LOG_SCRIPT_URL=https://script.google.com/macros/s/.../exec
 *
 * It will upsert into the "Recommendation Log" tab using these columns:
 *   Product Name | Time Recommended | Reason of Recommendation | Recommendation Time
 *
 * Behaviour:
 *  - If a row for Product Name already exists, increment "Time Recommended"
 *    and overwrite "Reason of Recommendation" + "Recommendation Time" with
 *    the latest values.
 *  - Otherwise, append a new row starting at count = 1.
 */

const LOG_SHEET_NAME = "Recommendation Log";

const COLUMNS = {
  productName: "Product Name",
  count: "Time Recommended",
  reason: "Reason of Recommendation",
  time: "Recommendation Time",
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const productName = String(body.productName || "").trim();
    const reason = String(body.reason || "").trim();
    const recommendationTime =
      String(body.recommendationTime || "").trim() || new Date().toISOString();

    if (!productName) {
      return jsonResponse({ success: false, error: "productName required" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(LOG_SHEET_NAME);

    // Auto-create the tab with headers on first run
    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow([
        COLUMNS.productName,
        COLUMNS.count,
        COLUMNS.reason,
        COLUMNS.time,
      ]);
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    // Ensure header row exists
    if (lastRow === 0) {
      sheet.appendRow([
        COLUMNS.productName,
        COLUMNS.count,
        COLUMNS.reason,
        COLUMNS.time,
      ]);
    }

    const headerValues = sheet
      .getRange(1, 1, 1, Math.max(lastCol, 4))
      .getValues()[0]
      .map(function (h) {
        return String(h || "").trim();
      });

    const idxName = headerValues.indexOf(COLUMNS.productName);
    const idxCount = headerValues.indexOf(COLUMNS.count);
    const idxReason = headerValues.indexOf(COLUMNS.reason);
    const idxTime = headerValues.indexOf(COLUMNS.time);

    if (idxName === -1 || idxCount === -1 || idxReason === -1 || idxTime === -1) {
      return jsonResponse({
        success: false,
        error:
          "Missing required column header. Expected: Product Name, Time Recommended, Reason of Recommendation, Recommendation Time",
      });
    }

    let foundRow = -1;
    if (sheet.getLastRow() > 1) {
      const data = sheet
        .getRange(2, idxName + 1, sheet.getLastRow() - 1, 1)
        .getValues();
      for (let i = 0; i < data.length; i++) {
        if (
          String(data[i][0] || "").trim().toLowerCase() ===
          productName.toLowerCase()
        ) {
          foundRow = i + 2; // +1 for header, +1 for 1-based
          break;
        }
      }
    }

    if (foundRow === -1) {
      const newRow = [];
      const totalCols = Math.max(headerValues.length, 4);
      for (let c = 0; c < totalCols; c++) {
        if (c === idxName) newRow[c] = productName;
        else if (c === idxCount) newRow[c] = 1;
        else if (c === idxReason) newRow[c] = reason;
        else if (c === idxTime) newRow[c] = recommendationTime;
        else newRow[c] = "";
      }
      sheet.appendRow(newRow);
      return jsonResponse({ success: true, action: "created", count: 1 });
    }

    const currentCount =
      Number(sheet.getRange(foundRow, idxCount + 1).getValue()) || 0;
    const newCount = currentCount + 1;

    sheet.getRange(foundRow, idxCount + 1).setValue(newCount);
    sheet.getRange(foundRow, idxReason + 1).setValue(reason);
    sheet.getRange(foundRow, idxTime + 1).setValue(recommendationTime);

    return jsonResponse({ success: true, action: "updated", count: newCount });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
