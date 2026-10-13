import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './store.jsx';
import { Loading } from './ui.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Weekly from './pages/Weekly.jsx';
import Monthly from './pages/Monthly.jsx';
import Entry from './pages/Entry.jsx';
import Budgets from './pages/Budgets.jsx';
import Status from './pages/Status.jsx';
import Companies from './pages/Companies.jsx';
import Packs from './pages/Packs.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';

export default function App() {
  const { user, booting, logout, isAdmin } = useApp();
  if (booting) return <Loading />;
  if (!user) return <Login />;
  const enters = ['admin', 'company', 'cluster'].includes(user.role);

  return (
    <>
      <header className="top">
        <div className="in">
          <div className="brand"><b>JW</b> Dash</div>
          <nav>
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/weekly">Weekly</NavLink>
            <NavLink to="/monthly">Monthly</NavLink>
            {enters && <NavLink to="/enter">Enter figures</NavLink>}
            <NavLink to="/budgets">Budgets</NavLink>
            <NavLink to="/status">Status</NavLink>
            <NavLink to="/companies">Companies</NavLink>
            {isAdmin && <>
              <NavLink to="/packs">Reporting lines</NavLink>
              <NavLink to="/users">Users</NavLink>
              <NavLink to="/settings">Settings</NavLink>
              <NavLink to="/audit">Log</NavLink>
            </>}
          </nav>
          <div className="who">{user.name}{user.scope?.length ? ` · ${user.scope[user.scope.length - 1].name}` : ''}<button className="link" onClick={logout}>sign out</button></div>
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
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/status" element={<Status />} />
          <Route path="/companies" element={<Companies />} />
          {isAdmin && <>
            <Route path="/packs" element={<Packs />} />
            <Route path="/users" element={<Users />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audit" element={<Audit />} />
          </>}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
