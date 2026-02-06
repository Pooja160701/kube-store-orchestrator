const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const k8s = require("@kubernetes/client-node");

const app = express();
app.use(express.json());

const kc = new k8s.KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

const stores = new Map();

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/stores", (req, res) => {
  res.json(Array.from(stores.values()));
});

app.post("/stores", async (req, res) => {
  const storeId = uuidv4().slice(0, 8);
  const namespace = `store-${storeId}`;

  //1. Create DB secret
  await k8sApi.createNamespacedSecret(namespace, {
    metadata: { name: "mysql-secret" },
    stringData: {
      MYSQL_ROOT_PASSWORD: "rootpass",
      MYSQL_DATABASE: "wordpress",
      MYSQL_USER: "wpuser",
      MYSQL_PASSWORD: "wppass"
    }
  });

  // 1. Create DB secret
  await k8sApi.createNamespacedSecret(namespace, {
    metadata: { name: "mysql-secret" },
    stringData: {
      MYSQL_ROOT_PASSWORD: "rootpass",
      MYSQL_DATABASE: "wordpress",
      MYSQL_USER: "wpuser",
      MYSQL_PASSWORD: "wppass"
    }
  });

  // 2. Create PVC for MySQL
  await k8sApi.createNamespacedPersistentVolumeClaim(namespace, {
    metadata: { name: "mysql-pvc" },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: "1Gi"
        }
      }
    }
  });

  // 3. Create MySQL StatefulSet
  await appsApi.createNamespacedStatefulSet(namespace, {
    metadata: { name: "mysql" },
    spec: {
      serviceName: "mysql",
      replicas: 1,
      selector: {
        matchLabels: { app: "mysql" }
      },
      template: {
        metadata: { labels: { app: "mysql" } },
        spec: {
          containers: [
            {
              name: "mysql",
              image: "mysql:8",
              envFrom: [
                {
                  secretRef: { name: "mysql-secret" }
                }
              ],
              ports: [{ containerPort: 3306 }],
              volumeMounts: [
                {
                  name: "mysql-storage",
                  mountPath: "/var/lib/mysql"
                }
              ]
            }
          ]
        }
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "mysql-storage" },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: {
              requests: {
                storage: "1Gi"
              }
            }
          }
        }
      ]
    }
  });

  try {
    await k8sApi.createNamespace({
      metadata: { name: namespace },
    });

    const store = {
      id: storeId,
      namespace,
      status: "Provisioning",
      createdAt: new Date().toISOString(),
    };

    stores.set(storeId, store);

    res.status(201).json(store);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create store namespace" });
  }
});

app.delete("/stores/:id", async (req, res) => {
  const { id } = req.params;
  const store = stores.get(id);

  if (!store) {
    return res.status(404).json({ error: "Store not found" });
  }

  try {
    await k8sApi.deleteNamespace(store.namespace);
    stores.delete(id);
    res.json({ message: "Store deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete store" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});