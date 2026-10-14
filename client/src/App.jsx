import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
  useEffect(() => setOpen(false), [loc.pathname]);
  if (booting) return <Loading />;
  if (!user) return <Login />;
  const prep = user.role === 'admin' || user.role === 'company_dpo';
  const pending = (inbox?.review.length || 0) + (inbox?.todo.length || 0);

  return (
    <>
      <header className="top">
        <div className="in">
          <div className="brand"><b>JW</b> Dash</div>
          <button className="burger" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}{pending ? <span className="badge-n">{pending}</span> : null}</button>
          <nav className={open ? 'open' : ''}>
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/weekly">Weekly</NavLink>
            <NavLink to="/monthly">Monthly</NavLink>
            <NavLink to="/analytics">Analytics</NavLink>
            {prep && <NavLink to="/enter">Weekly entry</NavLink>}
            {prep && <NavLink to="/close">Month close</NavLink>}
            <NavLink to="/review">Review{pending ? <span className="badge-n">{pending}</span> : null}</NavLink>
            <NavLink to="/status">Status</NavLink>
            <NavLink to="/pipeline">Pipeline</NavLink>
            <NavLink to="/initiatives">Initiatives</NavLink>
            <NavLink to="/budgets">Budgets</NavLink>
            <NavLink to="/companies">Companies</NavLink>
            {isAdmin && <>
              <NavLink to="/lines">Lines</NavLink>
              <NavLink to="/users">Users</NavLink>
              <NavLink to="/settings">Settings</NavLink>
              <NavLink to="/log">Log</NavLink>
            </>}
          </nav>
          <div className={`who ${open ? 'open' : ''}`}>
            <b>{user.name}</b> · {user.role_label}{user.scopes?.length ? ` · ${user.scopes.map((s) => s.name).join(', ')}` : ''}
            {' '}<button className="link" onClick={logout}>sign out</button>
          </div>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/weekly" element={<Weekly />} />
          <Route path="/monthly" element={<Monthly />} />
          <Route path="/enter" element={<Entry />} />
          <Route path="/enter/:cid" element={<Entry />} />
          <Route path="/enter/:cid/:week" element={<Entry />} />
          <Route path="/close" element={<Close />} />
          <Route path="/close/:cid" element={<Close />} />
          <Route path="/close/:cid/:month" element={<Close />} />
          <Route path="/review" element={<Review />} />
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
