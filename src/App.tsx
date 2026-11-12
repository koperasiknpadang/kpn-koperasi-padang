import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle, ArrowUpRight, Banknote, BarChart3, CalendarDays, CheckCircle2,
  FileSpreadsheet, Landmark, LayoutDashboard, Loader2, LockKeyhole, LogOut,
  RefreshCw, Search, ShieldCheck, UploadCloud, Users, Wallet
} from "lucide-react";
import {
  collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc,
  updateDoc, where, writeBatch
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth, db } from "./firebase";
import * as XLSX from "xlsx";
import { parseWorkbook, stableId, type ImportedRow, type WorkbookPreview } from "./workbook";

type TabName = "overview" | "members" | "loans" | "periods" | "import";
type AnyRecord = Record<string, any>;
type Summary = {
  periodId?: string;
  periodLabel?: string;
  memberCount?: number;
  savingsTotal?: number;
  principalPaid?: number;
  interestPaid?: number;
  totalDeduction?: number;
  outstandingTotal?: number;
  lenderBreakdown?: Array<{ source: string; outstanding: number }>;
  updatedAt?: any;
};

const money = (value: unknown) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(Number(value) || 0);

const number = (value: unknown) => new Intl.NumberFormat("id-ID").format(Number(value) || 0);

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={"surface rounded-2xl p-5 " + className}>{children}</section>;
}

function StatCard({ label, value, icon: Icon, note }: {
  label: string; value: string; icon: any; note?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
          {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
        </div>
        <span className="rounded-xl bg-sage-50 p-3 text-sage-700"><Icon size={20} /></span>
      </div>
    </Card>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-sage-200 bg-sage-50/60 px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-sage-600"><FileSpreadsheet size={20} /></div>
      <p className="font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function sourceLabel(source: string) {
  if (source === "KOPERASI") return "Koperasi";
  return source;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("koperasiknpadang@gmail.com");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<TabName>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [members, setMembers] = useState<AnyRecord[]>([]);
  const [loans, setLoans] = useState<AnyRecord[]>([]);
  const [periods, setPeriods] = useState<AnyRecord[]>([]);
  const [records, setRecords] = useState<AnyRecord[]>([]);
  const [dataBusy, setDataBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  async function loadPublicSummary() {
    try {
      const snap = await getDoc(doc(db, "public_summaries", "current"));
      setSummary(snap.exists() ? snap.data() as Summary : null);
    } catch {
      setSummary(null);
    }
  }

  async function refreshAdminData() {
    setDataBusy(true);
    try {
      const [memberSnap, periodSnap] = await Promise.all([
        getDocs(collection(db, "members")),
        getDocs(collection(db, "periods"))
      ]);
      const memberRows: AnyRecord[] = memberSnap.docs.map(item => ({ id: item.id, ...item.data() }));
      const periodRows: AnyRecord[] = periodSnap.docs.map(item => ({ id: item.id, ...item.data() }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))).reverse();
      setMembers(memberRows.sort((a, b) => String(a.name).localeCompare(String(b.name), "id")));
      setPeriods(periodRows);

      if (periodRows.length > 0) {
        const latestId = String(periodRows[0].id);
        const [recordSnap, loanSnap] = await Promise.all([
          getDocs(query(collection(db, "monthly_records"), where("periodId", "==", latestId))),
          getDocs(query(collection(db, "loan_snapshots"), where("periodId", "==", latestId)))
        ]);
        setRecords(recordSnap.docs.map(item => ({ id: item.id, ...item.data() })));
        const loanRows: AnyRecord[] = loanSnap.docs.map(item => ({ id: item.id, ...item.data() }));
        setLoans(loanRows.sort((a, b) => String(a.memberName).localeCompare(String(b.memberName), "id")));
      } else {
        setRecords([]);
        setLoans([]);
      }
    } catch (e: any) {
      setError(e?.message || "Gagal membaca data Firestore. Periksa Security Rules.");
    } finally {
      setDataBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setIsAdmin(false);
        setAuthLoading(false);
        return;
      }
      try {
        const adminSnap = await getDoc(doc(db, "admins", currentUser.uid));
        const adminData = adminSnap.exists() ? adminSnap.data() : null;
        const allowed = adminData?.active === true &&
          (adminData?.role === "super_admin" || adminData?.role === "admin");
        if (allowed) {
          setIsAdmin(true);
          setShowLogin(false);
          setError("");
        } else {
          setIsAdmin(false);
          setError("Akun berhasil masuk, tetapi UID ini belum terdaftar sebagai administrator aktif.");
          await signOut(auth);
        }
      } catch (e: any) {
        setIsAdmin(false);
        setError(e?.message || "Pemeriksaan hak akses administrator gagal.");
        await signOut(auth);
      } finally {
        setAuthLoading(false);
      }
    });
    void loadPublicSummary();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAdmin) void refreshAdminData();
  }, [isAdmin]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword("");
    } catch (e: any) {
      setError(e?.message || "Login gagal. Periksa email dan password.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setTab("overview");
    setMessage("");
  }

  async function handleWorkbook(file?: File) {
    if (!file) return;
    setError("");
    setMessage("");
    setFileName(file.name);
    try {
      const result = await parseWorkbook(file);
      setPreview(result);
    } catch (e: any) {
      setPreview(null);
      setError(e?.message || "File Excel tidak dapat dibaca.");
    }
  }

  async function saveImport() {
    if (!preview || !isAdmin || preview.rows.length === 0) return;
    if (preview.warnings.some(warning => warning.startsWith("STOP:"))) {
      setError("Impor dibatalkan karena rekonsiliasi workbook belum sesuai. Perbaiki file terlebih dahulu.");
      return;
    }
    setImportBusy(true);
    setError("");
    setMessage("");
    try {
      const periodRef = doc(db, "periods", preview.periodId);
      const existingPeriod = await getDoc(periodRef);
      if (existingPeriod.exists()) {
        throw new Error("Periode " + preview.periodId + " sudah ada. Impor dibatalkan agar data historis tidak tertimpa.");
      }

      const memberDocs = new Map<string, AnyRecord>();
      const loanDocs = new Map<string, AnyRecord>();
      const loanSnapshotDocs = new Map<string, AnyRecord>();
      const recordDocs = new Map<string, AnyRecord>();

      const masterRows = preview.rows.filter(row => row.source === "KOPERASI");
      const bankRows = preview.rows.filter(row => row.source === "MANDIRI" || row.source === "BRI");
      if (masterRows.length === 0) {
        throw new Error("Sheet Pot. Koperasi tidak menghasilkan data anggota. Periksa workbook sebelum impor.");
      }

      // Pot. Koperasi adalah sheet konsolidasi: simpan satu kali untuk potongan/simpanan bulanan.
      // Sheet MANDIRI dan BRI adalah rincian sumber pinjaman, bukan transaksi tambahan.
      masterRows.forEach((row: ImportedRow) => {
        const memberId = stableId("member", row.normalizedName);
        memberDocs.set(memberId, {
          name: row.memberName,
          normalizedName: row.normalizedName,
          active: true,
          origin: "workbook_import",
          updatedAt: serverTimestamp()
        });

        const recordId = stableId("record", preview.periodId + "_" + row.normalizedName);
        recordDocs.set(recordId, {
          periodId: preview.periodId,
          memberId,
          memberName: row.memberName,
          source: "KOPERASI",
          sourceSheet: "Pot. Koperasi",
          sourceRow: row.rowNumber,
          savingsPrincipal: row.savingsPrincipal,
          savingsMandatory: row.savingsMandatory,
          savingsVoluntary: row.savingsVoluntary,
          principalPaid: row.principalPaid,
          interestPaid: row.interestPaid,
          installmentTotal: row.installmentTotal,
          installmentNumber: row.installmentNumber,
          totalDeduction: row.totalDeduction,
          outstandingPrincipal: row.outstandingPrincipal,
          originalLoanAmount: row.originalLoanAmount,
          termMonths: row.termMonths,
          interestRate: row.interestRate,
          nextCounter: row.nextCounter,
          nextMonthInstallmentNumber: row.nextMonthInstallmentNumber,
          note: row.note,
          importedAt: serverTimestamp()
        });
      });

      bankRows.forEach((row: ImportedRow) => {
        const memberId = stableId("member", row.normalizedName);
        if (!memberDocs.has(memberId)) {
          throw new Error("Nama anggota " + row.memberName + " pada sheet " + row.source + " tidak ditemukan di sheet Pot. Koperasi.");
        }
        const hasLoan = row.originalLoanAmount > 0 || row.outstandingPrincipal > 0 ||
          row.principalPaid > 0 || row.interestPaid > 0;
        if (!hasLoan) return;

        const loanId = stableId("loan_" + row.source.toLowerCase(), row.normalizedName);
        const loanData = {
          memberId,
          memberName: row.memberName,
          source: row.source,
          originalPrincipal: row.originalLoanAmount,
          outstandingPrincipal: row.outstandingPrincipal,
          installmentPrincipal: row.principalPaid,
          monthlyInterest: row.interestPaid,
          installmentTotal: row.installmentTotal,
          installmentNumber: row.installmentNumber,
          termMonths: row.termMonths,
          interestRate: row.interestRate,
          note: row.note,
          lastPeriodId: preview.periodId,
          status: row.outstandingPrincipal > 0 ? "active" : "paid",
          updatedAt: serverTimestamp()
        };
        loanDocs.set(loanId, loanData);
        const snapshotId = stableId("loan_snapshot", preview.periodId + "_" + row.source + "_" + row.normalizedName);
        loanSnapshotDocs.set(snapshotId, {
          ...loanData,
          periodId: preview.periodId,
          loanId,
          importedAt: serverTimestamp()
        });
      });

      const batch = writeBatch(db);
      batch.set(periodRef, {
        periodId: preview.periodId,
        periodLabel: preview.periodLabel,
        status: "draft",
        importedRows: recordDocs.size,
        sourceRows: preview.rows.length,
        loanCount: loanDocs.size,
        memberCount: memberDocs.size,
        sourceSheets: ["Pot. Koperasi", "MANDIRI", "BRI"],
        createdAt: serverTimestamp(),
        createdBy: user?.uid || null
      });
      memberDocs.forEach((data, id) => batch.set(doc(db, "members", id), data, { merge: true }));
      loanDocs.forEach((data, id) => batch.set(doc(db, "loans", id), data, { merge: true }));
      loanSnapshotDocs.forEach((data, id) => batch.set(doc(db, "loan_snapshots", id), data));
      recordDocs.forEach((data, id) => batch.set(doc(db, "monthly_records", id), data));
      const auditRef = doc(collection(db, "audit_logs"));
      batch.set(auditRef, {
        action: "IMPORT_WORKBOOK",
        periodId: preview.periodId,
        importedRows: recordDocs.size,
        sourceRows: preview.rows.length,
        loanCount: loanDocs.size,
        actorUid: user?.uid || null,
        createdAt: serverTimestamp()
      });
      await batch.commit();

      setMessage("Impor periode " + preview.periodLabel + " berhasil disimpan sebagai draft. Periksa kembali angka sebelum dipublikasikan.");
      setPreview(null);
      setFileName("");
      await refreshAdminData();
      setTab("periods");
    } catch (e: any) {
      setError(e?.message || "Impor gagal disimpan.");
    } finally {
      setImportBusy(false);
    }
  }

  function exportCurrentData() {
    const workbook = XLSX.utils.book_new();
    const memberSheet = members.map((member, index) => ({
      "No.": index + 1, "ID Anggota": member.id, "Nama Anggota": member.name,
      "Status": member.active === false ? "Nonaktif" : "Aktif"
    }));
    const recordSheet = records.map((row, index) => ({
      "No.": index + 1, "Periode": row.periodId || latestPeriod?.id || "",
      "ID Anggota": row.memberId || "", "Nama Anggota": row.memberName || "",
      "Simpanan Pokok": Number(row.savingsPrincipal || 0),
      "Simpanan Wajib": Number(row.savingsMandatory || 0),
      "Simpanan Sukarela": Number(row.savingsVoluntary || 0),
      "Angsuran Pokok": Number(row.principalPaid || 0),
      "Bunga": Number(row.interestPaid || 0),
      "Total Angsuran": Number(row.installmentTotal || 0),
      "Total Potongan": Number(row.totalDeduction || 0),
      "Sisa Pinjaman": Number(row.outstandingPrincipal || 0)
    }));
    const loanSheet = loans.map((loan, index) => ({
      "No.": index + 1, "Periode": loan.lastPeriodId || latestPeriod?.id || "",
      "ID Anggota": loan.memberId || "", "Nama Anggota": loan.memberName || "",
      "Bank": loan.source || "", "Pokok Pinjaman": Number(loan.originalPrincipal || 0),
      "Angsuran Pokok": Number(loan.installmentPrincipal || 0),
      "Bunga": Number(loan.monthlyInterest || 0),
      "Sisa Pinjaman": Number(loan.outstandingPrincipal || 0), "Status": loan.status || ""
    }));
    const periodSheet = periods.map((period, index) => ({
      "No.": index + 1, "ID Periode": period.id, "Nama Periode": period.periodLabel || "",
      "Jumlah Baris Impor": Number(period.importedRows || 0),
      "Jumlah Anggota": Number(period.memberCount || 0), "Status": period.status || "draft"
    }));
    const addSheet = (rows: AnyRecord[], name: string) => {
      const sheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    addSheet(memberSheet, "Anggota");
    addSheet(recordSheet, "Rekap Keuangan");
    addSheet(loanSheet, "Pinjaman Bank");
    addSheet(periodSheet, "Daftar Periode");
    const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date()).replace(/-/g, "");
    XLSX.writeFile(workbook, "Laporan_KPN_" + (latestPeriod?.id || "semua-periode") + "_" + stamp + ".xlsx");
    setMessage("File Excel berhasil disiapkan. Data keuangan berisi periode terbaru yang sedang ditampilkan; daftar periode dan anggota disertakan.");
  }

  function exportPreview() {
    if (!preview) return;
    const workbook = XLSX.utils.book_new();
    const master = preview.rows.filter(row => row.source === "KOPERASI").map(row => ({
      "No. Baris Excel": row.rowNumber, "Nama Anggota": row.memberName,
      "Ke (Angsuran)": row.installmentNumber ?? "", "Simpanan Pokok": row.savingsPrincipal, "Simpanan Wajib": row.savingsMandatory,
      "Simpanan Sukarela": row.savingsVoluntary, "Angsuran Pokok": row.principalPaid,
      "Bunga": row.interestPaid, "Total Angsuran": row.installmentTotal,
      "Total Potongan": row.totalDeduction, "Sisa Pinjaman": row.outstandingPrincipal
    }));
    const bankRows = (source: "MANDIRI" | "BRI") => preview.rows.filter(row => row.source === source).map(row => ({
      "No. Baris Excel": row.rowNumber, "Nama Anggota": row.memberName,
      "Ke (Angsuran)": row.installmentNumber ?? "", "Pokok Pinjaman": row.originalLoanAmount, "Angsuran Pokok": row.principalPaid,
      "Bunga": row.interestPaid, "Total Angsuran": row.installmentTotal,
      "Sisa Pinjaman": row.outstandingPrincipal, "Tenor (Bulan)": row.termMonths,
      "Catatan": row.note
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(master), "Pot. Koperasi");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bankRows("MANDIRI")), "MANDIRI");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bankRows("BRI")), "BRI");
    XLSX.writeFile(workbook, "Pratinjau_Impor_KPN_" + preview.periodId + ".xlsx");
  }

  async function resetInitialData() {
    if (!isAdmin || resetBusy) return;
    const phrase = window.prompt("Reset hanya untuk menghapus data awal hasil impor yang masih dummy/tidak lengkap. Ketik RESET DATA AWAL untuk melanjutkan:");
    if (phrase !== "RESET DATA AWAL") return;
    setResetBusy(true);
    setError("");
    setMessage("");
    try {
      const periodSnap = await getDocs(collection(db, "periods"));
      const published = periodSnap.docs.filter(item => item.data().status === "published");
      if (published.length) {
        throw new Error("Reset dibatalkan. Terdapat periode yang sudah dipublikasikan. Data terverifikasi tidak boleh dihapus melalui fitur reset awal.");
      }
      const collectionsToClear = ["monthly_records", "loan_snapshots", "loans", "members", "periods"];
      let deletedCount = 0;
      for (const collectionName of collectionsToClear) {
        const snapshot = await getDocs(collection(db, collectionName));
        for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
          const chunk = snapshot.docs.slice(offset, offset + 400);
          const batch = writeBatch(db);
          chunk.forEach(item => batch.delete(item.ref));
          await batch.commit();
          deletedCount += chunk.length;
        }
      }
      await setDoc(doc(db, "public_summaries", "current"), {
        periodId: null, periodLabel: "Belum ada data awal", memberCount: 0,
        savingsTotal: 0, principalPaid: 0, interestPaid: 0, totalDeduction: 0,
        outstandingTotal: 0, lenderBreakdown: [], resetAt: serverTimestamp()
      });
      await setDoc(doc(collection(db, "audit_logs")), {
        action: "RESET_INITIAL_IMPORT_DATA", deletedDocuments: deletedCount,
        actorUid: user?.uid || null, createdAt: serverTimestamp()
      });
      setPreview(null);
      setFileName("");
      setRecords([]);
      setLoans([]);
      setMembers([]);
      setPeriods([]);
      setMessage("Data awal hasil impor berhasil direset. Akun administrator dan pengaturan sistem tetap dipertahankan. Silakan unggah workbook yang sudah benar.");
      setTab("import");
      await refreshAdminData();
      await loadPublicSummary();
    } catch (e: any) {
      setError(e?.message || "Reset data awal gagal. Periksa kembali hak akses dan aturan keamanan.");
    } finally {
      setResetBusy(false);
    }
  }

  async function publishSummary() {
    const latestPeriod = periods[0];
    if (!latestPeriod || records.length === 0) return;
    const approved = window.confirm(
      "Pastikan angka periode " + latestPeriod.periodLabel + " sudah diperiksa. Hanya ringkasan agregat yang akan ditampilkan kepada publik. Lanjutkan?"
    );
    if (!approved) return;

    const bySource: Record<string, number> = {};
    let savingsTotal = 0;
    let principalPaid = 0;
    let interestPaid = 0;
    let totalDeduction = 0;
    let outstandingTotal = 0;
    const memberIds = new Set<string>();

    // Monthly records hanya berasal dari sheet konsolidasi Pot. Koperasi.
    records.forEach((record) => {
      if (record.memberId) memberIds.add(String(record.memberId));
      savingsTotal += Number(record.savingsPrincipal || 0) + Number(record.savingsMandatory || 0) + Number(record.savingsVoluntary || 0);
      principalPaid += Number(record.principalPaid || 0);
      interestPaid += Number(record.interestPaid || 0);
      totalDeduction += Number(record.totalDeduction || 0);
    });

    // Saldo pinjaman dirinci dari dua sheet sumber bank agar tidak dihitung ganda.
    loans.forEach((loan) => {
      const outstanding = Number(loan.outstandingPrincipal || 0);
      outstandingTotal += outstanding;
      const source = String(loan.source || "LAINNYA");
      bySource[source] = (bySource[source] || 0) + outstanding;
    });

    try {
      const publishBatch = writeBatch(db);
      publishBatch.set(doc(db, "public_summaries", "current"), {
        periodId: latestPeriod.id,
        periodLabel: latestPeriod.periodLabel,
        memberCount: memberIds.size,
        savingsTotal,
        principalPaid,
        interestPaid,
        totalDeduction,
        outstandingTotal,
        lenderBreakdown: Object.entries(bySource).map(([source, outstanding]) => ({ source, outstanding })),
        updatedAt: serverTimestamp()
      });
      publishBatch.update(doc(db, "periods", latestPeriod.id), {
        status: "published",
        publishedAt: serverTimestamp(),
        publishedBy: user?.uid || null
      });
      await publishBatch.commit();
      await loadPublicSummary();
      await refreshAdminData();
      setMessage("Ringkasan agregat periode " + latestPeriod.periodLabel + " berhasil dipublikasikan.");
    } catch (e: any) {
      setError(e?.message || "Ringkasan gagal dipublikasikan.");
    }
  }

  const latestPeriod = periods.length > 0 ? periods[0] : null;
  const totals = useMemo(() => {
    return records.reduce((acc, row) => {
      acc.savings += Number(row.savingsPrincipal || 0) + Number(row.savingsMandatory || 0) + Number(row.savingsVoluntary || 0);
      acc.principal += Number(row.principalPaid || 0);
      acc.interest += Number(row.interestPaid || 0);
      acc.deduction += Number(row.totalDeduction || 0);
      acc.outstanding += Number(row.outstandingPrincipal || 0);
      return acc;
    }, { savings: 0, principal: 0, interest: 0, deduction: 0, outstanding: 0 });
  }, [records]);

  const chartData = useMemo(() => {
    const grouped: Record<string, number> = {};
    loans.forEach(loan => {
      const source = String(loan.source || "LAINNYA");
      grouped[source] = (grouped[source] || 0) + Number(loan.outstandingPrincipal || 0);
    });
    return Object.entries(grouped).map(([source, outstanding]) => ({ source: sourceLabel(source), outstanding }));
  }, [loans]);

  const filteredMembers = members.filter(member =>
    String(member.name || "").toLowerCase().includes(search.toLowerCase())
  );
  const filteredLoans = loans.filter(loan =>
    (String(loan.memberName || "") + " " + String(loan.source || "")).toLowerCase().includes(search.toLowerCase())
  );

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-mist text-sage-700"><Loader2 className="animate-spin" /> <span className="ml-3 text-sm">Memeriksa sesi...</span></div>;
  }

  const tabs: Array<{ id: TabName; label: string; icon: any }> = [
    { id: "overview", label: "Ringkasan", icon: LayoutDashboard },
    { id: "members", label: "Anggota", icon: Users },
    { id: "loans", label: "Pinjaman", icon: Wallet },
    { id: "periods", label: "Periode", icon: CalendarDays },
    { id: "import", label: "Impor Excel", icon: FileSpreadsheet }
  ];

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="sticky top-0 z-30 border-b border-sage-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sage-700 text-white"><Landmark size={21} /></div>
            <div>
              <p className="text-sm font-bold tracking-tight">KPN Koperasi</p>
              <p className="text-[11px] text-slate-500">Kejaksaan Negeri Padang</p>
            </div>
          </div>
          <div className="flex shrink-0 rounded-xl border border-sage-100 bg-white px-2 py-1.5 text-right leading-tight sm:px-3 sm:py-2"><p className="hidden text-[10px] text-slate-400 sm:block">Waktu Padang (WIB)</p><p className="text-[11px] font-semibold tabular-nums text-sage-800 sm:text-xs">{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(currentTime)}</p><p className="hidden text-[10px] text-slate-500 sm:block">{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(currentTime)}</p></div>
          {isAdmin ? (
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full bg-sage-50 px-3 py-1.5 text-xs font-medium text-sage-700 sm:inline-flex"><ShieldCheck size={14} className="mr-1.5" /> Super Admin</span>
              <button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"><LogOut size={15} /> Keluar</button>
            </div>
          ) : (
            <button onClick={() => { setError(""); setShowLogin(true); }} className="inline-flex items-center gap-2 rounded-xl bg-sage-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sage-600"><LockKeyhole size={15} /> Masuk Pengelola</button>
          )}
        </div>
      </header>

      {isAdmin ? (
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_1fr] lg:py-8">
          <aside className="h-fit rounded-2xl border border-sage-100 bg-white p-3 shadow-soft">
            <p className="px-3 pb-3 pt-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Menu pengelola</p>
            <nav className="grid grid-cols-2 gap-1 lg:grid-cols-1">
              {tabs.map(item => {
                const Icon = item.icon;
                return <button key={item.id} onClick={() => { setTab(item.id); setSearch(""); }} className={"flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition " + (tab === item.id ? "bg-sage-700 text-white" : "text-slate-600 hover:bg-sage-50 hover:text-sage-800")}>
                  <Icon size={17} /> {item.label}
                </button>;
              })}
            </nav>
            <div className="mt-5 rounded-xl bg-sage-50 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-sage-800"><ShieldCheck size={15} /> Akses terbatas</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Data anggota dan transaksi hanya ditampilkan kepada administrator aktif.</p>
            </div>
          </aside>

          <main className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-sage-600">Panel administrasi</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{tabs.find(item => item.id === tab)?.label}</h1>
                <p className="mt-1 text-sm text-slate-500">Kelola data koperasi dan laporan bulanan.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={exportCurrentData} className="inline-flex items-center gap-2 rounded-xl border border-sage-200 bg-white px-3 py-2 text-sm font-medium text-sage-800 hover:bg-sage-50"><FileSpreadsheet size={15} /> Ekspor Excel</button>
                <button onClick={() => void refreshAdminData()} className="inline-flex items-center gap-2 rounded-xl border border-sage-200 bg-white px-3 py-2 text-sm font-medium text-sage-800 hover:bg-sage-50"><RefreshCw size={15} className={dataBusy ? "animate-spin" : ""} /> Segarkan</button>
              </div>
            </div>

            {error ? <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div> : null}
            {message ? <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{message}</div> : null}

            {tab === "overview" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Anggota terdaftar" value={number(members.length)} icon={Users} note="Nama anggota unik" />
                  <StatCard label="Simpanan periode terakhir" value={money(totals.savings)} icon={Wallet} note={latestPeriod?.periodLabel || "Belum ada periode"} />
                  <StatCard label="Sisa pinjaman" value={money(totals.outstanding)} icon={Landmark} note="Berdasarkan impor terakhir" />
                  <StatCard label="Total potongan" value={money(totals.deduction)} icon={Banknote} note="Periode terakhir" />
                </div>
                <div className="grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <div><h2 className="font-semibold">Posisi pinjaman per sumber</h2><p className="mt-1 text-xs text-slate-500">{latestPeriod?.periodLabel || "Belum ada data periode"}</p></div>
                      <BarChart3 className="text-sage-600" size={20} />
                    </div>
                    {chartData.length ? <div className="mt-5 h-64">
                      <BarChart width={620} height={250} data={chartData} margin={{ top: 10, right: 15, left: 15, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="source" tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={(value: number) => new Intl.NumberFormat("id-ID", { notation: "compact" }).format(value)} tickLine={false} axisLine={false} width={55} />
                        <Tooltip formatter={(value: any) => money(value)} />
                        <Bar dataKey="outstanding" fill="#718b70" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </div> : <EmptyState title="Belum ada data pinjaman" detail="Impor workbook periode pertama untuk menampilkan grafik posisi pinjaman." />}
                  </Card>
                  <Card>
                    <h2 className="font-semibold">Aktivitas periode</h2>
                    <p className="mt-1 text-xs text-slate-500">Ringkasan dari data impor terbaru.</p>
                    <div className="mt-5 space-y-4">
                      <div className="flex items-center justify-between"><span className="text-sm text-slate-500">Pokok angsuran</span><strong className="text-sm">{money(totals.principal)}</strong></div>
                      <div className="flex items-center justify-between"><span className="text-sm text-slate-500">Bunga angsuran</span><strong className="text-sm">{money(totals.interest)}</strong></div>
                      <div className="flex items-center justify-between"><span className="text-sm text-slate-500">Total potongan</span><strong className="text-sm">{money(totals.deduction)}</strong></div>
                      <div className="rounded-xl bg-sage-50 p-4"><p className="text-xs font-medium text-sage-700">Periode aktif</p><p className="mt-1 text-lg font-semibold text-sage-900">{latestPeriod?.periodLabel || "Belum tersedia"}</p><p className="mt-1 text-xs text-slate-500">Status: {latestPeriod?.status || "Belum diimpor"}</p></div>
                    </div>
                  </Card>
                </div>
              </>
            ) : null}

            {tab === "members" ? (
              <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div><h2 className="font-semibold">Daftar anggota</h2><p className="text-xs text-slate-500">{number(members.length)} anggota terdaftar</p></div>
                  <div className="relative w-full sm:w-64"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama anggota..." className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sage-500" /></div>
                </div>
                {filteredMembers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Nama anggota</th><th className="py-3">Status</th></tr></thead><tbody>{filteredMembers.map(member => <tr key={member.id} className="border-b border-slate-50"><td className="py-3 font-medium">{member.name}</td><td className="py-3"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{member.active === false ? "Nonaktif" : "Aktif"}</span></td></tr>)}</tbody></table></div> : <EmptyState title="Belum ada anggota" detail="Data anggota akan terbentuk saat workbook bulanan diimpor." />}
              </Card>
            ) : null}

            {tab === "loans" ? (
              <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Data pinjaman</h2><p className="text-xs text-slate-500">{number(loans.length)} catatan pinjaman</p></div><div className="relative w-full sm:w-64"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari anggota atau sumber..." className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sage-500" /></div></div>
                {filteredLoans.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Anggota</th><th className="py-3">Sumber</th><th className="py-3 text-right">Pokok pinjaman</th><th className="py-3 text-right">Sisa pinjaman</th><th className="py-3">Status</th></tr></thead><tbody>{filteredLoans.map(loan => <tr key={loan.id} className="border-b border-slate-50"><td className="py-3 font-medium">{loan.memberName}</td><td className="py-3">{sourceLabel(loan.source)}</td><td className="py-3 text-right tabular-nums">{money(loan.originalPrincipal)}</td><td className="py-3 text-right tabular-nums">{money(loan.outstandingPrincipal)}</td><td className="py-3"><span className="rounded-full bg-sage-50 px-2.5 py-1 text-xs text-sage-700">{loan.status || "—"}</span></td></tr>)}</tbody></table></div> : <EmptyState title="Belum ada data pinjaman" detail="Data pinjaman akan muncul setelah proses impor Excel." />}
              </Card>
            ) : null}

            {tab === "periods" ? (
              <div className="space-y-4">
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h2 className="font-semibold">Periode laporan</h2><p className="text-xs text-slate-500">Setiap periode disimpan terpisah; impor periode yang sudah ada akan ditolak.</p></div>
                    {latestPeriod && records.length > 0 ? <button onClick={() => void publishSummary()} className="rounded-xl bg-sage-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sage-600">Publikasikan ringkasan</button> : null}
                  </div>
                </Card>
                <Card>
                  {periods.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Periode</th><th className="py-3">Baris impor</th><th className="py-3">Anggota</th><th className="py-3">Status</th></tr></thead><tbody>{periods.map(period => <tr key={period.id} className="border-b border-slate-50"><td className="py-3 font-medium">{period.periodLabel || period.id}</td><td className="py-3">{number(period.importedRows)}</td><td className="py-3">{number(period.memberCount)}</td><td className="py-3"><span className="rounded-full bg-sage-50 px-2.5 py-1 text-xs text-sage-700">{period.status || "draft"}</span></td></tr>)}</tbody></table></div> : <EmptyState title="Belum ada periode" detail="Gunakan menu Impor Excel untuk membuat periode berdasarkan tanggal pada workbook." />}
                </Card>
              </div>
            ) : null}

            {tab === "import" ? (
              <div className="space-y-4">
                <Card>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div><h2 className="font-semibold">Data awal koperasi</h2><p className="mt-1 text-xs text-slate-500">Reset hanya untuk tahap persiapan sebelum ada periode yang dipublikasikan.</p></div>
                    <button onClick={() => void resetInitialData()} disabled={resetBusy || importBusy} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><RefreshCw size={14} className={resetBusy ? "animate-spin" : ""} /> {resetBusy ? "Mereset..." : "Reset data awal"}</button>
                  </div>
                  <div className="flex items-start gap-3"><div className="rounded-xl bg-sage-50 p-3 text-sage-700"><UploadCloud size={22} /></div><div><h2 className="font-semibold">Impor workbook bulanan</h2><p className="mt-1 text-sm text-slate-500">Pilih file Excel dengan sheet Pot. Koperasi, MANDIRI, dan BRI. Data akan diperiksa terlebih dahulu sebelum disimpan.</p></div></div>
                  <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-sage-200 bg-sage-50/50 px-5 py-9 text-center hover:bg-sage-50">
                    <FileSpreadsheet size={28} className="text-sage-600" />
                    <span className="mt-3 text-sm font-semibold text-sage-800">Pilih file Excel (.xlsx)</span>
                    <span className="mt-1 text-xs text-slate-500">{fileName || "Belum ada file dipilih"}</span>
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => void handleWorkbook(e.target.files?.[0])} />
                  </label>
                  <p className="mt-3 text-xs leading-relaxed text-slate-500">Sebelum mengunggah, buka file di Excel, tekan Ctrl+Alt+F9 untuk menghitung ulang formula, lalu simpan. Jangan mengunggah workbook ini ke GitHub.</p>
                </Card>
                {preview ? <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Pratinjau impor</h2><p className="mt-1 text-sm text-slate-500">{preview.periodLabel} · {number(preview.rows.length)} baris data terbaca</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Status: draft</span></div>
                  {preview.warnings.length ? <div className="mt-4 space-y-2">{preview.warnings.slice(0, 8).map((warning, index) => <p key={index} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertCircle size={14} className="shrink-0" />{warning}</p>)}</div> : <p className="mt-4 flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 size={15} /> Struktur tiga sheet berhasil dibaca.</p>}
                  <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead><tr className="border-b border-slate-100 text-slate-400"><th className="py-2">Nama anggota</th><th className="py-2">Sumber</th><th className="py-2 text-center">Ke</th><th className="py-2 text-right">Simpanan wajib</th><th className="py-2 text-right">Angsuran pokok</th><th className="py-2 text-right">Bunga</th><th className="py-2 text-right">Sisa pinjaman</th></tr></thead><tbody>{preview.rows.slice(0, 8).map((row, index) => <tr key={index} className="border-b border-slate-50"><td className="py-2 font-medium">{row.memberName}</td><td className="py-2">{sourceLabel(row.source)}</td><td className="py-2 text-center">{row.installmentNumber ?? "—"}</td><td className="py-2 text-right">{money(row.savingsMandatory)}</td><td className="py-2 text-right">{money(row.principalPaid)}</td><td className="py-2 text-right">{money(row.interestPaid)}</td><td className="py-2 text-right">{money(row.outstandingPrincipal)}</td></tr>)}</tbody></table></div>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-xs text-slate-500">Simpan sebagai draft terlebih dahulu. Pastikan tidak ada periode dengan ID yang sama.</p><div className="flex flex-wrap gap-2"><button onClick={exportPreview} className="inline-flex items-center gap-2 rounded-xl border border-sage-200 px-4 py-2.5 text-sm font-semibold text-sage-800 hover:bg-sage-50"><FileSpreadsheet size={15} /> Ekspor pratinjau</button><button disabled={importBusy || preview.rows.length === 0 || preview.warnings.some(warning => warning.startsWith("STOP:"))} onClick={() => void saveImport()} className="inline-flex items-center gap-2 rounded-xl bg-sage-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sage-600 disabled:cursor-not-allowed disabled:opacity-50">{importBusy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Simpan sebagai draft</button></div></div>
                </Card> : null}
              </div>
            ) : null}
          </main>
        </div>
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
          <section className="soft-grid relative overflow-hidden rounded-[2rem] border border-sage-100 bg-white px-6 py-10 shadow-soft sm:px-10 lg:px-14 lg:py-14">
            <div className="relative z-10 max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-sage-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-sage-700"><ShieldCheck size={14} /> Sistem Informasi Koperasi</span>
              <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">Koperasi Pegawai Negeri<br /><span className="text-sage-700">Kejaksaan Negeri Padang</span></h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">Portal informasi dan ringkasan pengelolaan koperasi. Data pribadi anggota dan transaksi keuangan hanya dapat diakses oleh pengelola yang berwenang.</p>
            </div>
            <div className="pointer-events-none absolute -right-16 -top-20 h-80 w-80 rounded-full border-[48px] border-sage-50/90" />
            <div className="pointer-events-none absolute -bottom-24 right-20 h-64 w-64 rounded-full bg-sage-50/70" />
          </section>

          <section className="mt-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-sage-600">Informasi publik</p><h2 className="mt-1 text-xl font-semibold">Ringkasan koperasi</h2></div><span className="text-xs text-slate-400">{summary?.periodLabel ? "Periode " + summary.periodLabel : "Belum ada periode dipublikasikan"}</span></div>
            {summary ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Anggota terdata" value={number(summary.memberCount)} icon={Users} />
              <StatCard label="Total simpanan periode" value={money(summary.savingsTotal)} icon={Wallet} />
              <StatCard label="Pokok angsuran" value={money(summary.principalPaid)} icon={Banknote} />
              <StatCard label="Sisa pinjaman" value={money(summary.outstandingTotal)} icon={Landmark} />
            </div> : <EmptyState title="Ringkasan belum dipublikasikan" detail="Informasi agregat akan ditampilkan setelah pengelola memeriksa dan memublikasikan laporan periode. Tidak ada data pribadi anggota yang ditampilkan di halaman publik." />}
          </section>

          <section className="mt-8 grid gap-4 md:grid-cols-2">
            <Card><div className="flex items-center gap-3"><div className="rounded-xl bg-sage-50 p-3 text-sage-700"><ShieldCheck size={20} /></div><div><h3 className="font-semibold">Privasi anggota</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Nama, simpanan individual, pinjaman, dan potongan gaji tidak ditampilkan untuk umum.</p></div></div></Card>
            <Card><div className="flex items-center gap-3"><div className="rounded-xl bg-sage-50 p-3 text-sage-700"><BarChart3 size={20} /></div><div><h3 className="font-semibold">Laporan terverifikasi</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Dashboard publik hanya memuat ringkasan yang telah dipublikasikan oleh administrator.</p></div></div></Card>
          </section>
          <footer className="mt-12 border-t border-sage-100 py-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} KPN Koperasi Kejaksaan Negeri Padang</footer>
        </main>
      )}

      {showLogin && !isAdmin ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-6 flex items-start justify-between"><div><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-sage-700 text-white"><LockKeyhole size={20} /></div><h2 className="text-xl font-semibold">Login pengelola</h2><p className="mt-1 text-sm text-slate-500">Masuk menggunakan akun Firebase Authentication.</p></div><button onClick={() => setShowLogin(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">✕</button></div>
          {error ? <div className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Email administrator</span><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Password</span><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100" /></label>
            <button disabled={loginBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sage-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sage-600 disabled:opacity-60">{loginBusy ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />} Masuk</button>
          </form>
          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">Hak akses diperiksa berdasarkan UID pada dokumen Firestore admins. Password tidak disimpan oleh aplikasi.</p>
        </div>
      </div> : null}
    </div>
  );
}

// Import chart components separately to keep the main dashboard readable.
import { BarChart, Bar, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
