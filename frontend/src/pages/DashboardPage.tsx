import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUser, useClerk } from "@clerk/clerk-react";
import { useAuth } from "@/hooks/useAuth";
import {
  Zap,
  LayoutDashboard,
  FileText,
  Plus,
  Upload,
  BarChart3,
  LogOut,
  Settings,
  ChevronRight,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  AlertTriangle,
} from "lucide-react";
import { fetchDashboardStats, RecentInvoice } from "@/lib/api/invoiceApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatCurrency } from "@/lib/currency";
import { getExchangeRates, sumInUSD } from "@/lib/exchangeRates";

const NAV_ITEMS = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    path: "/dashboard",
    active: true,
  },
  { icon: FileText, label: "All Invoices", path: "/invoices", active: true },
  { icon: Plus, label: "Create Invoice", path: "/create", active: true },
  // {
  //   icon: Upload,
  //   label: "Scan Invoice",
  //   path: "/scan",
  //   active: false,
  //   soon: true,
  // },
  // {
  //   icon: BarChart3,
  //   label: "Insights",
  //   path: "/insights",
  //   active: false,
  //   soon: true,
  // },
  // { icon: Bot, label: "AI Agent", path: "/agent", active: false, soon: true },
];

const QUICK_ACTIONS = [
  {
    icon: Plus,
    label: "New Invoice",
    desc: "Create with AI chat",
    path: "/create",
    color: "bg-indigo-600",
    textColor: "text-white",
  },
  {
    icon: Upload,
    label: "Scan Invoice",
    desc: "Extract from PDF",
    path: "/scan",
    color: "bg-white",
    textColor: "text-gray-900",
    disabled: true,
  },
  {
    icon: BarChart3,
    label: "View Insights",
    desc: "Revenue analytics",
    path: "/insights",
    color: "bg-white",
    textColor: "text-gray-900",
    disabled: true,
  },
];

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  confirmed: "text-emerald-600 bg-emerald-50",
  sent: "bg-blue-50 text-blue-600",
  paid: "bg-emerald-50 text-emerald-600",
  overdue: "bg-red-50 text-red-500",
};

export function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { syncUser, getUserProfile } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [stats, setStats] = useState({
    totalInvoices: 0,
    pendingUSD: 0,
    paidUSD: 0,
    overdueCount: 0,
  });
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [showOnboardingBanner, setShowOnboardingBanner] = useState(false);

  const STATS = [
    {
      label: "Total Invoices",
      value: statsLoading ? "..." : stats.totalInvoices.toString(),
      sub: "All time",
      icon: FileText,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
    {
      label: "Pending Payment",
      value: statsLoading ? "..." : formatCurrency(stats.pendingUSD, "USD"),
      sub: "Outstanding · in USD",
      icon: Clock,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Paid This Month",
      value: statsLoading ? "..." : formatCurrency(stats.paidUSD, "USD"),
      sub:
        new Date().toLocaleString("en-IN", {
          month: "long",
          year: "numeric",
        }) + " · in USD",
      icon: CheckCircle2,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Overdue",
      value: statsLoading ? "..." : stats.overdueCount.toString(),
      sub: "Needs attention",
      icon: AlertCircle,
      color: "text-red-500",
      bg: "bg-red-50",
    },
  ];

  useEffect(() => {
    if (!isLoaded || !user) return;
    syncUser();

    Promise.all([
      getUserProfile(),
      fetchDashboardStats(user.id),
      getExchangeRates(),
    ])
      .then(([profile, data, rates]) => {
        if (!profile?.isOnboarded) {
          setShowOnboardingBanner(true);
        }
        setStats({
          totalInvoices: data.stats.totalInvoices,
          pendingUSD: sumInUSD(data.stats.pendingByCurrency, rates),
          paidUSD: sumInUSD(data.stats.paidByCurrency, rates),
          overdueCount: data.stats.overdueCount,
        });
        setRecentInvoices(data.recentInvoices);
      })
      .catch(console.error)
      .finally(() => setStatsLoading(false));
  }, [syncUser, user]);

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex">
      {/* ── Sidebar ── */}
      <aside
        className={`
        flex flex-col bg-white border-r border-gray-100 transition-all duration-300
        ${collapsed ? "w-16" : "w-60"} fixed top-0 left-0 h-full z-10
      `}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-3 px-4 py-5 border-b border-gray-100 cursor-pointer"
          onClick={() => navigate("/dashboard")}
        >
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "#4F46E5" }}
          >
            <Zap className="w-4 h-4 text-white" fill="white" />
          </div>
          {!collapsed && (
            <span className="font-bold text-gray-900 text-base tracking-tight">
              Ledger
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className={`ml-auto w-6 h-6 text-gray-400 hover:text-gray-600 ${
              collapsed ? "rotate-180" : ""
            }`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Button
                key={item.path}
                variant="ghost"
                disabled={!item.active}
                onClick={() => item.active && navigate(item.path)}
                className={`
                  w-full justify-start gap-3 px-3 py-2.5 h-auto rounded-xl text-sm font-medium
                  ${
                    isActive
                      ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-600"
                      : item.active
                      ? "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      : "text-gray-400 cursor-not-allowed hover:bg-transparent"
                  }
                `}
              >
                <item.icon
                  className={`w-4 h-4 flex-shrink-0 ${
                    isActive ? "text-indigo-600" : ""
                  }`}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    {/* {item.soon && (
                      <Badge
                        variant="secondary"
                        className="text-xs px-1.5 py-0 rounded-full font-normal h-4"
                      >
                        Soon
                      </Badge>
                    )} */}
                  </>
                )}
              </Button>
            );
          })}
        </nav>

        <Separator />

        {/* Bottom */}
        <div className="px-3 py-4 space-y-1">
          <Button
            variant="ghost"
            onClick={() => navigate("/profile")}
            className={`w-full justify-start gap-3 rounded-xl text-sm font-medium text-gray-600 ${
              collapsed ? "justify-center px-0" : ""
            }`}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span> Company Settings</span>}
          </Button>

          {!collapsed && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 mt-2">
              <Avatar className="w-7 h-7 flex-shrink-0">
                <AvatarImage src={user?.imageUrl} />
                <AvatarFallback className="bg-indigo-100 text-indigo-600 text-xs font-semibold">
                  {user?.firstName?.[0] || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">
                  {user?.fullName}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => signOut()}
                className="w-6 h-6 text-gray-400 hover:text-gray-600"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {collapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut()}
              className="w-full rounded-xl text-gray-400 hover:text-gray-600"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div
        className={`flex-1 transition-all duration-300 ${
          collapsed ? "ml-16" : "ml-60"
        }`}
      >
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-8 py-4 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
              <p className="text-xs text-gray-400">
                Welcome back, {user?.firstName}
              </p>
            </div>
            <Button
              onClick={() => navigate("/create")}
              className="gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-0.5 transition-all"
              style={{ boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }}
            >
              <Plus className="w-4 h-4" />
              New Invoice
            </Button>
          </div>
        </header>

        <main className="px-8 py-8">
          {/* ── Onboarding reminder banner ── */}
          {showOnboardingBanner && (
            <div className="mb-6 flex items-center gap-4 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  Complete your company profile
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Your comapny name, GSTIN and bank details will auto-fill on
                  every invoice you create.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  onClick={() => navigate("/profile")}
                  className="rounded-xl text-xs bg-amber-600 hover:bg-amber-700 h-8 px-3"
                >
                  Setup Now
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowOnboardingBanner(false)}
                  className="w-7 h-7 text-amber-500 hover:text-amber-700 hover:bg-amber-100"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className="bg-white rounded-2xl border border-gray-100 shadow-soft p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    {stat.label}
                  </p>
                  <div
                    className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}
                  >
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
              </div>
            ))}
          </div>

          {/* Two column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Quick actions */}
            <div className="lg:col-span-1">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Quick Actions
              </h3>
              <div className="space-y-3">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => !action.disabled && navigate(action.path)}
                    disabled={action.disabled}
                    className={`
                      w-full flex items-center gap-3 p-4 rounded-2xl border transition-all duration-150 text-left
                      ${
                        action.disabled
                          ? "opacity-50 cursor-not-allowed border-gray-100 bg-white"
                          : action.color === "bg-indigo-600"
                          ? "border-indigo-600 hover:-translate-y-0.5 hover:shadow-lg"
                          : "border-gray-100 hover:-translate-y-0.5 hover:shadow-soft bg-white"
                      } ${action.color}
                    `}
                    style={
                      action.color === "bg-indigo-600"
                        ? { boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }
                        : {}
                    }
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        action.color === "bg-indigo-600"
                          ? "bg-white/20"
                          : "bg-gray-100"
                      }`}
                    >
                      <action.icon
                        className={`w-4 h-4 ${
                          action.color === "bg-indigo-600"
                            ? "text-white"
                            : "text-gray-600"
                        }`}
                      />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          action.color === "bg-indigo-600"
                            ? "text-white"
                            : "text-gray-900"
                        }`}
                      >
                        {action.label}
                      </p>
                      <p
                        className={`text-xs ${
                          action.color === "bg-indigo-600"
                            ? "text-indigo-200"
                            : "text-gray-400"
                        }`}
                      >
                        {action.desc}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Recent invoices */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  Recent Invoices
                </h3>
                <Button
                  variant="link"
                  onClick={() => navigate("/invoices")}
                  className="text-xs text-indigo-600 p-0 h-auto"
                >
                  View all
                </Button>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-soft overflow-hidden">
                {statsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : recentInvoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                      <TrendingUp className="w-6 h-6 text-gray-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-900">
                      No invoices yet
                    </p>
                    <p className="text-xs text-gray-400 mt-1 mb-4">
                      Create your first invoice to see it here
                    </p>
                    <Button
                      variant="link"
                      onClick={() => navigate("/create")}
                      className="text-xs text-indigo-600 p-0 h-auto"
                    >
                      Create invoice →
                    </Button>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {["Invoice", "Client", "Amount", "Status"].map((h) => (
                          <th
                            key={h}
                            className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {recentInvoices.map((inv) => {
                        const displayStatus = inv.status;

                        return (
                          <tr
                            key={inv._id}
                            className="hover:bg-gray-50 transition-colors cursor-pointer"
                            onClick={() => navigate(`/invoices/${inv._id}`)}
                          >
                            <td className="px-5 py-3.5">
                              <span className="text-sm font-semibold text-gray-900">
                                {inv.invoiceNumber}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <Avatar className="w-7 h-7 flex-shrink-0">
                                  <AvatarFallback className="bg-indigo-100 text-indigo-600 font-bold text-xs">
                                    {inv.clientName.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm text-gray-700">
                                  {inv.clientName}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="text-sm font-semibold text-gray-900">
                                {formatCurrency(inv.total, inv.currency)}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <Badge
                                className={`capitalize rounded-full text-xs font-medium ${STATUS_BADGE[displayStatus]}`}
                              >
                                {displayStatus}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
