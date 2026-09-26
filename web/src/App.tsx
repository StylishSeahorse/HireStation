import { ComponentType, Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe, useSettings, useSetupStatus } from '@/lib/hooks';
import { applyBranding } from '@/lib/branding';
import { Spinner } from '@/components/ui';
import Layout from '@/components/Layout';
// Pages load on demand so heavy libraries (FullCalendar, TipTap) stay out of the initial bundle.
const page = <T extends Record<string, ComponentType<any>>>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const Setup = page(() => import('@/pages/Setup'), 'default');
const Login = page(() => import('@/pages/Login'), 'default');
const Dashboard = page(() => import('@/pages/Dashboard'), 'default');
const CalendarPage = page(() => import('@/pages/Calendar'), 'default');
const BookingList = page(() => import('@/pages/Bookings'), 'BookingList');
const BookingForm = page(() => import('@/pages/Bookings'), 'BookingForm');
const BookingDetail = page(() => import('@/pages/Bookings'), 'BookingDetail');
const EquipmentList = page(() => import('@/pages/Equipment'), 'EquipmentList');
const EquipmentDetail = page(() => import('@/pages/Equipment'), 'EquipmentDetail');
const Availability = page(() => import('@/pages/Equipment'), 'Availability');
const ClientList = page(() => import('@/pages/Clients'), 'ClientList');
const ClientDetail = page(() => import('@/pages/Clients'), 'ClientDetail');
const StaffList = page(() => import('@/pages/Staff'), 'StaffList');
const StaffDetail = page(() => import('@/pages/Staff'), 'StaffDetail');
const MySchedule = page(() => import('@/pages/Staff'), 'MySchedule');
const TemplateList = page(() => import('@/pages/Contracts'), 'TemplateList');
const TemplateEditor = page(() => import('@/pages/Contracts'), 'TemplateEditor');
const ClauseLibrary = page(() => import('@/pages/Contracts'), 'ClauseLibrary');
const Reports = page(() => import('@/pages/Reports'), 'default');
const SettingsPage = page(() => import('@/pages/Settings'), 'default');

export default function App() {
  const setup = useSetupStatus();
  const loc = useLocation();
  const me = useMe();
  const settings = useSettings();

  useEffect(() => {
    if (settings.data) applyBranding({ primaryColour: settings.data.primaryColour, accentColour: settings.data.accentColour, name: settings.data.tradingName || settings.data.legalName });
  }, [settings.data]);

  if (setup.isLoading) return <Spinner />;
  // First run: every route goes to the wizard until the business profile exists.
  if (setup.data?.needsSetup) return loc.pathname === '/setup' ? <Suspense fallback={<Spinner />}><Setup /></Suspense> : <Navigate to="/setup" replace />;
  if (loc.pathname === '/setup') return <Navigate to="/" replace />;
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Suspense fallback={<Spinner />}><Login /></Suspense>;

  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/bookings" element={<BookingList />} />
        <Route path="/bookings/new" element={<BookingForm />} />
        <Route path="/bookings/:id" element={<BookingDetail />} />
        <Route path="/bookings/:id/edit" element={<BookingForm />} />
        <Route path="/equipment" element={<EquipmentList />} />
        <Route path="/equipment/availability" element={<Availability />} />
        <Route path="/equipment/:id" element={<EquipmentDetail />} />
        <Route path="/clients" element={<ClientList />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/staff" element={<StaffList />} />
        <Route path="/staff/:id" element={<StaffDetail />} />
        <Route path="/my-schedule" element={<MySchedule />} />
        <Route path="/contracts" element={<TemplateList />} />
        <Route path="/contracts/clauses" element={<ClauseLibrary />} />
        <Route path="/contracts/:id" element={<TemplateEditor />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}
