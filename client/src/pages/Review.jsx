import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { Loading, St } from '../ui.jsx';

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const period = (x) => (x.kind === 'month' ? `${MN[Number(x.period.slice(5)) - 1]} ${x.period.slice(0, 4)}` : x.period ? `Week ${x.period.slice(6)} · ${x.period.slice(0, 4)}` : '');
const link = (x) => (x.kind === 'month' ? `/close/${x.company_id}/${x.period}` : x.kind === 'week' ? `/enter/${x.company_id}/${x.period}` : `/companies?c=${x.company_id}`);

function List({ title, items }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h2 className="part">{title} <span className="mute small">{items.length}</span></h2>
      {items.length === 0 ? <div className="empty">Nothing pending.</div> : (
        <div className="wrap">
          <table className="r">
            <thead><tr><th className="l">Company</th><th className="l">Report</th><th className="l">Period</th><th className="l">Status</th><th /></tr></thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <td className="l">{x.company}</td>
                  <td className="l">{x.kind === 'month' ? 'Month close' : x.kind === 'week' ? 'Weekly' : 'Opening position'}</td>
                  <td className="l">{period(x)}</td>
                  <td className="l"><St s={x.status} /></td>
                  <td className="n"><Link to={link(x)}>open ›</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Review() {
  const { inbox, loadInbox, user } = useApp();
  useEffect(() => { loadInbox(); }, [loadInbox]);
  if (!inbox) return <Loading />;
  const reviewer = ['admin', 'group_reviewer', 'cluster_reviewer', 'company_reviewer'].includes(user.role);
  const prep = ['admin', 'company_dpo'].includes(user.role);
  return (
    <>
      <div className="bar"><h2>Review</h2></div>
      {reviewer && <List title="Awaiting my approval" items={inbox.review} />}
      {prep && <List title="To prepare" items={inbox.todo} />}
      {!reviewer && !prep && <div className="empty">Nothing assigned.</div>}
    </>
  );
}
