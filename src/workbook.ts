import * as XLSX from "xlsx";
import { unzipSync, zipSync } from "fflate";
import * as XlsxPopulateModule from "@xlsx/xlsx-populate";

export type SourceName = "KOPERASI" | "MANDIRI" | "BRI";

export interface ImportedRow {
  rowNumber: number;
  memberNo: string;
  source: SourceName;
  bankSource: "MANDIRI" | "BRI" | null;
  memberName: string;
  normalizedName: string;
  savingsPrincipal: number;
  savingsMandatory: number;
  savingsVoluntary: number;
  principalPaid: number;
  interestPaid: number;
  installmentTotal: number;
  installmentNumber: number | null;
  totalDeduction: number;
  outstandingPrincipal: number;
  originalLoanAmount: number;
  note: string;
  termMonths: number | null;
  interestRate: number | null;
  nextCounter: number | null;
  nextMonthInstallmentNumber: number | null;
}

export interface WorkbookPreview {
  periodId: string;
  periodLabel: string;
  rows: ImportedRow[];
  warnings: string[];
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = numberValue(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function periodFromCell(value: unknown): string | null {
  let year: number | null = null;
  let month: number | null = null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel date cells are represented as local Date objects by SheetJS.
    // Read the local calendar components so WIB does not shift 1 November to 31 October.
    year = value.getFullYear();
    month = value.getMonth() + 1;
  } else if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y >= 2000 && parsed.m >= 1 && parsed.m <= 12) {
      year = parsed.y;
      month = parsed.m;
    }
  } else if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    const numeric = raw.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
    if (numeric) {
      const first = Number(numeric[1]);
      const second = Number(numeric[2]);
      const third = Number(numeric[3]);
      // Format Indonesia dd/mm/yyyy dan format ISO yyyy/mm/dd.
      year = numeric[1].length === 4 ? first : third;
      month = numeric[1].length === 4 ? second : second;
    } else {
      const iso = raw.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
      if (iso) {
        year = Number(iso[1]);
        month = Number(iso[2]);
      } else {
        const months: Record<string, number> = {
          januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3,
          april: 4, apr: 4, mei: 5, may: 5, juni: 6, jun: 6,
          juli: 7, jul: 7, agustus: 8, agu: 8, agt: 8,
          september: 9, sep: 9, oktober: 10, okt: 10, october: 10, oct: 10,
          november: 11, nov: 11, desember: 12, des: 12, december: 12, dec: 12
        };
        const tokens = raw.split(/[^a-z]+/).filter(Boolean);
        const monthEntry = Object.entries(months).find(([name]) => tokens.includes(name));
        const y = raw.match(/(?:19|20)\d{2}/);
        if (monthEntry && y) {
          month = monthEntry[1];
          year = Number(y[0]);
        }
      }
    }
  }

  if (!year || !month || year < 2000 || month < 1 || month > 12) return null;
  return year + "-" + String(month).padStart(2, "0");
}

export async function parseWorkbook(file: File, password = ""): Promise<WorkbookPreview> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const encryptedOfficeFile = file.name.toLowerCase().endsWith(".xlsx") &&
    bytes.length >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1;

  let workbook: XLSX.WorkBook;
  if (encryptedOfficeFile) {
    if (!password) throw new Error("PASSWORD_REQUIRED");
    try {
      // Decrypt the password-protected XLSX locally in the browser. The original
      // file is never uploaded and the password is never persisted.
      type BrowserReader = {
        fromData?: (data: ArrayBuffer, options: { password: string }) => Promise<{
          output: (options: { type: "arraybuffer" }) => Promise<ArrayBuffer>;
        }>;
      };
      // Depending on the CommonJS/ESM interop shape, Vite may expose the
      // package API on either the namespace or its default export.
      const moduleExports = XlsxPopulateModule as unknown as BrowserReader & {
        default?: BrowserReader;
      };
      const browserReader = moduleExports.default ?? moduleExports;
      if (typeof browserReader.fromData !== "function") {
        throw new Error("ENCRYPTED_XLSX_UNSUPPORTED");
      }
      try {
        const decrypted = await browserReader.fromData(buffer, { password });
        const plainBuffer = await decrypted.output({ type: "arraybuffer" });
        workbook = XLSX.read(plainBuffer, { type: "array", cellDates: true });
      } catch {
        throw new Error("PASSWORD_INVALID");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "ENCRYPTED_XLSX_UNSUPPORTED") {
        throw error;
      }
      throw new Error("PASSWORD_INVALID");
    }
  } else {
    // Normalize the ZIP container before handing it to SheetJS. Some Excel files
    // produced by desktop/mobile office apps contain ZIP metadata that causes
    // browser readers to report "Bad compressed size" even though the XML files
    // are intact. Repacking preserves every workbook entry and its cell values.
    try {
      const entries = unzipSync(bytes);
      const normalizedArchive = zipSync(entries, { level: 6 });
      workbook = XLSX.read(normalizedArchive, { type: "array", cellDates: true });
    } catch (normalizationError) {
      // Keep a compatibility fallback for unusual but valid OOXML containers.
      workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    }
  }
  const sheets: Array<[string, SourceName]> = [
    ["Pot. Koperasi", "KOPERASI"],
    ["MANDIRI", "MANDIRI"],
    ["BRI", "BRI"]
  ];
  const warnings: string[] = [];
  const rows: ImportedRow[] = [];
  let periodId: string | null = null;

  for (const [sheetName, source] of sheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      if (source === "KOPERASI") warnings.push("STOP: Sheet utama Pot. Koperasi tidak ditemukan.");
      continue;
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    // Kolom P pada template menjadi parameter bunga per bulan. Nilai ini
    // biasanya hanya diisi sekali (baris pertama), lalu dipakai formula baris lain.
    const sheetInterestRate = matrix.slice(5)
      .map(row => nullableNumber(row?.[15]))
      .find(value => value !== null) ?? 0.01;
    const sheetPeriod = source === "KOPERASI" ? periodFromCell(matrix[1]?.[0]) : null;
    if (source === "KOPERASI") {
      if (!sheetPeriod) warnings.push("STOP: Tanggal periode pada sel A2 sheet Pot. Koperasi tidak terbaca.");
      else periodId = sheetPeriod;
    }

    // Workbook KPN: header pada baris 3-5, data dimulai pada baris 6. Pot. Koperasi adalah rekap konsolidasi; MANDIRI/BRI rincian pinjaman.
    for (let index = 5; index < matrix.length; index += 1) {
      const row = matrix[index] || [];
      const serial = row[0];
      const name = typeof row[1] === "string" ? row[1].trim() : "";
      if (typeof serial !== "number" || !name) continue;

      const originalLoanAmount = numberValue(row[11]);
      const principalPaid = numberValue(row[5]);
      const explicitTermMonths = nullableNumber(row[13]);
      const serialCell = sheet[XLSX.utils.encode_cell({ r: index, c: 0 })];
      const memberNo = serialCell ? XLSX.utils.format_cell(serialCell).trim() : String(serial).trim();
      const imported: ImportedRow = {
        rowNumber: index + 1,
        memberNo,
        source,
        bankSource: null,
        memberName: name,
        normalizedName: normalizeName(name),
        savingsPrincipal: numberValue(row[2]),
        savingsMandatory: numberValue(row[3]),
        savingsVoluntary: numberValue(row[4]),
        principalPaid,
        interestPaid: numberValue(row[6]),
        installmentTotal: numberValue(row[7]),
        installmentNumber: nullableNumber(row[8]),
        totalDeduction: numberValue(row[9]),
        outstandingPrincipal: numberValue(row[10]),
        originalLoanAmount,
        note: typeof row[12] === "string" ? row[12].trim() : "",
        termMonths: explicitTermMonths,
        interestRate: nullableNumber(row[15]) ?? (originalLoanAmount > 0 ? sheetInterestRate : null),
        nextCounter: nullableNumber(row[17]),
        nextMonthInstallmentNumber: nullableNumber(row[18])
      };
      rows.push(imported);

      const numericFields = [
        imported.savingsPrincipal, imported.savingsMandatory, imported.savingsVoluntary,
        imported.principalPaid, imported.interestPaid, imported.installmentTotal,
        imported.totalDeduction, imported.outstandingPrincipal, imported.originalLoanAmount
      ];
      if (source === "KOPERASI" && numericFields.some(value => value < 0)) {
        warnings.push("STOP: Ada nominal negatif pada " + sheetName + " baris " + (index + 1) + ".");
      }
      if (source === "KOPERASI" && imported.originalLoanAmount > 0 && imported.outstandingPrincipal > imported.originalLoanAmount) {
        warnings.push("STOP: Sisa pinjaman melebihi pokok awal pada " + sheetName + " baris " + (index + 1) + ".");
      }

      if (source === "KOPERASI" && imported.originalLoanAmount > 0 && imported.installmentTotal === 0) {
        warnings.push("PERIKSA: Hasil formula angsuran nol pada " + sheetName + " baris " + (index + 1) + ".");
      }
      if (source === "KOPERASI" && imported.installmentTotal > 0 &&
          Math.abs(imported.installmentTotal - imported.principalPaid - imported.interestPaid) > 1) {
        warnings.push("PERIKSA: Total angsuran tidak sama dengan pokok + bunga pada " + sheetName + " baris " + (index + 1) + ".");
      }
      if (source === "KOPERASI" && imported.outstandingPrincipal > 0 && imported.installmentNumber === null) {
        warnings.push("STOP: Nomor angsuran belum diisi untuk pinjaman aktif pada " + sheetName + " baris " + (index + 1) + ". Sistem tidak akan menebak nomor angsuran berikutnya.");
      }
      if (source === "KOPERASI" && imported.originalLoanAmount > 0 && imported.termMonths === null) {
        warnings.push("PERIKSA: Tenor pinjaman belum diisi pada " + sheetName + " baris " + (index + 1) + ". Tenor tidak akan ditebak dari jumlah pinjaman.");
      }
      if (source === "KOPERASI" && imported.outstandingPrincipal > 0 &&
          imported.principalPaid <= 0 && imported.termMonths === null) {
        warnings.push("STOP: Pokok angsuran bulanan dan tenor sama-sama kosong pada " + sheetName + " baris " + (index + 1) + ". Lengkapi salah satunya agar angsuran berikutnya dapat dihitung.");
      }
      if (source === "KOPERASI" && imported.outstandingPrincipal > 0 && imported.originalLoanAmount <= 0) {
        warnings.push("STOP: Sisa pinjaman ada tetapi pokok awal kosong pada " + sheetName + " baris " + (index + 1) + ".");
      }
    }
  }

  const masterRows = rows.filter(row => row.source === "KOPERASI");
  const bankRows = rows.filter(row => row.source === "MANDIRI" || row.source === "BRI");
  const masterNames = new Set(masterRows.map(row => row.normalizedName));
  const memberNumbers = new Set(masterRows.map(row => row.memberNo));
  if (masterRows.length === 0) warnings.push("STOP: Sheet Pot. Koperasi tidak berisi baris anggota.");
  if (masterNames.size !== masterRows.length) warnings.push("STOP: Ada nama anggota ganda pada sheet Pot. Koperasi setelah normalisasi.");
  if (memberNumbers.size !== masterRows.length) warnings.push("STOP: Ada nomor anggota/urutan kolom A yang ganda pada sheet Pot. Koperasi.");

  // Sheet bank hanya dipakai untuk memberi label sumber potongan. Nilai pinjaman,
  // angsuran, bunga, tenor, dan saldo selalu dibaca dari Pot. Koperasi.
  const bankByMember = new Map<string, "MANDIRI" | "BRI">();
  for (const source of ["MANDIRI", "BRI"] as const) {
    const seen = new Set<string>();
    for (const row of bankRows.filter(item => item.source === source)) {
      if (seen.has(row.normalizedName)) {
        warnings.push("STOP: Nama anggota ganda pada sheet " + source + ".");
      }
      seen.add(row.normalizedName);
      if (!masterNames.has(row.normalizedName)) {
        warnings.push("STOP: Nama pada sheet " + source + " tidak ditemukan di Pot. Koperasi: " + row.memberName + ".");
      }
      const previous = bankByMember.get(row.normalizedName);
      if (previous && previous !== source) {
        warnings.push("STOP: Anggota " + row.memberName + " tercantum pada MANDIRI dan BRI sekaligus. Periksa pemisahan potongan bank.");
      } else {
        bankByMember.set(row.normalizedName, source);
      }
    }
  }

  for (const row of masterRows) {
    row.bankSource = bankByMember.get(row.normalizedName) ?? null;
    // Koreksi tenor Alextra sesuai konfirmasi pengelola; tidak mengubah workbook asli.
    if (row.normalizedName === "alextra" && row.originalLoanAmount > 0) row.termMonths = 20;
    if (row.outstandingPrincipal > 0 && row.installmentNumber === null) {
      warnings.push("STOP: Nomor angsuran belum diisi untuk pinjaman " + row.memberName + " pada Pot. Koperasi.");
    }
    if (row.originalLoanAmount > 0 && row.termMonths === null) {
      warnings.push("PERIKSA: Tenor pinjaman " + row.memberName + " belum diisi pada Pot. Koperasi. Tenor tidak akan ditebak.");
    }
    if (row.outstandingPrincipal > 0 && row.originalLoanAmount <= 0) {
      warnings.push("STOP: Sisa pinjaman ada tetapi pokok awal kosong untuk " + row.memberName + " pada Pot. Koperasi.");
    }
  }

  if (!periodId) warnings.push("STOP: Periode tidak dapat ditentukan dari sel A2 Pot. Koperasi.");
  if (masterRows.length === 0) warnings.push("Tidak ada baris anggota yang terbaca pada Pot. Koperasi.");
    const periodLabel = periodId
    ? new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(periodId + "-01T00:00:00Z"))
    : "Periode tidak terbaca";
  return { periodId: periodId || "", periodLabel, rows: masterRows, warnings };
}

export function stableId(prefix: string, value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "record";
  return prefix + "_" + safe + "_" + (hash >>> 0).toString(36);
}