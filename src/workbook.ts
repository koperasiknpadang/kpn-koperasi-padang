import * as XLSX from "xlsx";

export type SourceName = "KOPERASI" | "MANDIRI" | "BRI";

export interface ImportedRow {
  rowNumber: number;
  source: SourceName;
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
  let date: Date | null = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) date = value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date) return null;
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
}

export async function parseWorkbook(file: File): Promise<WorkbookPreview> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
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
      warnings.push("STOP: Sheet wajib tidak ditemukan: " + sheetName);
      continue;
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    if (!periodId) periodId = periodFromCell(matrix[1]?.[0]) || null;

    // Workbook KPN: header pada baris 3-5, data dimulai pada baris 6. Pot. Koperasi adalah rekap konsolidasi; MANDIRI/BRI rincian pinjaman.
    for (let index = 5; index < matrix.length; index += 1) {
      const row = matrix[index] || [];
      const serial = row[0];
      const name = typeof row[1] === "string" ? row[1].trim() : "";
      if (typeof serial !== "number" || !name) continue;

      const imported: ImportedRow = {
        rowNumber: index + 1,
        source,
        memberName: name,
        normalizedName: normalizeName(name),
        savingsPrincipal: numberValue(row[2]),
        savingsMandatory: numberValue(row[3]),
        savingsVoluntary: numberValue(row[4]),
        principalPaid: numberValue(row[5]),
        interestPaid: numberValue(row[6]),
        installmentTotal: numberValue(row[7]),
        installmentNumber: nullableNumber(row[8]),
        totalDeduction: numberValue(row[9]),
        outstandingPrincipal: numberValue(row[10]),
        originalLoanAmount: numberValue(row[11]),
        note: typeof row[12] === "string" ? row[12].trim() : "",
        termMonths: nullableNumber(row[13]),
        interestRate: nullableNumber(row[15]),
        nextCounter: nullableNumber(row[17]),
        nextMonthInstallmentNumber: nullableNumber(row[18])
      };
      rows.push(imported);

      if (imported.originalLoanAmount > 0 && imported.installmentTotal === 0) {
        warnings.push("PERIKSA: Hasil formula angsuran nol pada " + sheetName + " baris " + (index + 1) + ".");
      }
    }
  }

  const masterRows = rows.filter(row => row.source === "KOPERASI");
  const lenderRows = rows.filter(row => row.source === "MANDIRI" || row.source === "BRI");
  const masterNames = new Set(masterRows.map(row => row.normalizedName));
  const lenderNames = new Set(lenderRows.map(row => row.normalizedName));

  if (masterRows.length === 0) {
    warnings.push("STOP: Sheet Pot. Koperasi tidak berisi baris anggota.");
  }
  if (masterNames.size !== masterRows.length) {
    warnings.push("STOP: Ada nama anggota ganda pada sheet Pot. Koperasi setelah normalisasi. Periksa agar data anggota tidak tergabung.");
  }
  if (masterNames.size !== lenderNames.size ||
      [...masterNames].some(name => !lenderNames.has(name)) ||
      [...lenderNames].some(name => !masterNames.has(name))) {
    warnings.push("STOP: Daftar nama pada Pot. Koperasi tidak sama dengan gabungan MANDIRI dan BRI. Periksa daftar anggota sebelum impor.");
  }

  const reconcileFields: Array<[keyof ImportedRow, string]> = [
    ["savingsPrincipal", "simpanan pokok"],
    ["savingsMandatory", "simpanan wajib"],
    ["savingsVoluntary", "simpanan sukarela"],
    ["principalPaid", "angsuran pokok"],
    ["interestPaid", "bunga"],
    ["installmentTotal", "jumlah angsuran"],
    ["totalDeduction", "total potongan"],
    ["outstandingPrincipal", "sisa pinjaman"],
    ["originalLoanAmount", "jumlah pinjaman"]
  ];
  for (const [field, label] of reconcileFields) {
    const masterTotal = masterRows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
    const lenderTotal = lenderRows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
    if (Math.abs(masterTotal - lenderTotal) > 1) {
      warnings.push(
        "STOP: Rekonsiliasi " + label + " berbeda antara Pot. Koperasi (" +
        Math.round(masterTotal).toLocaleString("id-ID") + ") dan MANDIRI + BRI (" +
        Math.round(lenderTotal).toLocaleString("id-ID") + ")."
      );
    }
  }

  if (!periodId) {
    warnings.push("Tanggal periode pada sel A2 tidak terbaca. Gunakan format tanggal Excel yang valid.");
    periodId = "2026-11";
  }
  if (rows.length === 0) warnings.push("Tidak ada baris anggota yang terbaca. Pastikan nomor di kolom A dan nama di kolom B terisi.");

  const date = new Date(periodId + "-01T00:00:00");
  const periodLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);
  return { periodId, periodLabel, rows, warnings };
}

export function stableId(prefix: string, value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "record";
  return prefix + "_" + safe + "_" + (hash >>> 0).toString(36);
}