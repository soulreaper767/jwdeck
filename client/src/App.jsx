import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './store.jsx';
import { Loading } from './ui.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Weekly from './pages/Weekly.jsx';
import Monthly from './pages/Monthly.jsx';
import Entry from './pages/Entry.jsx';
import Close from './pages/Close.jsx';
import Review from './pages/Review.jsx';
import Budgets from './pages/Budgets.jsx';
import Status from './pages/Status.jsx';
import Companies from './pages/Companies.jsx';
import Packs from './pages/Packs.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import Analytics from './pages/Analytics.jsx';
import { Pipeline, Initiatives } from './pages/Registers.jsx';

export default function App() {
  const { user, booting, logout, isAdmin, inbox, online, sync, syncNow } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  // signed out (button or expired session): always come back to the start page
  useEffect(() => { if (!booting && !user && loc.pathname !== '/') nav('/', { replace: true }); }, [user, booting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOpen(false); document.querySelectorAll('details.navmore[open]').forEach((d) => d.removeAttribute('open')); }, [loc.pathname]);
  if (booting) return <Loading />;
  if (!user) return <Login />;
  const role = user.role;
  const prep = role === 'admin' || role === 'company_dpo';
  const reviewer = ['company_reviewer', 'cluster_reviewer', 'group_reviewer'].includes(role);
  const exec = role === 'executive';
  const pending = (inbox?.review.length || 0) + (inbox?.todo.length || 0);
  const badge = pending ? <span className="badge-n">{pending}</span> : null;
  const inboxTab = !exec && <NavLink to="/review">{reviewer ? 'Approvals' : role === 'company_dpo' ? 'Tasks' : 'Review'}{badge}</NavLink>;

  return (
    <>
      <header className="top">
        <div className="in">
          <div className="brand"><b>JW</b> Dash</div>
          <button className="burger" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}{pending ? <span className="badge-n">{pending}</span> : null}</button>
          <nav className={open ? 'open' : ''}>
            {reviewer && inboxTab}
            <NavLink to="/" end>Overview</NavLink>
            {prep && <NavLink to="/enter">Weekly entry</NavLink>}
            {prep && <NavLink to="/close">Month close</NavLink>}
            {role === 'company_dpo' && inboxTab}
            <NavLink to="/weekly">Weekly</NavLink>
            <NavLink to="/monthly">Monthly</NavLink>
            {role !== 'company_dpo' && <NavLink to="/analytics">Analytics</NavLink>}
            {role === 'admin' && inboxTab}
            {!exec && <NavLink to="/status">Status</NavLink>}
            <NavLink to="/pipeline">Pipeline</NavLink>
            <NavLink to="/initiatives">Initiatives</NavLink>
            <NavLink to="/budgets">Budgets</NavLink>
            <NavLink to="/companies">{role === 'company_dpo' || role === 'company_reviewer' ? 'Company' : 'Companies'}</NavLink>
            {isAdmin && (
              <details className={`navmore ${['/lines', '/users', '/settings', '/log'].includes(loc.pathname) ? 'on' : ''}`}>
                <summary>Setup</summary>
                <div className="navmore-p">
                  <NavLink to="/lines">Reporting lines</NavLink>
                  <NavLink to="/users">Users</NavLink>
                  <NavLink to="/settings">Settings</NavLink>
                  <NavLink to="/log">Log</NavLink>
                </div>
              </details>
            )}
          </nav>
          <div className={`who ${open ? 'open' : ''}`}>
            <b>{user.name}</b> · {user.role_label}{user.scopes?.length ? ` · ${user.scopes.map((s) => s.name).join(', ')}` : ''}
            {' '}<button className="link" onClick={() => { logout(); nav('/', { replace: true }); }}>sign out</button>
          </div>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/weekly" element={<Weekly />} />
          <Route path="/monthly" element={<Monthly />} />
          <Route path="/enter" element={prep ? <Entry /> : <Navigate to="/" replace />} />
          <Route path="/enter/:cid" element={<Entry />} />
          <Route path="/enter/:cid/:week" element={<Entry />} />
          <Route path="/close" element={prep ? <Close /> : <Navigate to="/" replace />} />
          <Route path="/close/:cid" element={<Close />} />
          <Route path="/close/:cid/:month" element={<Close />} />
          <Route path="/review" element={user.role === 'executive' ? <Navigate to="/" /> : <Review />} />
          <Route path="/status" element={<Status />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/initiatives" element={<Initiatives />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/companies" element={<Companies />} />
          {isAdmin && <>
            <Route path="/lines" element={<Packs />} />
            <Route path="/users" element={<Users />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/log" element={<Audit />} />
          </>}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      {sync?.mode === 'node' ? (
        <div className={`syncbar ${sync.online ? '' : 'off'}`}>
          {sync.online ? `Synced ${sync.lastSync ? new Date(sync.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}` : 'Offline · working locally'}
          {sync.pending ? ` · ${sync.pending} to send` : ''}
          {sync.lastError && sync.online ? ` · ${sync.lastError}` : ''}
          {' '}<button className="link" onClick={syncNow}>sync now</button>
        </div>
      ) : !online && <div className="net">Offline</div>}
    </>
  );
}
