import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store.jsx';
import { Icon, Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Report from './pages/Report.jsx';
import CompanyReport from './pages/CompanyReport.jsx';
import Entry from './pages/Entry.jsx';
import StatusBoard from './pages/StatusBoard.jsx';
import TreeSetup from './pages/TreeSetup.jsx';
import Heads from './pages/Heads.jsx';
import Formats from './pages/Formats.jsx';
import Mapping from './pages/Mapping.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';

const ROLE_LABEL = { admin: 'Group Finance (Admin)', executive: 'Executive', cluster: 'Cluster Head', company: 'Company User' };

export default function App() {
  const { user, booting, logout, isAdmin } = useApp();
  if (booting) return <Spinner />;
  if (!user) return <Login />;

  const viewer = user.role !== 'company';
  const enters = user.role === 'admin' || user.role === 'company' || user.role === 'cluster';
  const home = viewer ? '/' : '/entry';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">JW</div>
          <div><b>JW Dash</b><span>{user.settings?.group_name || 'JW Group'} reporting</span></div>
        </div>
        <nav className="nav">
          <div className="sec">Insights</div>
          {viewer && <NavLink to="/" end><Icon name="dash" /><span>Dashboard</span></NavLink>}
          {viewer && <NavLink to="/report"><Icon name="report" /><span>Consolidated report</span></NavLink>}
          <NavLink to="/company"><Icon name="building" /><span>Company reports</span></NavLink>
          <NavLink to="/status"><Icon name="status" /><span>Filing status</span></NavLink>
          {enters && <><div className="sec">Reporting</div>
            <NavLink to="/entry"><Icon name="entry" /><span>Enter figures</span></NavLink></>}
          {isAdmin && <>
            <div className="sec">Setup</div>
            <NavLink to="/setup/tree"><Icon name="tree" /><span>Company tree</span></NavLink>
            <NavLink to="/setup/heads"><Icon name="heads" /><span>Group heads</span></NavLink>
            <NavLink to="/setup/formats"><Icon name="format" /><span>Reporting formats</span></NavLink>
            <NavLink to="/setup/mapping"><Icon name="map" /><span>Mapping matrix</span></NavLink>
            <NavLink to="/setup/users"><Icon name="users" /><span>Users & access</span></NavLink>
            <NavLink to="/setup/settings"><Icon name="settings" /><span>Settings & FX</span></NavLink>
            <NavLink to="/setup/audit"><Icon name="audit" /><span>Audit log</span></NavLink>
          </>}
        </nav>
        <div className="me">
          <b>{user.name}</b>
          <div>{ROLE_LABEL[user.role]}</div>
          {user.scope?.length > 0 && <div className="faint">{user.scope[user.scope.length - 1].name}</div>}
          <button className="sm" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={viewer ? <Dashboard /> : <Navigate to={home} />} />
          <Route path="/report" element={viewer ? <Report /> : <Navigate to={home} />} />
          <Route path="/company" element={<CompanyReport />} />
          <Route path="/company/:id" element={<CompanyReport />} />
          <Route path="/status" element={<StatusBoard />} />
          <Route path="/entry" element={<Entry />} />
          <Route path="/entry/:companyId/:freq" element={<Entry />} />
          <Route path="/entry/:companyId/:freq/:key" element={<Entry />} />
          {isAdmin && <>
            <Route path="/setup/tree" element={<TreeSetup />} />
            <Route path="/setup/heads" element={<Heads />} />
            <Route path="/setup/formats" element={<Formats />} />
            <Route path="/setup/formats/:companyId/:freq" element={<Formats />} />
            <Route path="/setup/mapping" element={<Mapping />} />
            <Route path="/setup/users" element={<Users />} />
            <Route path="/setup/settings" element={<Settings />} />
            <Route path="/setup/audit" element={<Audit />} />
          </>}
          <Route path="*" element={<Navigate to={home} />} />
        </Routes>
      </main>
    </div>
  );
}

