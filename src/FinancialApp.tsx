import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, type User
} from "firebase/auth";
import {
  collection, doc, getDoc, getDocs, runTransaction, serverTimestamp,
  writeBatch, updateDoc
} from "firebase/firestore";
import {
  Activity, AlertCircle, ArrowDownCircle, ArrowUpCircle, Banknote,
  BarChart3, BookOpen, CalendarDays, CheckCircle2, ChevronRight,
  CircleDollarSign, ClipboardList, Download, FileSpreadsheet, KeyRound,
  Landmark, LayoutDashboard, Loader2, LockKeyhole, LogOut, Plus,
  Printer, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp,
  Users, Wallet, X
} from "lucide-react";
import * as XLSX from "xlsx";
import { auth, db } from "./firebase";

type Row = Record<string, any>;
type Tab = "dashboard" | "members" | "savings" | "loans" | "installments" | "cash" | "reports" | "periods";
type SavingType = "principal" | "mandatory" | "voluntary";
type Direction = "deposit" | "withdrawal";

const money = (value: unknown) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(Number(value) || 0);
const fmtNumber = (value: unknown) => new Intl.NumberFormat("id-ID").format(Number(value) || 0);
const todayWib = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  return part("year") + "-" + part("month") + "-" + part("day");
};
const periodOf = (date: string) => date.slice(0, 7);
const periodLabel = (id: string) => {
  if (!/^\d{4}-\d{2}$/.test(id)) return id;
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(id + "-01T00:00:00Z"));
};
const dateLabel = (value: string) => {
  if (!value) return "—";
  const date = new Date(value + "T00:00:00+07:00");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta"
  }).format(date);
};
const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const buttonPrimary = "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
const buttonSecondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
const zeroBalances = { principal: 0, mandatory: 0, voluntary: 0 };

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={"surface rounded-2xl p-5 " + className}>{children}</section>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 px-5 py-10 text-center">
    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-emerald-700"><FileSpreadsheet size={19} /></div>
    <p className="font-semibold text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-500">{detail}</p>
  </div>;
}
function Stat({ label, value, note, icon: Icon, tone = "green" }: {
  label: string; value: string; note?: string; icon: any; tone?: "green" | "blue" | "amber" | "rose";
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-800",
    blue: "bg-sky-50 text-sky-800",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-800"
  };
  return <Card><div className="flex items-start justify-between gap-3">
    <div className="min-w-0"><p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{value}</p>
      {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
    </div><span className={"rounded-xl p-3 " + tones[tone]}><Icon size={20} /></span>
  </div></Card>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}{children}</label>;
}
function Status({ value }: { value: string }) {
  const positive = ["active", "open", "approved", "disbursed", "paid", "closed"].includes(value);
  const negative = ["inactive", "rejected", "overdue"].includes(value);
  const label: Record<string, string> = {
    active: "Aktif", inactive: "Nonaktif", open: "Terbuka", closed: "Ditutup",
    pending: "Menunggu", approved: "Disetujui", disbursed: "Dicairkan",
    rejected: "Ditolak", paid: "Lunas", overdue: "Menunggak"
  };
  return <span className={"inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold " +
    (positive ? "bg-emerald-50 text-emerald-700" : negative ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>
    {label[value] || value || "—"}
  </span>;
}
function auditData(action: string, entity: string, entityId: string, user: User | null) {
  return { action, entity, entityId, actorUid: user?.uid || null, createdAt: serverTimestamp() };
}
function journalData(periodId: string, date: string, memo: string, lines: Row[], user: User | null) {
  const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  return { periodId, date, memo, lines, totalDebit, totalCredit, createdAt: serverTimestamp(), createdBy: user?.uid || null };
}
function journalLine(accountCode: string, accountName: string, debit: number, credit: number) {
  return { accountCode, accountName, debit, credit };
}
function newPeriodData(id: string, user: User | null) {
  return {
    periodId: id, periodLabel: periodLabel(id), status: "open",
    createdAt: serverTimestamp(), createdBy: user?.uid || null
  };
}
function memberIdFromNumber(value: string) {
  return "anggota_" + value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function FinancialApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("koperasiknpadang@gmail.com");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [publicSummary, setPublicSummary] = useState<Row | null>(null);

  const [members, setMembers] = useState<Row[]>([]);
  const [savingsTransactions, setSavingsTransactions] = useState<Row[]>([]);
  const [applications, setApplications] = useState<Row[]>([]);
  const [loans, setLoans] = useState<Row[]>([]);
  const [installments, setInstallments] = useState<Row[]>([]);
  const [cashTransactions, setCashTransactions] = useState<Row[]>([]);
  const [journals, setJournals] = useState<Row[]>([]);
  const [periods, setPeriods] = useState<Row[]>([]);

  const [editingMemberId, setEditingMemberId] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberForm, setMemberForm] = useState({ memberNo: "", name: "", phone: "", joinDate: todayWib() });
  const [savingForm, setSavingForm] = useState({
    memberId: "", type: "mandatory" as SavingType, direction: "deposit" as Direction,
    amount: "", date: todayWib(), note: ""
  });
  const [applicationForm, setApplicationForm] = useState({
    memberId: "", amount: "", termMonths: "12", source: "KOPERASI",
    interestRate: "1", date: todayWib(), note: ""
  });
  const [installmentForm, setInstallmentForm] = useState({
    loanId: "", kind: "regular", date: todayWib(), payoffInterest: "0", note: ""
  });
  const [cashForm, setCashForm] = useState({
    type: "expense", category: "Operasional", amount: "", date: todayWib(), note: ""
  });
  const [reportPeriod, setReportPeriod] = useState("all");

  async function loadPublicSummary() {
    try {
      const snap = await getDoc(doc(db, "public_summaries", "current"));
      setPublicSummary(snap.exists() ? snap.data() : null);
    } catch { setPublicSummary(null); }
  }

  async function refreshAll() {
    if (!isAdmin) return;
    setBusy("refresh");
    setError("");
    try {
      const names = [
        "members", "savings_transactions", "loan_applications", "loans",
        "installments", "cash_transactions", "journal_entries", "periods"
      ];
      const snaps = await Promise.all(names.map(name => getDocs(collection(db, name))));
      const rows: Row[][] = snaps.map(snap => snap.docs.map(item => ({ id: item.id, ...item.data() } as Row)));
      setMembers(rows[0].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id")));
      setSavingsTransactions(rows[1].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))));
      setApplications(rows[2].sort((a, b) => String(b.createdAt?.seconds || 0).localeCompare(String(a.createdAt?.seconds || 0))));
      setLoans(rows[3].sort((a, b) => String(b.createdAt?.seconds || 0).localeCompare(String(a.createdAt?.seconds || 0))));
      setInstallments(rows[4].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))));
      setCashTransactions(rows[5].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))));
      setJournals(rows[6].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))));
      setPeriods(rows[7].sort((a, b) => String(b.id).localeCompare(String(a.id))));
    } catch (e: any) {
      setError(e?.message || "Gagal memuat data. Periksa koneksi dan Firestore Security Rules.");
    } finally { setBusy(""); }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      setUser(currentUser);
      if (!currentUser) {
        setIsAdmin(false);
        setAuthLoading(false);
        return;
      }
      try {
        const adminSnap = await getDoc(doc(db, "admins", currentUser.uid));
        const data = adminSnap.exists() ? adminSnap.data() : null;
        const allowed = data?.active === true && ["super_admin", "admin"].includes(data?.role);
        if (allowed) {
          setIsAdmin(true);
          setShowLogin(false);
          setError("");
        } else {
          setIsAdmin(false);
          setError("Akun berhasil masuk, tetapi belum terdaftar sebagai administrator aktif.");
          await signOut(auth);
        }
      } catch (e: any) {
        setIsAdmin(false);
        setError(e?.message || "Pemeriksaan hak akses administrator gagal.");
        await signOut(auth);
      } finally { setAuthLoading(false); }
    });
    void loadPublicSummary();
    return () => unsubscribe();
  }, []);

  useEffect(() => { if (isAdmin) void refreshAll(); }, [isAdmin]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoginBusy(true); setError("");
    try { await signInWithEmailAndPassword(auth, email.trim(), password); setPassword(""); }
    catch (e: any) { setError(e?.message || "Login gagal. Periksa email dan password."); }
    finally { setLoginBusy(false); }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.email) return setError("Sesi administrator tidak ditemukan.");
    if (newPassword.length < 8) return setError("Password baru minimal 8 karakter.");
    if (newPassword !== confirmPassword) return setError("Konfirmasi password baru tidak sama.");
    setPasswordBusy(true); setError(""); setMessage("");
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
      await updatePassword(user, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setShowPassword(false);
      setMessage("Password administrator berhasil diperbarui.");
    } catch (e: any) {
      const code = e?.code || "";
      setError(code === "auth/wrong-password" || code === "auth/invalid-credential" ? "Password saat ini tidak sesuai."
        : code === "auth/weak-password" ? "Password baru terlalu lemah."
        : code === "auth/requires-recent-login" ? "Sesi terlalu lama. Keluar dan masuk kembali sebelum mengganti password."
        : e?.message || "Password gagal diperbarui.");
    } finally { setPasswordBusy(false); }
  }

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const memberNo = memberForm.memberNo.trim();
    const name = memberForm.name.trim();
    if (!memberNo || !name) return setError("Nomor anggota dan nama wajib diisi.");
    const id = editingMemberId || memberIdFromNumber(memberNo);
    if (!id || id === "anggota_") return setError("Nomor anggota tidak valid.");
    setBusy("member"); setError(""); setMessage("");
    try {
      const ref = doc(db, "members", id);
      const auditRef = doc(collection(db, "audit_logs"));
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(ref);
        if (!editingMemberId && existing.exists()) throw new Error("Nomor anggota sudah digunakan.");
        if (editingMemberId && !existing.exists()) throw new Error("Data anggota tidak ditemukan.");
        const old = existing.exists() ? existing.data() : {};
        transaction.set(ref, {
          memberNo, name, phone: memberForm.phone.trim(), joinDate: memberForm.joinDate,
          active: old.active !== false, savingsBalances: old.savingsBalances || zeroBalances,
          createdAt: old.createdAt || serverTimestamp(), updatedAt: serverTimestamp()
        }, { merge: true });
        transaction.set(auditRef, auditData(editingMemberId ? "UPDATE_MEMBER" : "CREATE_MEMBER", "members", id, user));
      });
      setMemberForm({ memberNo: "", name: "", phone: "", joinDate: todayWib() });
      setEditingMemberId(""); setMessage(editingMemberId ? "Data anggota diperbarui." : "Anggota baru berhasil ditambahkan.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Data anggota gagal disimpan."); }
    finally { setBusy(""); }
  }

  async function toggleMember(member: Row) {
    const next = member.active === false;
    if (!window.confirm((next ? "Aktifkan kembali " : "Nonaktifkan ") + member.name + "? Riwayat transaksi tetap disimpan.")) return;
    setBusy("member-status"); setError(""); setMessage("");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "members", member.id), { active: next, updatedAt: serverTimestamp() });
      batch.set(doc(collection(db, "audit_logs")), auditData(next ? "ACTIVATE_MEMBER" : "DEACTIVATE_MEMBER", "members", member.id, user));
      await batch.commit();
      setMessage(next ? "Anggota diaktifkan kembali." : "Anggota dinonaktifkan. Riwayat tetap tersimpan.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Status anggota gagal diperbarui."); }
    finally { setBusy(""); }
  }

  async function saveSavings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(savingForm.amount);
    if (!savingForm.memberId || !savingForm.date || !Number.isFinite(amount) || amount <= 0) return setError("Lengkapi anggota, tanggal, dan nominal simpanan yang benar.");
    setBusy("savings"); setError(""); setMessage("");
    const memberRef = doc(db, "members", savingForm.memberId);
    const periodId = periodOf(savingForm.date);
    const periodRef = doc(db, "periods", periodId);
    const savingRef = doc(collection(db, "savings_transactions"));
    const cashRef = doc(collection(db, "cash_transactions"));
    const journalRef = doc(collection(db, "journal_entries"));
    const auditRef = doc(collection(db, "audit_logs"));
    try {
      await runTransaction(db, async transaction => {
        const [memberSnap, periodSnap] = await Promise.all([transaction.get(memberRef), transaction.get(periodRef)]);
        if (!memberSnap.exists()) throw new Error("Anggota tidak ditemukan.");
        const member = memberSnap.data();
        if (savingForm.direction === "deposit" && member.active === false) throw new Error("Anggota nonaktif tidak dapat menerima setoran baru.");
        if (periodSnap.exists() && periodSnap.data().status !== "open") throw new Error("Periode " + periodLabel(periodId) + " tidak terbuka atau sudah ditutup.");
        const balances = { ...zeroBalances, ...(member.savingsBalances || {}) };
        const previous = Number(balances[savingForm.type] || 0);
        if (savingForm.direction === "withdrawal" && amount > previous) throw new Error("Saldo simpanan tidak mencukupi. Saldo tersedia " + money(previous) + ".");
        balances[savingForm.type] = previous + (savingForm.direction === "deposit" ? amount : -amount);
        if (!periodSnap.exists()) transaction.set(periodRef, newPeriodData(periodId, user));
        transaction.update(memberRef, { savingsBalances: balances, updatedAt: serverTimestamp() });
        transaction.set(savingRef, {
          memberId: savingForm.memberId, memberName: member.name, type: savingForm.type,
          direction: savingForm.direction, amount, date: savingForm.date, periodId,
          note: savingForm.note.trim(), createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        transaction.set(cashRef, {
          type: savingForm.direction === "deposit" ? "income" : "expense",
          category: (savingForm.direction === "deposit" ? "Setoran " : "Penarikan ") + savingForm.type,
          amount, date: savingForm.date, periodId, relatedType: "savings", relatedId: savingRef.id,
          note: savingForm.note.trim(), createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        const lines = savingForm.direction === "deposit"
          ? [journalLine("1101", "Kas/Bank", amount, 0), journalLine("2101", "Simpanan Anggota", 0, amount)]
          : [journalLine("2101", "Simpanan Anggota", amount, 0), journalLine("1101", "Kas/Bank", 0, amount)];
        transaction.set(journalRef, journalData(periodId, savingForm.date, "Transaksi simpanan " + member.name, lines, user));
        transaction.set(auditRef, auditData("SAVINGS_" + savingForm.direction.toUpperCase(), "savings_transactions", savingRef.id, user));
      });
      setSavingForm({ memberId: "", type: "mandatory", direction: "deposit", amount: "", date: todayWib(), note: "" });
      setMessage("Transaksi simpanan berhasil dicatat dan saldo anggota diperbarui.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Transaksi simpanan gagal disimpan."); }
    finally { setBusy(""); }
  }

  async function reverseSavings(original: Row) {
    if (original.reversalOf) return;
    if (!window.confirm("Buat transaksi pembalikan untuk simpanan " + original.memberName + " sebesar " + money(original.amount) + "? Catatan asli tidak akan dihapus.")) return;
    setBusy("reverse-savings"); setError(""); setMessage("");
    const memberRef = doc(db, "members", original.memberId);
    const periodId = periodOf(todayWib());
    const periodRef = doc(db, "periods", periodId);
    const reversalRef = doc(db, "savings_transactions", "reversal_" + original.id);
    const cashRef = doc(collection(db, "cash_transactions"));
    const journalRef = doc(collection(db, "journal_entries"));
    const auditRef = doc(collection(db, "audit_logs"));
    const direction: Direction = original.direction === "deposit" ? "withdrawal" : "deposit";
    const amount = Number(original.amount || 0);
    try {
      await runTransaction(db, async transaction => {
        const [memberSnap, periodSnap, reversalSnap] = await Promise.all([
          transaction.get(memberRef), transaction.get(periodRef), transaction.get(reversalRef)
        ]);
        if (!memberSnap.exists()) throw new Error("Anggota tidak ditemukan.");
        if (reversalSnap.exists()) throw new Error("Transaksi ini sudah pernah dibalik.");
        if (periodSnap.exists() && periodSnap.data().status !== "open") throw new Error("Periode pembalikan tidak terbuka.");
        const member = memberSnap.data();
        const balances = { ...zeroBalances, ...(member.savingsBalances || {}) };
        const previous = Number(balances[original.type as SavingType] || 0);
        if (direction === "withdrawal" && amount > previous) throw new Error("Saldo saat ini tidak cukup untuk membalik setoran yang lama.");
        balances[original.type as SavingType] = previous + (direction === "deposit" ? amount : -amount);
        if (!periodSnap.exists()) transaction.set(periodRef, newPeriodData(periodId, user));
        transaction.update(memberRef, { savingsBalances: balances, updatedAt: serverTimestamp() });
        transaction.set(reversalRef, {
          memberId: original.memberId, memberName: original.memberName, type: original.type,
          direction, amount, date: todayWib(), periodId, reversalOf: original.id,
          note: "Pembalikan transaksi simpanan " + original.id,
          createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        transaction.set(cashRef, {
          type: direction === "deposit" ? "income" : "expense",
          category: "Pembalikan simpanan " + original.type, amount, date: todayWib(), periodId,
          relatedType: "savings_reversal", relatedId: original.id,
          note: "Pembalikan transaksi simpanan " + original.memberName,
          createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        const lines = direction === "deposit"
          ? [journalLine("1101", "Kas/Bank", amount, 0), journalLine("2101", "Simpanan Anggota", 0, amount)]
          : [journalLine("2101", "Simpanan Anggota", amount, 0), journalLine("1101", "Kas/Bank", 0, amount)];
        transaction.set(journalRef, journalData(periodId, todayWib(), "Pembalikan simpanan " + original.memberName, lines, user));
        transaction.set(auditRef, auditData("REVERSE_SAVINGS_TRANSACTION", "savings_transactions", original.id, user));
      });
      setMessage("Transaksi simpanan dibalik melalui catatan baru. Riwayat asli tetap tersimpan.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Pembalikan simpanan gagal."); }
    finally { setBusy(""); }
  }

  async function submitLoanApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(applicationForm.amount);
    const term = Number(applicationForm.termMonths);
    const rate = Number(applicationForm.interestRate) / 100;
    if (!applicationForm.memberId || amount <= 0 || term < 1 || rate < 0) return setError("Lengkapi anggota, jumlah pinjaman, tenor, dan bunga.");
    setBusy("application"); setError(""); setMessage("");
    try {
      const ref = doc(collection(db, "loan_applications"));
      const batch = writeBatch(db);
      const member = members.find(item => item.id === applicationForm.memberId);
      if (!member) throw new Error("Anggota tidak ditemukan.");
      batch.set(ref, {
        memberId: member.id, memberName: member.name, amount, termMonths: term,
        source: applicationForm.source, interestRate: rate, date: applicationForm.date,
        note: applicationForm.note.trim(), status: "pending",
        createdAt: serverTimestamp(), createdBy: user?.uid || null
      });
      batch.set(doc(collection(db, "audit_logs")), auditData("CREATE_LOAN_APPLICATION", "loan_applications", ref.id, user));
      await batch.commit();
      setApplicationForm({ memberId: "", amount: "", termMonths: "12", source: "KOPERASI", interestRate: "1", date: todayWib(), note: "" });
      setMessage("Pengajuan pinjaman berhasil dicatat dan menunggu persetujuan.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Pengajuan pinjaman gagal disimpan."); }
    finally { setBusy(""); }
  }

  async function approveApplication(application: Row) {
    if (!window.confirm("Setujui dan cairkan pinjaman " + money(application.amount) + " untuk " + application.memberName + "?")) return;
    setBusy("approve"); setError(""); setMessage("");
    const appRef = doc(db, "loan_applications", application.id);
    const memberRef = doc(db, "members", application.memberId);
    const periodId = periodOf(application.date);
    const periodRef = doc(db, "periods", periodId);
    const loanRef = doc(collection(db, "loans"));
    const cashRef = doc(collection(db, "cash_transactions"));
    const journalRef = doc(collection(db, "journal_entries"));
    const auditRef = doc(collection(db, "audit_logs"));
    try {
      await runTransaction(db, async transaction => {
        const [appSnap, memberSnap, periodSnap] = await Promise.all([
          transaction.get(appRef), transaction.get(memberRef), transaction.get(periodRef)
        ]);
        if (!appSnap.exists() || appSnap.data().status !== "pending") throw new Error("Pengajuan sudah diproses atau tidak ditemukan.");
        if (!memberSnap.exists() || memberSnap.data().active === false) throw new Error("Anggota tidak aktif atau tidak ditemukan.");
        if (periodSnap.exists() && periodSnap.data().status !== "open") throw new Error("Periode pencairan tidak terbuka atau sudah ditutup.");
        const app = appSnap.data();
        const principal = Number(app.amount);
        if (app.source === "KOPERASI" && principal > cashBalance) throw new Error("Saldo kas koperasi tidak mencukupi untuk pencairan ini. Saldo saat ini " + money(cashBalance) + ".");
        const monthlyPrincipal = Math.ceil(principal / Number(app.termMonths));
        const monthlyInterest = Math.round(principal * Number(app.interestRate));
        if (!periodSnap.exists()) transaction.set(periodRef, newPeriodData(periodId, user));
        transaction.update(appRef, { status: "disbursed", approvedAt: serverTimestamp(), approvedBy: user?.uid || null, loanId: loanRef.id });
        transaction.set(loanRef, {
          applicationId: appRef.id, memberId: app.memberId, memberName: app.memberName,
          source: app.source, principal, outstandingPrincipal: principal,
          termMonths: Number(app.termMonths), interestRate: Number(app.interestRate),
          monthlyPrincipal, monthlyInterest, installmentNumber: 0,
          startDate: app.date, status: "active", createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        // Pinjaman dari Mandiri/BRI adalah fasilitas eksternal anggota, bukan arus kas KPN.
        // Hanya pinjaman yang bersumber dari dana koperasi masuk ke buku kas dan jurnal koperasi.
        if (app.source === "KOPERASI") {
          transaction.set(cashRef, {
            type: "expense", category: "Pencairan pinjaman koperasi", amount: principal,
            date: app.date, periodId, relatedType: "loan", relatedId: loanRef.id,
            note: "Pencairan pinjaman " + app.memberName, createdAt: serverTimestamp(), createdBy: user?.uid || null
          });
          transaction.set(journalRef, journalData(periodId, app.date, "Pencairan pinjaman " + app.memberName, [
            journalLine("1201", "Piutang Pinjaman", principal, 0),
            journalLine("1101", "Kas/Bank", 0, principal)
          ], user));
        }
        transaction.set(auditRef, auditData("APPROVE_AND_DISBURSE_LOAN", "loans", loanRef.id, user));
      });
      setMessage("Pinjaman disetujui dan pencairan dicatat. Angsuran pokok serta bunga dihitung otomatis.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Persetujuan/pencairan pinjaman gagal."); }
    finally { setBusy(""); }
  }

  async function rejectApplication(application: Row) {
    if (!window.confirm("Tolak pengajuan pinjaman " + application.memberName + "?")) return;
    setBusy("reject"); setError(""); setMessage("");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "loan_applications", application.id), { status: "rejected", rejectedAt: serverTimestamp(), rejectedBy: user?.uid || null });
      batch.set(doc(collection(db, "audit_logs")), auditData("REJECT_LOAN_APPLICATION", "loan_applications", application.id, user));
      await batch.commit();
      setMessage("Pengajuan pinjaman ditolak."); await refreshAll();
    } catch (e: any) { setError(e?.message || "Pengajuan gagal diperbarui."); }
    finally { setBusy(""); }
  }

  async function payInstallment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const loan = loans.find(item => item.id === installmentForm.loanId);
    if (!loan) return setError("Pilih pinjaman yang masih aktif.");
    const periodId = periodOf(installmentForm.date);
    const isPayoff = installmentForm.kind === "payoff";
    const outstanding = Number(loan.outstandingPrincipal || 0);
    const principalPaid = isPayoff ? outstanding : Math.min(Number(loan.monthlyPrincipal || 0), outstanding);
    const interestPaid = isPayoff ? Number(installmentForm.payoffInterest || 0) : Number(loan.monthlyInterest || 0);
    if (principalPaid <= 0 || interestPaid < 0) return setError("Nominal angsuran tidak valid.");
    setBusy("installment"); setError(""); setMessage("");
    const loanRef = doc(db, "loans", loan.id);
    const periodRef = doc(db, "periods", periodId);
    const installmentRef = doc(db, "installments", loan.id + "__" + periodId);
    const cashRef = doc(collection(db, "cash_transactions"));
    const journalRef = doc(collection(db, "journal_entries"));
    const auditRef = doc(collection(db, "audit_logs"));
    try {
      await runTransaction(db, async transaction => {
        const [loanSnap, periodSnap, installmentSnap] = await Promise.all([
          transaction.get(loanRef), transaction.get(periodRef), transaction.get(installmentRef)
        ]);
        if (!loanSnap.exists() || loanSnap.data().status !== "active") throw new Error("Pinjaman tidak aktif atau sudah lunas.");
        if (periodSnap.exists() && periodSnap.data().status !== "open") throw new Error("Periode pembayaran tidak terbuka atau sudah ditutup.");
        if (installmentSnap.exists()) throw new Error("Angsuran pinjaman ini untuk periode " + periodLabel(periodId) + " sudah dicatat. Sistem mencegah pembayaran ganda.");
        const currentLoan = loanSnap.data();
        const currentOutstanding = Number(currentLoan.outstandingPrincipal || 0);
        const principal = isPayoff ? currentOutstanding : Math.min(Number(currentLoan.monthlyPrincipal || 0), currentOutstanding);
        const interest = isPayoff ? interestPaid : Number(currentLoan.monthlyInterest || 0);
        if (principal <= 0) throw new Error("Sisa pokok pinjaman sudah nol.");
        const remaining = Math.max(0, currentOutstanding - principal);
        const total = principal + interest;
        const nextNumber = isPayoff ? Number(currentLoan.installmentNumber || 0) : Number(currentLoan.installmentNumber || 0) + 1;
        if (!periodSnap.exists()) transaction.set(periodRef, newPeriodData(periodId, user));
        transaction.update(loanRef, {
          outstandingPrincipal: remaining, installmentNumber: nextNumber,
          status: remaining === 0 ? "paid" : "active", lastPaymentDate: installmentForm.date,
          updatedAt: serverTimestamp()
        });
        transaction.set(installmentRef, {
          loanId: loan.id, memberId: currentLoan.memberId, memberName: currentLoan.memberName,
          source: currentLoan.source, kind: isPayoff ? "payoff" : "regular",
          periodId, date: installmentForm.date, installmentNumber: nextNumber,
          principalPaid: principal, interestPaid: interest, totalPaid: total,
          remainingPrincipal: remaining, note: installmentForm.note.trim(),
          createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        // Angsuran fasilitas bank dicatat sebagai riwayat pinjaman anggota,
        // tetapi tidak dicampurkan ke kas KPN. Hanya pinjaman koperasi masuk jurnal kas.
        if (currentLoan.source === "KOPERASI") {
          transaction.set(cashRef, {
            type: "income", category: isPayoff ? "Pelunasan pinjaman" : "Penerimaan angsuran",
            amount: total, date: installmentForm.date, periodId, relatedType: "installment",
            relatedId: installmentRef.id, note: currentLoan.memberName + " · " + (isPayoff ? "Pelunasan" : "Angsuran ke-" + nextNumber),
            createdAt: serverTimestamp(), createdBy: user?.uid || null
          });
          const lines = [journalLine("1101", "Kas/Bank", total, 0)];
          if (principal > 0) lines.push(journalLine("1201", "Piutang Pinjaman", 0, principal));
          if (interest > 0) lines.push(journalLine("4101", "Pendapatan Bunga Pinjaman", 0, interest));
          transaction.set(journalRef, journalData(periodId, installmentForm.date, "Pembayaran pinjaman " + currentLoan.memberName, lines, user));
        }
        transaction.set(auditRef, auditData(isPayoff ? "EARLY_LOAN_PAYOFF" : "RECEIVE_INSTALLMENT", "installments", installmentRef.id, user));
      });
      setInstallmentForm({ loanId: "", kind: "regular", date: todayWib(), payoffInterest: "0", note: "" });
      setMessage(isPayoff ? "Pelunasan dipercepat berhasil dicatat. Tidak ada angsuran berikutnya." : "Pembayaran angsuran berhasil dicatat dan sisa pinjaman diperbarui.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Pembayaran angsuran gagal dicatat."); }
    finally { setBusy(""); }
  }

  async function reverseInstallment(original: Row) {
    if (original.kind === "reversal" || original.reversalOf) return;
    if (!window.confirm("Batalkan pembayaran " + original.memberName + " sebesar " + money(original.totalPaid) + "? Sistem akan membuat transaksi pembalikan baru.")) return;
    setBusy("reverse-installment"); setError(""); setMessage("");
    const loanRef = doc(db, "loans", original.loanId);
    const periodId = periodOf(todayWib());
    const periodRef = doc(db, "periods", periodId);
    const reversalRef = doc(db, "installments", "reversal_" + original.id);
    const cashRef = doc(collection(db, "cash_transactions"));
    const journalRef = doc(collection(db, "journal_entries"));
    const auditRef = doc(collection(db, "audit_logs"));
    const principal = Math.abs(Number(original.principalPaid || 0));
    const interest = Math.abs(Number(original.interestPaid || 0));
    const total = principal + interest;
    try {
      await runTransaction(db, async transaction => {
        const [loanSnap, periodSnap, reversalSnap] = await Promise.all([
          transaction.get(loanRef), transaction.get(periodRef), transaction.get(reversalRef)
        ]);
        if (!loanSnap.exists()) throw new Error("Pinjaman tidak ditemukan.");
        if (reversalSnap.exists()) throw new Error("Pembayaran ini sudah pernah dibalik.");
        if (periodSnap.exists() && periodSnap.data().status !== "open") throw new Error("Periode pembalikan tidak terbuka.");
        const loan = loanSnap.data();
        if (Number(loan.installmentNumber || 0) !== Number(original.installmentNumber || 0) ||
            Number(loan.outstandingPrincipal || 0) !== Number(original.remainingPrincipal || 0)) {
          throw new Error("Pembayaran ini bukan transaksi terakhir pinjaman. Pembalikan ditolak agar riwayat angsuran berikutnya tidak rusak.");
        }
        if (loan.source === "KOPERASI" && total > cashBalance) throw new Error("Saldo kas koperasi tidak cukup untuk mengembalikan pembayaran ini.");
        const restoredBalance = Number(loan.outstandingPrincipal || 0) + principal;
        const nextNumber = original.kind === "regular" ? Math.max(0, Number(loan.installmentNumber || 0) - 1) : Number(loan.installmentNumber || 0);
        if (!periodSnap.exists()) transaction.set(periodRef, newPeriodData(periodId, user));
        transaction.update(loanRef, {
          outstandingPrincipal: restoredBalance, installmentNumber: nextNumber,
          status: "active", lastPaymentDate: null, updatedAt: serverTimestamp()
        });
        transaction.set(reversalRef, {
          loanId: original.loanId, memberId: original.memberId, memberName: original.memberName,
          source: original.source, kind: "reversal", periodId, date: todayWib(),
          installmentNumber: nextNumber, principalPaid: -principal, interestPaid: -interest,
          totalPaid: -total, remainingPrincipal: restoredBalance, reversalOf: original.id,
          note: "Pembalikan pembayaran " + original.id,
          createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        if (loan.source === "KOPERASI") {
          transaction.set(cashRef, {
            type: "expense", category: "Pembalikan penerimaan angsuran", amount: total,
            date: todayWib(), periodId, relatedType: "installment_reversal", relatedId: original.id,
            note: "Pengembalian pembayaran " + original.memberName,
            createdAt: serverTimestamp(), createdBy: user?.uid || null
          });
          const lines = [journalLine("1201", "Piutang Pinjaman", principal, 0)];
          if (interest > 0) lines.push(journalLine("4101", "Pendapatan Bunga Pinjaman", interest, 0));
          lines.push(journalLine("1101", "Kas/Bank", 0, total));
          transaction.set(journalRef, journalData(periodId, todayWib(), "Pembalikan pembayaran pinjaman " + original.memberName, lines, user));
        }
        transaction.set(auditRef, auditData("REVERSE_INSTALLMENT", "installments", original.id, user));
      });
      setMessage("Pembayaran dibalik. Sisa pokok dan nomor angsuran dikembalikan ke posisi sebelum pembayaran.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Pembalikan angsuran gagal."); }
    finally { setBusy(""); }
  }

  async function reverseCashTransaction(original: Row) {
    if (original.relatedType || original.reversalOf) return;
    if (!window.confirm("Buat pembalikan kas untuk transaksi " + original.category + " sebesar " + money(original.amount) + "?")) return;
    setBusy("reverse-cash"); setError(""); setMessage("");
    const periodId = periodOf(todayWib());
    const periodRef = doc(db, "periods", periodId);
    const reversalRef = doc(db, "cash_transactions", "reversal_" + original.id);
    const journalRef = doc(collection(db, "journal_entries"));
    const auditRef = doc(collection(db, "audit_logs"));
    const amount = Number(original.amount || 0);
    const reversedType = original.type === "income" ? "expense" : "income";
    try {
      await runTransaction(db, async transaction => {
        const [periodSnap, reversalSnap] = await Promise.all([transaction.get(periodRef), transaction.get(reversalRef)]);
        if (reversalSnap.exists()) throw new Error("Transaksi kas ini sudah pernah dibalik.");
        if (periodSnap.exists() && periodSnap.data().status !== "open") throw new Error("Periode pembalikan tidak terbuka.");
        if (reversedType === "expense" && amount > cashBalance) throw new Error("Saldo kas tidak cukup untuk membalik penerimaan ini.");
        if (!periodSnap.exists()) transaction.set(periodRef, newPeriodData(periodId, user));
        transaction.set(reversalRef, {
          type: reversedType, category: "Pembalikan: " + original.category, amount,
          date: todayWib(), periodId, reversalOf: original.id,
          note: "Pembalikan transaksi kas " + original.id,
          createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        const lines = original.type === "income"
          ? [journalLine("4201", "Pendapatan Lain-lain", amount, 0), journalLine("1101", "Kas/Bank", 0, amount)]
          : [journalLine("1101", "Kas/Bank", amount, 0), journalLine("5101", "Beban Operasional", 0, amount)];
        transaction.set(journalRef, journalData(periodId, todayWib(), "Pembalikan kas " + original.category, lines, user));
        transaction.set(auditRef, auditData("REVERSE_CASH_TRANSACTION", "cash_transactions", original.id, user));
      });
      setMessage("Transaksi kas dibalik melalui jurnal koreksi. Catatan asli tetap tersimpan.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Pembalikan kas gagal."); }
    finally { setBusy(""); }
  }

  async function saveCashTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(cashForm.amount);
    if (amount <= 0 || !cashForm.date || !cashForm.category.trim()) return setError("Lengkapi kategori, tanggal, dan nominal kas.");
    if (cashForm.type === "expense" && amount > cashBalance) return setError("Saldo kas tidak mencukupi. Saldo saat ini " + money(cashBalance) + ".");
    const periodId = periodOf(cashForm.date);
    setBusy("cash"); setError(""); setMessage("");
    const periodRef = doc(db, "periods", periodId);
    const cashRef = doc(collection(db, "cash_transactions"));
    const journalRef = doc(collection(db, "journal_entries"));
    const auditRef = doc(collection(db, "audit_logs"));
    try {
      await runTransaction(db, async transaction => {
        const periodSnap = await transaction.get(periodRef);
        if (periodSnap.exists() && periodSnap.data().status !== "open") throw new Error("Periode " + periodLabel(periodId) + " tidak terbuka atau sudah ditutup.");
        if (!periodSnap.exists()) transaction.set(periodRef, newPeriodData(periodId, user));
        transaction.set(cashRef, {
          type: cashForm.type, category: cashForm.category.trim(), amount,
          date: cashForm.date, periodId, note: cashForm.note.trim(),
          createdAt: serverTimestamp(), createdBy: user?.uid || null
        });
        const lines = cashForm.type === "income"
          ? [journalLine("1101", "Kas/Bank", amount, 0), journalLine("4201", "Pendapatan Lain-lain", 0, amount)]
          : [journalLine("5101", "Beban Operasional", amount, 0), journalLine("1101", "Kas/Bank", 0, amount)];
        transaction.set(journalRef, journalData(periodId, cashForm.date, cashForm.category.trim(), lines, user));
        transaction.set(auditRef, auditData(cashForm.type === "income" ? "CASH_IN" : "CASH_OUT", "cash_transactions", cashRef.id, user));
      });
      setCashForm({ type: "expense", category: "Operasional", amount: "", date: todayWib(), note: "" });
      setMessage("Transaksi kas berhasil dicatat ke buku kas dan jurnal.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Transaksi kas gagal disimpan."); }
    finally { setBusy(""); }
  }

  async function closePeriod(period: Row) {
    if (period.status !== "open") return;
    if (!window.confirm("Tutup periode " + period.periodLabel + "? Transaksi baru pada periode ini akan ditolak. Penutupan tidak dapat dibatalkan dari aplikasi.")) return;
    setBusy("period"); setError(""); setMessage("");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "periods", period.id), { status: "closed", closedAt: serverTimestamp(), closedBy: user?.uid || null });
      batch.set(doc(collection(db, "audit_logs")), auditData("CLOSE_PERIOD", "periods", period.id, user));
      await batch.commit();
      setMessage("Periode " + period.periodLabel + " berhasil ditutup dan dikunci.");
      await refreshAll();
    } catch (e: any) { setError(e?.message || "Periode gagal ditutup."); }
    finally { setBusy(""); }
  }

  async function publishSummary() {
    const totalSavingsNow = members.reduce((sum, member) => sum + Object.values({ ...zeroBalances, ...(member.savingsBalances || {}) }).reduce((a: number, b: any) => a + Number(b || 0), 0), 0);
    const outstandingNow = loans.filter(loan => loan.status === "active").reduce((sum, loan) => sum + Number(loan.outstandingPrincipal || 0), 0);
    const summary = {
      memberCount: members.filter(member => member.active !== false).length,
      savingsTotal: totalSavingsNow, outstandingTotal: outstandingNow,
      cashBalance, interestIncome: installments.reduce((sum, item) => sum + Number(item.interestPaid || 0), 0),
      updatedAt: serverTimestamp()
    };
    setBusy("publish"); setError(""); setMessage("");
    try {
      await updateDoc(doc(db, "public_summaries", "current"), summary).catch(async () => {
        const batch = writeBatch(db); batch.set(doc(db, "public_summaries", "current"), summary); await batch.commit();
      });
      await loadPublicSummary();
      setMessage("Ringkasan agregat koperasi berhasil dipublikasikan tanpa menampilkan data pribadi anggota.");
    } catch (e: any) { setError(e?.message || "Ringkasan publik gagal diperbarui."); }
    finally { setBusy(""); }
  }

  const totalSavings = useMemo(() => members.reduce((sum, member) =>
    sum + Object.values({ ...zeroBalances, ...(member.savingsBalances || {}) }).reduce((a: number, b: any) => a + Number(b || 0), 0), 0), [members]);
  const cashBalance = useMemo(() => cashTransactions.reduce((sum, item) =>
    sum + (item.type === "income" ? Number(item.amount || 0) : -Number(item.amount || 0)), 0), [cashTransactions]);
  const outstandingLoans = useMemo(() => loans.filter(item => item.status === "active")
    .reduce((sum, item) => sum + Number(item.outstandingPrincipal || 0), 0), [loans]);
  const totalLoanInterest = useMemo(() => installments.filter(item => item.source === "KOPERASI").reduce((sum, item) => sum + Number(item.interestPaid || 0), 0), [installments]);
  const activeMembers = members.filter(member => member.active !== false);
  const latestPeriod = periods[0] || null;

  const filteredSavings = savingsTransactions.filter(item => reportPeriod === "all" || item.periodId === reportPeriod);
  const filteredInstallments = installments.filter(item => reportPeriod === "all" || item.periodId === reportPeriod);
  const filteredCash = cashTransactions.filter(item => reportPeriod === "all" || item.periodId === reportPeriod);
  const filteredJournals = journals.filter(item => reportPeriod === "all" || item.periodId === reportPeriod);
  const trialBalance = useMemo(() => {
    const accounts = new Map<string, { code: string; name: string; debit: number; credit: number }>();
    filteredJournals.forEach(entry => (entry.lines || []).forEach((line: Row) => {
      const key = String(line.accountCode);
      const current = accounts.get(key) || { code: key, name: line.accountName, debit: 0, credit: 0 };
      current.debit += Number(line.debit || 0); current.credit += Number(line.credit || 0);
      accounts.set(key, current);
    }));
    return [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [filteredJournals]);
  const filteredMembers = members.filter(member =>
    (String(member.memberNo || "") + " " + String(member.name || "") + " " + String(member.phone || "")).toLowerCase().includes(search.toLowerCase())
  );
  const filteredLoans = loans.filter(loan =>
    (String(loan.memberName || "") + " " + String(loan.source || "")).toLowerCase().includes(search.toLowerCase())
  );
  const totalIncome = trialBalance.filter(item => item.code.startsWith("4")).reduce((sum, item) => sum + item.credit - item.debit, 0);
  const totalExpense = trialBalance.filter(item => item.code.startsWith("5")).reduce((sum, item) => sum + item.debit - item.credit, 0);
  const netSurplus = totalIncome - totalExpense;

  function exportReports() {
    const workbook = XLSX.utils.book_new();
    const add = (name: string, rows: Row[]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
    add("Anggota", members.map(m => ({
      "Nomor Anggota": m.memberNo, "Nama": m.name, "Telepon": m.phone || "",
      "Tanggal Bergabung": m.joinDate, "Status": m.active === false ? "Nonaktif" : "Aktif",
      "Simpanan Pokok": Number(m.savingsBalances?.principal || 0),
      "Simpanan Wajib": Number(m.savingsBalances?.mandatory || 0),
      "Simpanan Sukarela": Number(m.savingsBalances?.voluntary || 0)
    })));
    add("Simpanan", filteredSavings.map(t => ({
      "Tanggal": t.date, "Periode": t.periodId, "Anggota": t.memberName, "Jenis": t.type,
      "Arah": t.direction, "Nominal": t.amount, "Catatan": t.note || ""
    })));
    add("Pinjaman", loans.map(l => ({
      "Anggota": l.memberName, "Sumber": l.source, "Pokok Awal": l.principal,
      "Sisa Pokok": l.outstandingPrincipal, "Bunga Bulanan": l.monthlyInterest,
      "Tenor": l.termMonths, "Angsuran Ke": l.installmentNumber, "Status": l.status
    })));
    add("Angsuran", filteredInstallments.map(t => ({
      "Tanggal": t.date, "Periode": t.periodId, "Anggota": t.memberName, "Jenis": t.kind,
      "Angsuran Ke": t.installmentNumber, "Pokok": t.principalPaid, "Bunga": t.interestPaid,
      "Total": t.totalPaid, "Sisa Pokok": t.remainingPrincipal
    })));
    add("Buku Kas", filteredCash.map(t => ({
      "Tanggal": t.date, "Periode": t.periodId, "Jenis": t.type, "Kategori": t.category,
      "Masuk": t.type === "income" ? t.amount : 0, "Keluar": t.type === "expense" ? t.amount : 0,
      "Catatan": t.note || ""
    })));
    add("Neraca Saldo", trialBalance.map(t => ({
      "Kode Akun": t.code, "Nama Akun": t.name, "Debit": t.debit, "Kredit": t.credit
    })));
    XLSX.writeFile(workbook, "Laporan_Keuangan_KPN_" + (reportPeriod === "all" ? "semua-periode" : reportPeriod) + ".xlsx");
    setMessage("Laporan Excel berhasil dibuat.");
  }

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "members", label: "Anggota", icon: Users },
    { id: "savings", label: "Simpanan", icon: Wallet },
    { id: "loans", label: "Pinjaman", icon: Landmark },
    { id: "installments", label: "Angsuran", icon: Banknote },
    { id: "cash", label: "Kas", icon: CircleDollarSign },
    { id: "reports", label: "Laporan", icon: BarChart3 },
    { id: "periods", label: "Periode", icon: CalendarDays }
  ];

  if (authLoading) return <div className="flex min-h-screen items-center justify-center bg-mist text-emerald-800"><Loader2 className="animate-spin" /><span className="ml-3 text-sm">Memeriksa sesi administrator...</span></div>;

  return <div className="min-h-screen bg-mist text-ink">
    <header className="sticky top-0 z-30 border-b border-emerald-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-800 text-white"><Landmark size={21} /></div>
          <div><p className="text-sm font-bold tracking-tight">KPN Koperasi</p><p className="text-[11px] text-slate-500">Kejaksaan Negeri Padang</p></div>
        </div>
        <div className="datetime-panel">
          <div className="datetime-icon"><CalendarDays size={17} /></div>
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="datetime-caption">WAKTU PADANG</span><span className="datetime-live"><span className="datetime-live-dot" /> WIB</span></div>
            <div className="flex items-baseline gap-1.5"><time className="datetime-digits">{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(now)}</time><span className="datetime-seconds">{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", second: "2-digit" }).format(now)}</span></div>
            <p className="datetime-date">{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(now)}</p>
          </div>
        </div>
        {isAdmin ? <div className="flex items-center gap-2">
          <span className="hidden rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 sm:inline-flex"><ShieldCheck size={14} className="mr-1.5" /> Administrator</span>
          <button className={buttonSecondary} onClick={() => { setError(""); setShowPassword(true); }}><KeyRound size={15} /><span className="hidden sm:inline">Ganti password</span></button>
          <button className={buttonSecondary} onClick={() => void signOut(auth)}><LogOut size={15} /> Keluar</button>
        </div> : <button className={buttonPrimary} onClick={() => { setError(""); setShowLogin(true); }}><LockKeyhole size={15} /> Masuk Pengelola</button>}
      </div>
    </header>

    {isAdmin ? <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[220px_1fr]">
      <aside className="h-fit rounded-2xl border border-emerald-100 bg-white p-3 shadow-soft">
        <p className="px-3 pb-3 pt-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Menu sistem keuangan</p>
        <nav className="grid grid-cols-2 gap-1 lg:grid-cols-1">
          {tabs.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => { setTab(item.id); setSearch(""); setError(""); setMessage(""); }}
            className={"flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition " + (tab === item.id ? "bg-emerald-800 text-white" : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900")}>
            <Icon size={17} />{item.label}</button>; })}
        </nav>
        <div className="mt-5 rounded-xl bg-emerald-50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-emerald-900"><ShieldCheck size={15} /> Data terlindungi</div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">Transaksi dicatat permanen, saldo dihitung dari pembukuan, dan periode yang ditutup terkunci.</p></div>
      </aside>

      <main className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Sistem operasional koperasi</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{tabs.find(item => item.id === tab)?.label}</h1>
            <p className="mt-1 text-sm text-slate-500">Kelola data dan transaksi koperasi langsung dari aplikasi.</p></div>
          <div className="flex flex-wrap gap-2">
            <button className={buttonSecondary} onClick={exportReports}><Download size={15} /> Ekspor Excel</button>
            <button className={buttonSecondary} onClick={() => window.print()}><Printer size={15} /> Cetak</button>
            <button className={buttonSecondary} onClick={() => void refreshAll()}><RefreshCw size={15} className={busy === "refresh" ? "animate-spin" : ""} /> Segarkan</button>
          </div>
        </div>
        {error ? <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div> : null}
        {message ? <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{message}</div> : null}

        {tab === "dashboard" ? <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Anggota aktif" value={fmtNumber(activeMembers.length)} note={fmtNumber(members.length - activeMembers.length) + " nonaktif"} icon={Users} />
            <Stat label="Total simpanan" value={money(totalSavings)} note="Saldo seluruh jenis simpanan" icon={Wallet} />
            <Stat label="Sisa pinjaman" value={money(outstandingLoans)} note={fmtNumber(loans.filter(l => l.status === "active").length) + " pinjaman berjalan"} icon={Landmark} tone="blue" />
            <Stat label="Saldo kas/bank" value={money(cashBalance)} note="Berdasarkan buku kas" icon={CircleDollarSign} tone="amber" />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
            <Card><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Aktivitas keuangan</h2><p className="mt-1 text-xs text-slate-500">Akumulasi seluruh transaksi yang telah dicatat</p></div><Activity className="text-emerald-700" size={20} /></div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-emerald-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-emerald-800"><TrendingUp size={15} /> Penerimaan kas</div><p className="mt-2 text-lg font-bold text-emerald-950">{money(cashTransactions.filter(t => t.type === "income").reduce((s,t) => s + Number(t.amount || 0),0))}</p></div>
                <div className="rounded-xl bg-rose-50 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-rose-800"><TrendingDown size={15} /> Pengeluaran kas</div><p className="mt-2 text-lg font-bold text-rose-950">{money(cashTransactions.filter(t => t.type === "expense").reduce((s,t) => s + Number(t.amount || 0),0))}</p></div>
                <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs text-slate-500">Bunga pinjaman diterima</p><p className="mt-2 font-bold text-slate-900">{money(totalLoanInterest)}</p></div>
                <div className="rounded-xl border border-slate-100 p-4"><p className="text-xs text-slate-500">Jumlah transaksi kas</p><p className="mt-2 font-bold text-slate-900">{fmtNumber(cashTransactions.length)}</p></div>
              </div>
            </Card>
            <Card><h2 className="font-semibold">Periode berjalan</h2><p className="mt-1 text-xs text-slate-500">Transaksi baru otomatis masuk ke periode sesuai tanggal.</p>
              <div className="mt-5 rounded-xl bg-emerald-50 p-4"><p className="text-xs font-semibold text-emerald-800">Periode terbaru</p><p className="mt-1 text-xl font-bold text-emerald-950">{latestPeriod?.periodLabel || periodLabel(periodOf(todayWib()))}</p><p className="mt-1 text-xs text-slate-600">Status: {latestPeriod ? (latestPeriod.status === "closed" ? "Ditutup" : "Terbuka") : "Belum ada transaksi"}</p></div>
              <div className="mt-4 flex items-center justify-between text-sm"><span className="text-slate-500">Pengajuan menunggu</span><strong>{fmtNumber(applications.filter(a => a.status === "pending").length)}</strong></div>
              <div className="mt-3 flex items-center justify-between text-sm"><span className="text-slate-500">Angsuran tercatat</span><strong>{fmtNumber(installments.length)}</strong></div>
              <button className={"mt-5 w-full " + buttonSecondary} onClick={() => setTab("reports")}>Buka laporan <ChevronRight size={15} /></button>
            </Card>
          </div>
          <Card><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Transaksi kas terbaru</h2><p className="mt-1 text-xs text-slate-500">10 transaksi terakhir</p></div><BookOpen size={19} className="text-emerald-700" /></div>
            {cashTransactions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Tanggal</th><th>Kategori</th><th>Jenis</th><th className="text-right">Nominal</th></tr></thead><tbody>{cashTransactions.slice(0,10).map(t => <tr key={t.id} className="border-b border-slate-50"><td className="py-3">{dateLabel(t.date)}</td><td>{t.category}</td><td><Status value={t.type} /></td><td className={"text-right font-semibold " + (t.type === "income" ? "text-emerald-700" : "text-rose-700")}>{money(t.amount)}</td></tr>)}</tbody></table></div> : <Empty title="Belum ada transaksi" detail="Mulai dengan menambahkan anggota, simpanan, pengajuan pinjaman, atau transaksi kas." />}
          </Card>
        </> : null}

        {tab === "members" ? <div className="space-y-4">
          <Card><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-semibold">{editingMemberId ? "Ubah data anggota" : "Tambah anggota baru"}</h2><p className="mt-1 text-xs text-slate-500">Anggota yang memiliki transaksi tidak dihapus permanen, tetapi dinonaktifkan.</p></div>{editingMemberId ? <button className={buttonSecondary} onClick={() => { setEditingMemberId(""); setMemberForm({memberNo:"",name:"",phone:"",joinDate:todayWib()}); }}>Batal edit</button> : <Plus size={19} className="text-emerald-700" />}</div>
            <form onSubmit={saveMember} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Nomor anggota"><input className={inputClass} required disabled={!!editingMemberId} value={memberForm.memberNo} onChange={e => setMemberForm({...memberForm,memberNo:e.target.value})} placeholder="Contoh: 001" /></Field>
              <Field label="Nama lengkap"><input className={inputClass} required value={memberForm.name} onChange={e => setMemberForm({...memberForm,name:e.target.value})} placeholder="Nama anggota" /></Field>
              <Field label="Nomor telepon"><input className={inputClass} value={memberForm.phone} onChange={e => setMemberForm({...memberForm,phone:e.target.value})} placeholder="Opsional" /></Field>
              <Field label="Tanggal bergabung"><input className={inputClass} type="date" required value={memberForm.joinDate} onChange={e => setMemberForm({...memberForm,joinDate:e.target.value})} /></Field>
              <div className="sm:col-span-2 xl:col-span-4"><button className={buttonPrimary} disabled={busy === "member"}>{busy === "member" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}{editingMemberId ? "Simpan perubahan anggota" : "Tambahkan anggota"}</button></div>
            </form>
          </Card>
          <Card><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Daftar anggota</h2><p className="text-xs text-slate-500">{fmtNumber(members.length)} anggota terdaftar</p></div><div className="relative w-full sm:w-72"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nomor, nama, telepon..." /></div></div>
            {filteredMembers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">No. anggota</th><th>Nama anggota</th><th>Telepon</th><th>Simpanan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{filteredMembers.map(m => <tr key={m.id} className="border-b border-slate-50"><td className="py-3">{m.memberNo}</td><td className="font-medium text-slate-800">{m.name}</td><td>{m.phone || "—"}</td><td>{money(Object.values({...zeroBalances,...(m.savingsBalances||{})}).reduce((s:any,v:any)=>s+Number(v||0),0))}</td><td><Status value={m.active === false ? "inactive" : "active"} /></td><td><div className="flex gap-2"><button className="text-xs font-semibold text-emerald-800 hover:underline" onClick={() => setSelectedMemberId(m.id)}>Riwayat</button><button className="text-xs font-semibold text-emerald-800 hover:underline" onClick={() => {setEditingMemberId(m.id);setMemberForm({memberNo:m.memberNo||"",name:m.name||"",phone:m.phone||"",joinDate:m.joinDate||todayWib()});window.scrollTo({top:0,behavior:"smooth"});}}>Edit</button><button className="text-xs font-semibold text-slate-500 hover:underline" onClick={() => void toggleMember(m)}>{m.active === false ? "Aktifkan" : "Nonaktifkan"}</button></div></td></tr>)}</tbody></table></div> : <Empty title="Belum ada anggota" detail="Tambahkan anggota melalui formulir di atas." />}
          </Card>
          {selectedMemberId ? (() => {
            const selected = members.find(item => item.id === selectedMemberId);
            if (!selected) return null;
            const memberSavings = savingsTransactions.filter(item => item.memberId === selectedMemberId);
            const memberLoans = loans.filter(item => item.memberId === selectedMemberId);
            const memberPayments = installments.filter(item => item.memberId === selectedMemberId);
            return <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Profil dan riwayat anggota</p><h2 className="mt-1 text-lg font-semibold">{selected.name}</h2><p className="text-xs text-slate-500">No. {selected.memberNo} · Bergabung {dateLabel(selected.joinDate || "")}</p></div>
                <button className={buttonSecondary} onClick={() => setSelectedMemberId("")}><X size={15}/>Tutup</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Simpanan pokok</p><p className="mt-1 font-bold">{money(selected.savingsBalances?.principal)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Simpanan wajib</p><p className="mt-1 font-bold">{money(selected.savingsBalances?.mandatory)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Simpanan sukarela</p><p className="mt-1 font-bold">{money(selected.savingsBalances?.voluntary)}</p></div>
              </div>
              <h3 className="mt-5 font-semibold">Pinjaman anggota</h3>
              {memberLoans.length ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead><tr className="border-b text-xs text-slate-400"><th className="py-2">Sumber</th><th>Pokok awal</th><th>Sisa pokok</th><th>Status</th></tr></thead><tbody>{memberLoans.map(item=><tr key={item.id} className="border-b border-slate-50"><td className="py-2">{item.source}</td><td>{money(item.principal)}</td><td>{money(item.outstandingPrincipal)}</td><td><Status value={item.status}/></td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-500">Belum ada pinjaman.</p>}
              <h3 className="mt-5 font-semibold">Riwayat pembayaran</h3>
              {memberPayments.length ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead><tr className="border-b text-xs text-slate-400"><th className="py-2">Tanggal</th><th>Jenis</th><th>Pokok</th><th>Bunga</th><th>Total</th></tr></thead><tbody>{memberPayments.map(item=><tr key={item.id} className="border-b border-slate-50"><td className="py-2">{dateLabel(item.date)}</td><td>{item.kind==="payoff"?"Pelunasan":"Angsuran ke-"+item.installmentNumber}</td><td>{money(item.principalPaid)}</td><td>{money(item.interestPaid)}</td><td>{money(item.totalPaid)}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-500">Belum ada pembayaran pinjaman.</p>}
              <h3 className="mt-5 font-semibold">Riwayat simpanan</h3>
              {memberSavings.length ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead><tr className="border-b text-xs text-slate-400"><th className="py-2">Tanggal</th><th>Jenis</th><th>Arah</th><th>Nominal</th></tr></thead><tbody>{memberSavings.map(item=><tr key={item.id} className="border-b border-slate-50"><td className="py-2">{dateLabel(item.date)}</td><td>{item.type}</td><td>{item.direction==="deposit"?"Setoran":"Penarikan"}</td><td>{money(item.amount)}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-slate-500">Belum ada transaksi simpanan.</p>}
            </Card>;
          })() : null}
        </div> : null}

        {tab === "savings" ? <div className="space-y-4">
          <Card><h2 className="font-semibold">Catat transaksi simpanan</h2><p className="mt-1 text-xs text-slate-500">Setoran dan penarikan langsung memperbarui saldo anggota serta buku kas.</p>
            <form onSubmit={saveSavings} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Anggota"><select className={inputClass} required value={savingForm.memberId} onChange={e=>setSavingForm({...savingForm,memberId:e.target.value})}><option value="">Pilih anggota</option>{activeMembers.map(m=><option key={m.id} value={m.id}>{m.memberNo} · {m.name}</option>)}</select></Field>
              <Field label="Jenis simpanan"><select className={inputClass} value={savingForm.type} onChange={e=>setSavingForm({...savingForm,type:e.target.value as SavingType})}><option value="principal">Simpanan pokok</option><option value="mandatory">Simpanan wajib</option><option value="voluntary">Simpanan sukarela</option></select></Field>
              <Field label="Jenis transaksi"><select className={inputClass} value={savingForm.direction} onChange={e=>setSavingForm({...savingForm,direction:e.target.value as Direction})}><option value="deposit">Setoran</option><option value="withdrawal">Penarikan</option></select></Field>
              <Field label="Nominal (Rp)"><input className={inputClass} type="number" min="1" step="1" required value={savingForm.amount} onChange={e=>setSavingForm({...savingForm,amount:e.target.value})} placeholder="0" /></Field>
              <Field label="Tanggal transaksi"><input className={inputClass} type="date" required value={savingForm.date} onChange={e=>setSavingForm({...savingForm,date:e.target.value})} /></Field>
              <Field label="Catatan"><input className={inputClass} value={savingForm.note} onChange={e=>setSavingForm({...savingForm,note:e.target.value})} placeholder="Keterangan (opsional)" /></Field>
              <div className="sm:col-span-2 xl:col-span-3"><button className={buttonPrimary} disabled={busy==="savings"}>{busy==="savings"?<Loader2 size={16} className="animate-spin"/>:<Plus size={16}/>}Simpan transaksi simpanan</button></div>
            </form>
          </Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Simpanan pokok" value={money(members.reduce((s,m)=>s+Number(m.savingsBalances?.principal||0),0))} icon={Wallet}/>
            <Stat label="Simpanan wajib" value={money(members.reduce((s,m)=>s+Number(m.savingsBalances?.mandatory||0),0))} icon={Wallet}/>
            <Stat label="Simpanan sukarela" value={money(members.reduce((s,m)=>s+Number(m.savingsBalances?.voluntary||0),0))} icon={Wallet}/>
          </div>
          <Card><h2 className="mb-4 font-semibold">Riwayat transaksi simpanan</h2>
            {savingsTransactions.length?<div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Tanggal</th><th>Anggota</th><th>Jenis</th><th>Arah</th><th className="text-right">Nominal</th><th>Periode</th><th>Aksi</th></tr></thead><tbody>{savingsTransactions.map(t=><tr key={t.id} className="border-b border-slate-50"><td className="py-3">{dateLabel(t.date)}</td><td className="font-medium">{t.memberName}</td><td>{t.type==="principal"?"Pokok":t.type==="mandatory"?"Wajib":"Sukarela"}</td><td><Status value={t.direction==="deposit"?"income":"expense"}/></td><td className="text-right font-semibold">{money(t.amount)}</td><td>{periodLabel(t.periodId)}</td><td>{t.reversalOf?"Pembalikan":savingsTransactions.some(x=>x.reversalOf===t.id)?"Sudah dibalik":<button className="text-xs font-semibold text-rose-700 hover:underline" disabled={busy==="reverse-savings"} onClick={()=>void reverseSavings(t)}>Batalkan</button>}</td></tr>)}</tbody></table></div>:<Empty title="Belum ada transaksi simpanan" detail="Catat setoran atau penarikan pertama melalui formulir di atas."/>}
          </Card>
        </div> : null}

        {tab === "loans" ? <div className="space-y-4">
          <Card><h2 className="font-semibold">Pengajuan pinjaman</h2><p className="mt-1 text-xs text-slate-500">Buat pengajuan, lalu administrator menyetujui dan mencairkan pinjaman.</p>
            <form onSubmit={submitLoanApplication} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Anggota"><select className={inputClass} required value={applicationForm.memberId} onChange={e=>setApplicationForm({...applicationForm,memberId:e.target.value})}><option value="">Pilih anggota aktif</option>{activeMembers.map(m=><option key={m.id} value={m.id}>{m.memberNo} · {m.name}</option>)}</select></Field>
              <Field label="Jumlah pinjaman (Rp)"><input className={inputClass} type="number" min="1" required value={applicationForm.amount} onChange={e=>setApplicationForm({...applicationForm,amount:e.target.value})} placeholder="0"/></Field>
              <Field label="Tenor (bulan)"><input className={inputClass} type="number" min="1" max="120" required value={applicationForm.termMonths} onChange={e=>setApplicationForm({...applicationForm,termMonths:e.target.value})}/></Field>
              <Field label="Sumber pinjaman"><select className={inputClass} value={applicationForm.source} onChange={e=>setApplicationForm({...applicationForm,source:e.target.value})}><option value="KOPERASI">Dana Koperasi</option><option value="MANDIRI">Bank Mandiri</option><option value="BRI">Bank BRI</option></select></Field>
              <Field label="Bunga per bulan (%)"><input className={inputClass} type="number" min="0" step="0.01" required value={applicationForm.interestRate} onChange={e=>setApplicationForm({...applicationForm,interestRate:e.target.value})}/></Field>
              <Field label="Tanggal rencana pencairan"><input className={inputClass} type="date" required value={applicationForm.date} onChange={e=>setApplicationForm({...applicationForm,date:e.target.value})}/></Field>
              <Field label="Catatan"><input className={inputClass} value={applicationForm.note} onChange={e=>setApplicationForm({...applicationForm,note:e.target.value})} placeholder="Keperluan pinjaman"/></Field>
              <div className="sm:col-span-2 xl:col-span-3"><p className="mb-3 text-xs text-slate-500">Perhitungan bawaan: bunga flat dari pokok awal setiap bulan. Tarif dapat disesuaikan pada pengajuan.</p><button className={buttonPrimary} disabled={busy==="application"}>{busy==="application"?<Loader2 size={16} className="animate-spin"/>:<Plus size={16}/>}Simpan pengajuan</button></div>
            </form>
          </Card>
          <Card><h2 className="mb-4 font-semibold">Pengajuan menunggu persetujuan</h2>
            {applications.filter(a=>a.status==="pending").length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Anggota</th><th>Jumlah</th><th>Tenor</th><th>Sumber</th><th>Bunga/bln</th><th>Aksi</th></tr></thead><tbody>{applications.filter(a=>a.status==="pending").map(a=><tr key={a.id} className="border-b border-slate-50"><td className="py-3 font-medium">{a.memberName}</td><td>{money(a.amount)}</td><td>{a.termMonths} bulan</td><td>{a.source}</td><td>{(Number(a.interestRate||0)*100).toFixed(2)}%</td><td><div className="flex gap-2"><button className="text-xs font-semibold text-emerald-800 hover:underline" onClick={()=>void approveApplication(a)}>Setujui & cairkan</button><button className="text-xs font-semibold text-rose-700 hover:underline" onClick={()=>void rejectApplication(a)}>Tolak</button></div></td></tr>)}</tbody></table></div>:<Empty title="Tidak ada pengajuan tertunda" detail="Pengajuan pinjaman baru akan muncul di sini."/>}
          </Card>
          <Card><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Daftar pinjaman</h2><p className="text-xs text-slate-500">{fmtNumber(loans.length)} pinjaman tercatat</p></div><div className="relative w-full sm:w-64"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari anggota/sumber..."/></div></div>
            {filteredLoans.length?<div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Anggota</th><th>Sumber</th><th className="text-right">Pokok awal</th><th className="text-right">Sisa pokok</th><th>Angsuran ke</th><th>Tenor</th><th>Status</th></tr></thead><tbody>{filteredLoans.map(l=><tr key={l.id} className="border-b border-slate-50"><td className="py-3 font-medium">{l.memberName}</td><td>{l.source}</td><td className="text-right">{money(l.principal)}</td><td className="text-right font-semibold">{money(l.outstandingPrincipal)}</td><td>{l.installmentNumber||0}</td><td>{l.termMonths} bln</td><td><Status value={l.status}/></td></tr>)}</tbody></table></div>:<Empty title="Belum ada pinjaman" detail="Buat pengajuan dan setujui pencairan untuk memulai pencatatan pinjaman."/>}
          </Card>
        </div> : null}

        {tab === "installments" ? <div className="space-y-4">
          <Card><h2 className="font-semibold">Penerimaan angsuran</h2><p className="mt-1 text-xs text-slate-500">Sistem menghitung pokok dan bunga. Satu pinjaman hanya dapat menerima satu pembayaran rutin per periode.</p>
            <form onSubmit={payInstallment} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Pinjaman aktif"><select className={inputClass} required value={installmentForm.loanId} onChange={e=>setInstallmentForm({...installmentForm,loanId:e.target.value})}><option value="">Pilih pinjaman</option>{loans.filter(l=>l.status==="active").map(l=><option key={l.id} value={l.id}>{l.memberName} · {l.source} · sisa {money(l.outstandingPrincipal)}</option>)}</select></Field>
              <Field label="Jenis pembayaran"><select className={inputClass} value={installmentForm.kind} onChange={e=>setInstallmentForm({...installmentForm,kind:e.target.value})}><option value="regular">Angsuran bulanan</option><option value="payoff">Pelunasan dipercepat</option></select></Field>
              <Field label="Tanggal pembayaran"><input className={inputClass} type="date" required value={installmentForm.date} onChange={e=>setInstallmentForm({...installmentForm,date:e.target.value})}/></Field>
              {installmentForm.kind==="payoff"?<Field label="Bunga pelunasan (Rp)"><input className={inputClass} type="number" min="0" value={installmentForm.payoffInterest} onChange={e=>setInstallmentForm({...installmentForm,payoffInterest:e.target.value})}/></Field>:null}
              <Field label="Catatan"><input className={inputClass} value={installmentForm.note} onChange={e=>setInstallmentForm({...installmentForm,note:e.target.value})} placeholder="Opsional"/></Field>
              {installmentForm.loanId?(()=>{const l=loans.find(x=>x.id===installmentForm.loanId);if(!l)return null;const p=installmentForm.kind==="payoff"?Number(l.outstandingPrincipal||0):Math.min(Number(l.monthlyPrincipal||0),Number(l.outstandingPrincipal||0));const i=installmentForm.kind==="payoff"?Number(installmentForm.payoffInterest||0):Number(l.monthlyInterest||0);return <div className="rounded-xl bg-emerald-50 p-3 text-sm"><p className="text-xs font-semibold text-emerald-800">Pratinjau pembayaran</p><div className="mt-2 flex justify-between"><span>Pokok</span><strong>{money(p)}</strong></div><div className="mt-1 flex justify-between"><span>Bunga</span><strong>{money(i)}</strong></div><div className="mt-2 flex justify-between border-t border-emerald-100 pt-2"><span>Total</span><strong>{money(p+i)}</strong></div></div>;})():null}
              <div className="sm:col-span-2 xl:col-span-3"><button className={buttonPrimary} disabled={busy==="installment"||!loans.some(l=>l.status==="active")}>{busy==="installment"?<Loader2 size={16} className="animate-spin"/>:<Banknote size={16}/>}Catat pembayaran</button></div>
            </form>
          </Card>
          <Card><h2 className="mb-4 font-semibold">Riwayat pembayaran angsuran</h2>
            {installments.length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Tanggal</th><th>Anggota</th><th>Jenis</th><th>Ke</th><th className="text-right">Pokok</th><th className="text-right">Bunga</th><th className="text-right">Total</th><th className="text-right">Sisa</th><th>Aksi</th></tr></thead><tbody>{installments.map(t=><tr key={t.id} className="border-b border-slate-50"><td className="py-3">{dateLabel(t.date)}</td><td className="font-medium">{t.memberName}</td><td>{t.kind==="payoff"?"Pelunasan":t.kind==="reversal"?"Pembalikan":"Rutin"}</td><td>{t.installmentNumber||"—"}</td><td className="text-right">{money(t.principalPaid)}</td><td className="text-right">{money(t.interestPaid)}</td><td className="text-right font-semibold">{money(t.totalPaid)}</td><td className="text-right">{money(t.remainingPrincipal)}</td><td>{t.kind==="reversal"||t.reversalOf?"Pembalikan":installments.some(x=>x.reversalOf===t.id)?"Sudah dibalik":<button className="text-xs font-semibold text-rose-700 hover:underline" disabled={busy==="reverse-installment"} onClick={()=>void reverseInstallment(t)}>Batalkan</button>}</td></tr>)}</tbody></table></div>:<Empty title="Belum ada angsuran" detail="Pembayaran akan muncul setelah dicatat melalui formulir di atas."/>}
          </Card>
        </div> : null}

        {tab === "cash" ? <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3"><Stat label="Saldo kas/bank" value={money(cashBalance)} icon={CircleDollarSign}/><Stat label="Total penerimaan" value={money(cashTransactions.filter(t=>t.type==="income").reduce((s,t)=>s+Number(t.amount||0),0))} icon={ArrowDownCircle}/><Stat label="Total pengeluaran" value={money(cashTransactions.filter(t=>t.type==="expense").reduce((s,t)=>s+Number(t.amount||0),0))} icon={ArrowUpCircle}/></div>
          <Card><h2 className="font-semibold">Catat kas masuk/keluar</h2><p className="mt-1 text-xs text-slate-500">Transaksi otomatis membentuk jurnal debit dan kredit.</p>
            <form onSubmit={saveCashTransaction} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Jenis transaksi"><select className={inputClass} value={cashForm.type} onChange={e=>setCashForm({...cashForm,type:e.target.value})}><option value="income">Kas masuk</option><option value="expense">Kas keluar</option></select></Field>
              <Field label="Kategori"><select className={inputClass} value={cashForm.category} onChange={e=>setCashForm({...cashForm,category:e.target.value})}><option>Operasional</option><option>Administrasi</option><option>Perlengkapan</option><option>Pendapatan lain-lain</option><option>Biaya rapat</option><option>Biaya bank</option><option>Lainnya</option></select></Field>
              <Field label="Nominal (Rp)"><input className={inputClass} type="number" min="1" required value={cashForm.amount} onChange={e=>setCashForm({...cashForm,amount:e.target.value})} placeholder="0"/></Field>
              <Field label="Tanggal"><input className={inputClass} type="date" required value={cashForm.date} onChange={e=>setCashForm({...cashForm,date:e.target.value})}/></Field>
              <Field label="Keterangan"><input className={inputClass} value={cashForm.note} onChange={e=>setCashForm({...cashForm,note:e.target.value})} placeholder="Uraian transaksi"/></Field>
              <div className="sm:col-span-2 xl:col-span-4"><button className={buttonPrimary} disabled={busy==="cash"}>{busy==="cash"?<Loader2 size={16} className="animate-spin"/>:<Plus size={16}/>}Simpan transaksi kas</button></div>
            </form>
          </Card>
          <Card><h2 className="mb-4 font-semibold">Buku kas</h2>
            {cashTransactions.length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Tanggal</th><th>Kategori</th><th>Keterangan</th><th>Periode</th><th className="text-right">Masuk</th><th className="text-right">Keluar</th><th>Aksi</th></tr></thead><tbody>{cashTransactions.map(t=><tr key={t.id} className="border-b border-slate-50"><td className="py-3">{dateLabel(t.date)}</td><td>{t.category}</td><td>{t.note||"—"}</td><td>{periodLabel(t.periodId)}</td><td className="text-right text-emerald-700">{t.type==="income"?money(t.amount):"—"}</td><td className="text-right text-rose-700">{t.type==="expense"?money(t.amount):"—"}</td><td>{t.reversalOf?"Pembalikan":t.relatedType?"—":cashTransactions.some(x=>x.reversalOf===t.id)?"Sudah dibalik":<button className="text-xs font-semibold text-rose-700 hover:underline" disabled={busy==="reverse-cash"} onClick={()=>void reverseCashTransaction(t)}>Batalkan</button>}</td></tr>)}</tbody></table></div>:<Empty title="Buku kas masih kosong" detail="Catat transaksi kas atau lakukan transaksi simpanan/pinjaman."/>}
          </Card>
        </div> : null}

        {tab === "reports" ? <div className="space-y-4">
          <Card><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Laporan keuangan</h2><p className="mt-1 text-xs text-slate-500">Ringkasan dihitung dari transaksi dan jurnal yang tersimpan.</p></div><Field label="Filter periode"><select className={inputClass+" min-w-48"} value={reportPeriod} onChange={e=>setReportPeriod(e.target.value)}><option value="all">Semua periode</option>{periods.map(p=><option key={p.id} value={p.id}>{p.periodLabel||p.id}</option>)}</select></Field></div></Card>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Simpanan anggota" value={money(totalSavings)} note="Saldo saat ini" icon={Wallet}/>
            <Stat label="Sisa piutang pinjaman" value={money(outstandingLoans)} note="Pinjaman aktif" icon={Landmark} tone="blue"/>
            <Stat label="Bunga pinjaman diterima" value={money(filteredInstallments.reduce((s,t)=>s+Number(t.interestPaid||0),0))} note="Periode terpilih" icon={TrendingUp}/>
            <Stat label="SHU sementara" value={money(netSurplus)} note="Pendapatan dikurangi beban" icon={BarChart3} tone="amber"/>
          </div>
          <Card><h2 className="mb-4 font-semibold">Neraca saldo / buku besar</h2>
            {trialBalance.length?<div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Kode akun</th><th>Nama akun</th><th className="text-right">Debit</th><th className="text-right">Kredit</th></tr></thead><tbody>{trialBalance.map(t=><tr key={t.code} className="border-b border-slate-50"><td className="py-3">{t.code}</td><td>{t.name}</td><td className="text-right">{money(t.debit)}</td><td className="text-right">{money(t.credit)}</td></tr>)}</tbody><tfoot><tr className="font-bold"><td className="py-3" colSpan={2}>Total</td><td className="text-right">{money(trialBalance.reduce((s,t)=>s+t.debit,0))}</td><td className="text-right">{money(trialBalance.reduce((s,t)=>s+t.credit,0))}</td></tr></tfoot></table></div>:<Empty title="Belum ada jurnal" detail="Jurnal terbentuk otomatis dari transaksi simpanan, pinjaman, angsuran, dan kas."/>}
          </Card>
          <Card><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Jurnal umum</h2><p className="mt-1 text-xs text-slate-500">{fmtNumber(filteredJournals.length)} jurnal pada filter terpilih</p></div><ClipboardList size={19} className="text-emerald-700"/></div>
            {filteredJournals.length?<div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Tanggal</th><th>Periode</th><th>Uraian</th><th className="text-right">Debit</th><th className="text-right">Kredit</th></tr></thead><tbody>{filteredJournals.map(j=><tr key={j.id} className="border-b border-slate-50"><td className="py-3">{dateLabel(j.date)}</td><td>{j.periodId}</td><td>{j.memo}</td><td className="text-right">{money(j.totalDebit)}</td><td className="text-right">{money(j.totalCredit)}</td></tr>)}</tbody></table></div>:<Empty title="Belum ada jurnal" detail="Jurnal akan dibuat otomatis saat transaksi disimpan."/>}
          </Card>
          <div className="flex flex-wrap gap-2"><button className={buttonPrimary} onClick={exportReports}><Download size={16}/>Unduh laporan Excel</button><button className={buttonSecondary} onClick={()=>window.print()}><Printer size={16}/>Cetak / simpan PDF</button><button className={buttonSecondary} disabled={busy==="publish"} onClick={()=>void publishSummary()}>{busy==="publish"?<Loader2 size={16} className="animate-spin"/>:<ShieldCheck size={16}/>}Publikasikan ringkasan publik</button></div>
        </div> : null}

        {tab === "periods" ? <div className="space-y-4">
          <Card><h2 className="font-semibold">Pengelolaan periode bulanan</h2><p className="mt-1 text-sm text-slate-500">Periode dibuat otomatis berdasarkan tanggal transaksi pertama. Tutup periode setelah seluruh transaksi dan rekonsiliasi selesai.</p>
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">Periode yang sudah ditutup tidak menerima transaksi baru. Penutupan tidak dapat dibatalkan dari aplikasi agar laporan historis tetap konsisten.</div>
          </Card>
          <Card><h2 className="mb-4 font-semibold">Daftar periode</h2>
            {periods.length?<div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="py-3">Periode</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>{periods.map(p=><tr key={p.id} className="border-b border-slate-50"><td className="py-3 font-semibold">{p.periodLabel||p.id}</td><td><Status value={p.status}/></td><td>{p.createdAt?.seconds?dateLabel(new Date(p.createdAt.seconds*1000).toISOString().slice(0,10)):"—"}</td><td>{p.status==="open"?<button className="text-xs font-semibold text-rose-700 hover:underline" disabled={busy==="period"} onClick={()=>void closePeriod(p)}>Tutup periode</button>:<span className="text-xs text-slate-400">Terkunci</span>}</td></tr>)}</tbody></table></div>:<Empty title="Belum ada periode" detail="Periode akan terbentuk otomatis ketika transaksi pertama disimpan."/>}
          </Card>
        </div> : null}
      </main>
    </div> : <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
      <section className="soft-grid relative overflow-hidden rounded-[2rem] border border-emerald-100 bg-white px-6 py-10 shadow-soft sm:px-10 lg:px-14 lg:py-14">
        <div className="relative z-10 max-w-3xl"><span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-emerald-800"><ShieldCheck size={14}/> Sistem Informasi Koperasi</span>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">Koperasi Pegawai Negeri<br/><span className="text-emerald-800">Kejaksaan Negeri Padang</span></h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">Sistem pengelolaan anggota, simpanan, pinjaman, angsuran, kas, dan laporan keuangan koperasi. Informasi pribadi dan transaksi hanya dapat diakses pengelola yang berwenang.</p>
        </div><div className="pointer-events-none absolute -right-16 -top-20 h-80 w-80 rounded-full border-[48px] border-emerald-50"/><div className="pointer-events-none absolute -bottom-24 right-20 h-64 w-64 rounded-full bg-emerald-50/70"/>
      </section>
      <section className="mt-8"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Informasi publik</p><h2 className="mt-1 text-xl font-semibold">Ringkasan koperasi</h2></div><span className="text-xs text-slate-400">{publicSummary?.updatedAt?.seconds?"Diperbarui "+dateLabel(new Date(publicSummary.updatedAt.seconds*1000).toISOString().slice(0,10)):"Belum dipublikasikan"}</span></div>
        {publicSummary?<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Anggota aktif" value={fmtNumber(publicSummary.memberCount)} icon={Users}/><Stat label="Total simpanan" value={money(publicSummary.savingsTotal)} icon={Wallet}/><Stat label="Sisa pinjaman" value={money(publicSummary.outstandingTotal)} icon={Landmark}/><Stat label="Saldo kas/bank" value={money(publicSummary.cashBalance)} icon={CircleDollarSign}/></div>:<Empty title="Ringkasan belum tersedia" detail="Pengelola akan memublikasikan ringkasan setelah laporan diperiksa."/>}
      </section>
      <section className="mt-8 grid gap-4 md:grid-cols-2"><Card><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-800"><ShieldCheck size={20}/></div><div><h3 className="font-semibold">Privasi anggota</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Data pribadi dan rincian transaksi hanya tersedia bagi administrator aktif.</p></div></div></Card><Card><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-800"><BarChart3 size={20}/></div><div><h3 className="font-semibold">Laporan koperasi</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Ringkasan publik menampilkan angka agregat yang telah disetujui pengelola.</p></div></div></Card></section>
      <footer className="mt-12 border-t border-emerald-100 py-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} KPN Koperasi Kejaksaan Negeri Padang</footer>
    </main>}

    {showLogin && !isAdmin ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 shadow-2xl sm:p-8">
      <div className="mb-6 flex items-start justify-between"><div><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-800 text-white"><LockKeyhole size={20}/></div><h2 className="text-xl font-semibold">Login pengelola</h2><p className="mt-1 text-sm text-slate-500">Masuk dengan akun administrator koperasi.</p></div><button onClick={()=>setShowLogin(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18}/></button></div>
      {error?<div className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>:null}
      <form onSubmit={handleLogin} className="space-y-4"><Field label="Email administrator"><input className={inputClass} type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Password"><input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></Field><button className={"w-full "+buttonPrimary} disabled={loginBusy}>{loginBusy?<Loader2 size={16} className="animate-spin"/>:<LockKeyhole size={16}/>}Masuk</button></form>
      <p className="mt-4 text-center text-[11px] text-slate-400">Akses diperiksa melalui Firebase Authentication dan dokumen administrator.</p>
    </div></div>:null}

    {showPassword && isAdmin ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
      <div className="mb-6 flex items-start justify-between"><div><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-800 text-white"><KeyRound size={20}/></div><h2 className="text-xl font-semibold">Ganti password administrator</h2><p className="mt-1 text-sm text-slate-500">Verifikasi password saat ini sebelum mengganti.</p></div><button onClick={()=>setShowPassword(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18}/></button></div>
      <form onSubmit={handlePasswordChange} className="space-y-3"><Field label="Password saat ini"><input className={inputClass} type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></Field><Field label="Password baru"><input className={inputClass} type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></Field><Field label="Ulangi password baru"><input className={inputClass} type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></Field><div className="flex justify-end gap-2 pt-2"><button type="button" className={buttonSecondary} onClick={()=>setShowPassword(false)}>Batal</button><button className={buttonPrimary} disabled={passwordBusy}>{passwordBusy?<Loader2 size={16} className="animate-spin"/>:<KeyRound size={16}/>}Simpan password</button></div></form>
    </div></div>:null}
  </div>;
}
