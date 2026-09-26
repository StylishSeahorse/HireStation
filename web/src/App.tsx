import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe, useSettings, useSetupStatus } from '@/lib/hooks';
import { applyBranding } from '@/lib/branding';
import { Spinner } from '@/components/ui';
import Layout from '@/components/Layout';
import Setup from '@/pages/Setup';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import CalendarPage from '@/pages/Calendar';
import { BookingList, BookingForm, BookingDetail } from '@/pages/Bookings';
import { EquipmentList, EquipmentDetail, Availability } from '@/pages/Equipment';
import { ClientList, ClientDetail } from '@/pages/Clients';
import { StaffList, StaffDetail, MySchedule } from '@/pages/Staff';
import { TemplateList, TemplateEditor, ClauseLibrary } from '@/pages/Contracts';
import Reports from '@/pages/Reports';
import SettingsPage from '@/pages/Settings';

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
  if (setup.data?.needsSetup) return loc.pathname === '/setup' ? <Setup /> : <Navigate to="/setup" replace />;
  if (loc.pathname === '/setup') return <Navigate to="/" replace />;
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Login />;

  return (
    <Layout>
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
    </Layout>
  );
}
