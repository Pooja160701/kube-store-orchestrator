const express = require("express");
const { v4: uuidv4 } = require("uuid");
const k8s = require("@kubernetes/client-node");

const app = express();
app.use(express.json());

/* -----------------------------
   Kubernetes Client Setup
----------------------------- */

const kc = new k8s.KubeConfig();

if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);

const stores = new Map();

/* -----------------------------
   Health Endpoint
----------------------------- */

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* -----------------------------
   List Stores
----------------------------- */

app.get("/stores", (req, res) => {
  res.json(Array.from(stores.values()));
});

/* -----------------------------
   Create Store
----------------------------- */

app.post("/stores", async (req, res) => {
  const storeId = uuidv4().slice(0, 8);
  const namespace = `store-${storeId}`;

  try {
    console.log(`Provisioning store: ${namespace}`);

    /* 1️. Create Namespace */
    await coreApi.createNamespace({
      metadata: { name: namespace },
    });

    /* 2️. Create MySQL Secret */
    await coreApi.createNamespacedSecret(namespace, {
      metadata: { name: "mysql-secret" },
      stringData: {
        MYSQL_ROOT_PASSWORD: "rootpass",
        MYSQL_DATABASE: "wordpress",
        MYSQL_USER: "wpuser",
        MYSQL_PASSWORD: "wppass",
      },
    });

    /* 3️. Create MySQL Headless Service */
    await coreApi.createNamespacedService(namespace, {
      metadata: { name: "mysql" },
      spec: {
        clusterIP: "None",
        selector: { app: "mysql" },
        ports: [{ port: 3306, targetPort: 3306 }],
      },
    });

    /* 4️. Create MySQL StatefulSet */
    await appsApi.createNamespacedStatefulSet(namespace, {
      metadata: { name: "mysql" },
      spec: {
        serviceName: "mysql",
        replicas: 1,
        selector: {
          matchLabels: { app: "mysql" },
        },
        template: {
          metadata: { labels: { app: "mysql" } },
          spec: {
            containers: [
              {
                name: "mysql",
                image: "mysql:8",
                envFrom: [
                  { secretRef: { name: "mysql-secret" } },
                ],
                ports: [{ containerPort: 3306 }],
                volumeMounts: [
                  {
                    name: "mysql-storage",
                    mountPath: "/var/lib/mysql",
                  },
                ],
              },
            ],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "mysql-storage" },
            spec: {
              accessModes: ["ReadWriteOnce"],
              resources: {
                requests: { storage: "1Gi" },
              },
            },
          },
        ],
      },
    });

    /* 5️. Create WordPress Service */
    await coreApi.createNamespacedService(namespace, {
      metadata: { name: "wordpress" },
      spec: {
        selector: { app: "wordpress" },
        ports: [{ port: 80, targetPort: 80 }],
      },
    });

    /* 6️. Create WordPress Deployment */
    await appsApi.createNamespacedDeployment(namespace, {
      metadata: { name: "wordpress" },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: { app: "wordpress" },
        },
        template: {
          metadata: { labels: { app: "wordpress" } },
          spec: {
            containers: [
              {
                name: "wordpress",
                image: "wordpress:php8.2-apache",
                env: [
                  { name: "WORDPRESS_DB_HOST", value: "mysql" },
                  { name: "WORDPRESS_DB_USER", value: "wpuser" },
                  { name: "WORDPRESS_DB_PASSWORD", value: "wppass" },
                  { name: "WORDPRESS_DB_NAME", value: "wordpress" },
                ],
                ports: [{ containerPort: 80 }],
              },
            ],
          },
        },
      },
    });

    /* 7️. Create Ingress */
    console.log("Creating WordPress ingress...");

    await networkingApi.createNamespacedIngress(namespace, {
      metadata: {
        name: "wordpress-ingress",
      },
      spec: {
        ingressClassName: "traefik",
        rules: [
          {
            host: `${namespace}.localhost`,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: "wordpress",
                      port: { number: 80 },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    console.log("Ingress created successfully.");

    const store = {
      id: storeId,
      namespace,
      status: "Provisioning",
      url: `http://${namespace}.localhost:8080`,
      createdAt: new Date().toISOString(),
    };

    stores.set(storeId, store);

    res.status(201).json(store);

  } catch (err) {
    console.error("Provisioning failed:", err.body || err);
    res.status(500).json({ error: "Store provisioning failed" });
  }
});

/* -----------------------------
   Delete Store
----------------------------- */

app.delete("/stores/:id", async (req, res) => {
  const { id } = req.params;
  const store = stores.get(id);

  if (!store) {
    return res.status(404).json({ error: "Store not found" });
  }

  try {
    await coreApi.deleteNamespace(store.namespace);
    stores.delete(id);
    res.json({ message: "Store deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete store" });
  }
});

/* -----------------------------
   Start Server
----------------------------- */

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});