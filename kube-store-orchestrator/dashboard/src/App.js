import { useEffect, useState } from "react";

const API_BASE = "/api";

function App() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchStores = async () => {
    const res = await fetch(`${API_BASE}/stores`);
    const data = await res.json();
    setStores(data);
  };

  useEffect(() => {
    fetchStores();
    const interval = setInterval(fetchStores, 5000);
    return () => clearInterval(interval);
  }, []);

  const createStore = async () => {
    setLoading(true);
    await fetch(`${API_BASE}/stores`, { method: "POST" });
    await fetchStores();
    setLoading(false);
  };

  const deleteStore = async (id) => {
    await fetch(`${API_BASE}/stores/${id}`, { method: "DELETE" });
    await fetchStores();
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>Store Provisioning Dashboard</h1>

      <button onClick={createStore} disabled={loading}>
        {loading ? "Creating..." : "Create New Store"}
      </button>

      <table border="1" cellPadding="10" style={{ marginTop: 20 }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>URL</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => (
            <tr key={store.id}>
              <td>{store.id}</td>
              <td>{store.status}</td>
              <td>
                <a href={store.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </td>
              <td>{new Date(store.createdAt).toLocaleString()}</td>
              <td>
                <button onClick={() => deleteStore(store.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;