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
  let year: number | null = null;
  let month: number | null = null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getUTCFullYear();
    month = value.getUTCMonth() + 1;
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
    const sheetPeriod = periodFromCell(matrix[1]?.[0]);
    if (!sheetPeriod) {
      warnings.push("STOP: Tanggal periode pada sel A2 sheet " + sheetName + " tidak terbaca.");
    } else if (!periodId) {
      periodId = sheetPeriod;
    } else if (periodId !== sheetPeriod) {
      warnings.push("STOP: Periode pada sel A2 sheet " + sheetName + " berbeda dari sheet Pot. Koperasi.");
    }

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
  const unknownLenderNames = [...lenderNames].filter(name => !masterNames.has(name));
  if (unknownLenderNames.length) {
    warnings.push("STOP: Ada nama pada sheet MANDIRI/BRI yang tidak ditemukan di sheet Pot. Koperasi. Cocokkan nama anggota sebelum impor.");
  }

  // Hanya komponen pinjaman yang direkonsiliasi terhadap gabungan dua bank.
  // Simpanan dan total potongan tetap bersumber dari sheet utama Pot. Koperasi.
  const reconcileFields: Array<[keyof ImportedRow, string]> = [
    ["principalPaid", "angsuran pokok"],
    ["interestPaid", "bunga pinjaman"],
    ["installmentTotal", "jumlah angsuran pinjaman"],
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
    warnings.push("STOP: Periode tidak dapat ditentukan. Perbaiki tanggal pada sel A2 di ketiga sheet.");
  }
  if (rows.length === 0) warnings.push("Tidak ada baris anggota yang terbaca. Pastikan nomor di kolom A dan nama di kolom B terisi.");

  const periodLabel = periodId
    ? new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(periodId + "-01T00:00:00Z"))
    : "Periode tidak terbaca";
  return { periodId: periodId || "", periodLabel, rows, warnings };
}

export function stableId(prefix: string, value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "record";
  return prefix + "_" + safe + "_" + (hash >>> 0).toString(36);
}