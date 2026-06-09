import * as XLSX from "xlsx";
import { MASTER_COLS } from "@/config/columns";

const MISMATCH_META = {
  NAME_MISMATCH:    { colIndex: MASTER_COLS.FULL_NAME,      label: "Name" },
  NRIC_MISMATCH:    { colIndex: MASTER_COLS.PARTIAL_NRIC,   label: "NRIC" },
  CONTACT_MISMATCH: { colIndex: MASTER_COLS.CONTACT_NUMBER, label: "Contact" },
  EMAIL_MISMATCH:   { colIndex: MASTER_COLS.EMAIL,          label: "Email" },
  REGION_MISMATCH:  { colIndex: MASTER_COLS.REGION,         label: "Region" },
};

// ── ZIP-level data validation injection ───────────────────────────────────────
// SheetJS 0.18.x does not write data validation to xlsx.
// xlsx files are ZIP archives with STORED (uncompressed) entries, so we can
// inject the <dataValidations> XML directly into the binary buffer.

function injectDataValidation(xlsxArrayBuf, sqref, allowedValues) {
  const buf = new Uint8Array(xlsxArrayBuf);
  const dec = new TextDecoder();
  const enc = new TextEncoder();

  const valsEsc = allowedValues.map((v) => v.replace(/"/g, "&quot;")).join(",");
  const errMsg  = `Select ${allowedValues.join(" or ")}`;
  const dvXml   = `<dataValidations count="1"><dataValidation type="list" showDropDown="0" sqref="${sqref}" showErrorMessage="1" errorStyle="stop" errorTitle="Invalid entry" error="${errMsg}"><formula1>&quot;${valsEsc}&quot;</formula1></dataValidation></dataValidations>`;

  // ── Find local file header for the worksheet ──────────────────────────────
  const targetName  = enc.encode("xl/worksheets/sheet1.xml");
  let localHdrOff   = -1;
  let dataOff       = -1;
  let origSize      = 0;

  let pos = 0;
  while (pos < buf.length - 30) {
    if (buf[pos] === 0x50 && buf[pos+1] === 0x4B && buf[pos+2] === 0x03 && buf[pos+3] === 0x04) {
      const compMethod = buf[pos+8]  | (buf[pos+9]  << 8);
      const compSize   = (buf[pos+18] | (buf[pos+19] << 8) | (buf[pos+20] << 16) | (buf[pos+21] << 24)) >>> 0;
      const nameLen    = buf[pos+26] | (buf[pos+27] << 8);
      const extraLen   = buf[pos+28] | (buf[pos+29] << 8);
      const name       = buf.slice(pos+30, pos+30+nameLen);

      if (compMethod === 0 && nameLen === targetName.length && name.every((b, i) => b === targetName[i])) {
        localHdrOff = pos;
        dataOff     = pos + 30 + nameLen + extraLen;
        origSize    = compSize;
        break;
      }
      pos += 30 + nameLen + extraLen + compSize;
    } else {
      pos++;
    }
  }

  if (localHdrOff === -1) return xlsxArrayBuf;

  // ── Inject XML ────────────────────────────────────────────────────────────
  const wsXml    = dec.decode(buf.slice(dataOff, dataOff + origSize));
  const newWsXml = wsXml.replace("</worksheet>", dvXml + "</worksheet>");
  if (newWsXml === wsXml) return xlsxArrayBuf;

  const newWsBytes = enc.encode(newWsXml);
  const newSize    = newWsBytes.length;
  const sizeDiff   = newSize - origSize;

  // ── Find EOCD (scan backwards for PK\x05\x06) ───────────────────────────
  let eocdOff = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      eocdOff = i; break;
    }
  }
  if (eocdOff === -1) return xlsxArrayBuf;

  const cdOff  = (buf[eocdOff+16] | (buf[eocdOff+17] << 8) | (buf[eocdOff+18] << 16) | (buf[eocdOff+19] << 24)) >>> 0;

  // ── Build prefix (everything before compressed-size field) ───────────────
  // Local header layout:
  //   [0..17]  = signature + various fields (before compressed size)
  //   [18..21] = compressed size  ← update
  //   [22..25] = uncompressed size ← update
  //   [26..27] = name length
  //   [28..29] = extra length
  //   [30 + nameLen + extraLen] = file data
  const prefix = new Uint8Array(localHdrOff + 18 + 8 + (dataOff - localHdrOff - 26));
  prefix.set(buf.slice(0, localHdrOff + 18));
  const dv = new DataView(prefix.buffer);
  dv.setUint32(localHdrOff + 18, newSize, true); // compressed size
  dv.setUint32(localHdrOff + 22, newSize, true); // uncompressed size
  prefix.set(buf.slice(localHdrOff + 26, dataOff), localHdrOff + 26);

  // Data between end of sheet1.xml and start of central directory
  const middle = buf.slice(dataOff + origSize, cdOff);

  // ── Update central directory ──────────────────────────────────────────────
  const cdIn  = buf.slice(cdOff, eocdOff);
  const cdOut = new Uint8Array(cdIn.length);
  cdOut.set(cdIn);
  const cdView = new DataView(cdOut.buffer);

  let cdPos = 0;
  while (cdPos < cdOut.length - 46) {
    if (cdOut[cdPos] !== 0x50 || cdOut[cdPos+1] !== 0x4B ||
        cdOut[cdPos+2] !== 0x01 || cdOut[cdPos+3] !== 0x02) break;

    const entryNameLen    = cdView.getUint16(cdPos+28, true);
    const entryExtraLen   = cdView.getUint16(cdPos+30, true);
    const entryCommentLen = cdView.getUint16(cdPos+32, true);
    const localOff        = cdView.getUint32(cdPos+42, true);
    const entryName       = dec.decode(cdOut.slice(cdPos+46, cdPos+46+entryNameLen));

    if (entryName === "xl/worksheets/sheet1.xml") {
      cdView.setUint32(cdPos+20, newSize, true); // compressed size
      cdView.setUint32(cdPos+24, newSize, true); // uncompressed size
    }
    if (localOff > localHdrOff) {
      cdView.setUint32(cdPos+42, localOff + sizeDiff, true);
    }
    cdPos += 46 + entryNameLen + entryExtraLen + entryCommentLen;
  }

  // ── Update EOCD: central directory offset ─────────────────────────────────
  const eocdOut = new Uint8Array(buf.slice(eocdOff));
  new DataView(eocdOut.buffer).setUint32(16, cdOff + sizeDiff, true);

  // ── Assemble final buffer ─────────────────────────────────────────────────
  const totalLen = prefix.length + newWsBytes.length + middle.length + cdOut.length + eocdOut.length;
  const result   = new Uint8Array(totalLen);
  let off = 0;
  result.set(prefix,     off); off += prefix.length;
  result.set(newWsBytes, off); off += newWsBytes.length;
  result.set(middle,     off); off += middle.length;
  result.set(cdOut,      off); off += cdOut.length;
  result.set(eocdOut,    off);

  return result.buffer;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function exportReviewReport(reviewRows, regionLabel) {
  const date     = new Date().toISOString().slice(0, 10);
  const dataRows = [];

  reviewRows.forEach((result) => {
    const mf   = (result.outputRow[MASTER_COLS.MF_NUMBER] ?? "").trim();
    const ref  = (result.masterRow?.[MASTER_COLS.REF_NO]  ?? "").toString().trim();
    const name = (result.outputRow[MASTER_COLS.FULL_NAME]  ?? "").trim();

    result.errors
      .filter((e) => e.severity === "warning" && MISMATCH_META[e.code])
      .forEach((err) => {
        const { colIndex, label } = MISMATCH_META[err.code];
        dataRows.push({
          _mfNumber:   mf,
          _refNo:      ref,
          _field:      label,
          "MF No.":    mf,
          "Ref No.":   ref,
          "Full Name": name,
          "Field":     label,
          "Current":   (result.masterRow?.[colIndex] ?? "").toString().trim(),
          "New":       (result.outputRow[colIndex]   ?? "").toString().trim(),
          "Decision":  "",
          "Notes":     "",
        });
      });
  });

  if (dataRows.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(dataRows, {
    header: ["_mfNumber", "_refNo", "_field", "MF No.", "Ref No.", "Full Name", "Field", "Current", "New", "Decision", "Notes"],
  });

  ws["!cols"] = [
    { hidden: true },  // _mfNumber
    { hidden: true },  // _refNo
    { hidden: true },  // _field
    { wch: 10 },       // MF No.
    { wch: 8  },       // Ref No.
    { wch: 20 },       // Full Name
    { wch: 12 },       // Field
    { wch: 25 },       // Current
    { wch: 25 },       // New
    { wch: 14 },       // Decision
    { wch: 30 },       // Notes
  ];

  const instructions = XLSX.utils.aoa_to_sheet([
    ["Review Report — Instructions"],
    [""],
    ["For each row, enter a value in the Decision column:"],
    [""],
    ["  current  →  Keep the current value from the master sheet"],
    ["  new      →  Use the new value submitted via the form"],
    ["  (blank)  →  No decision yet — row stays under review"],
    [""],
    ["The Decision column only accepts: current  or  new"],
    [""],
    ["If two people share the same MF No., the Ref No. column tells them apart."],
    [""],
    ["You may fill in partial decisions — only rows with a Decision will be resolved."],
    ["Do not add, remove, or reorder rows. Do not edit any other columns."],
    ["Save the file and return it to the admin to be uploaded back into the app."],
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, regionLabel);
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");

  // Generate xlsx buffer then inject data validation dropdown for Decision column (J)
  const rawBuf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const dvSqref = dataRows.length > 0 ? `J2:J${dataRows.length + 1}` : "J2:J1000";
  const finalBuf = injectDataValidation(rawBuf, dvSqref, ["current", "new"]);

  const blob = new Blob([finalBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `review-${regionLabel.toLowerCase().replace(/\s+/g, "-")}-${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
