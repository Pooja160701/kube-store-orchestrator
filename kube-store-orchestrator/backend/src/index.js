const express = require("express");
const { v4: uuidv4 } = require("uuid");
const k8s = require("@kubernetes/client-node");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1); 
app.use(express.json());

/* -----------------------------
   Global State (In-Memory)
----------------------------- */

const stores = new Map();
let totalCreated = 0;
let totalFailed = 0;
let activityLog = [];
let provisioningInProgress = 0;
const MAX_CONCURRENT_PROVISIONING = 3;

const MAX_STORES = 20;

/* -----------------------------
   Rate Limiter (Only for Create)
----------------------------- */

const storeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Rate limit exceeded", retryAfter: 60 }
});

/* -----------------------------
   Kubernetes Client Setup
----------------------------- */

const kc = new k8s.KubeConfig();
process.env.KUBERNETES_SERVICE_HOST
  ? kc.loadFromCluster()
  : kc.loadFromDefault();

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

/* -----------------------------
   Helpers
----------------------------- */

function generatePassword() {
  return crypto.randomBytes(12).toString("hex");
}

async function waitForStoreReady(namespace, storeId) {
  let lastWpReady = false;
  let lastMysqlReady = false;

  for (let i = 0; i < 30; i++) {
    try {
      const wp = await appsApi.readNamespacedDeployment("wordpress", namespace);
      const mysql = await appsApi.readNamespacedStatefulSet("mysql", namespace);

      const wpReady = wp.body.status?.availableReplicas >= 1;
      const mysqlReady = mysql.body.status?.readyReplicas >= 1;

      lastWpReady = wpReady;
      lastMysqlReady = mysqlReady;

      if (wpReady && mysqlReady) {
        const store = stores.get(storeId);
        if (store) {
          store.status = "Ready";
          store.failureReason = null;
        }
        return;
      }
    } catch (err) {
      // optional: log err if needed
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Timeout reached
  const store = stores.get(storeId);
  if (store) {
    store.status = "Failed";

    if (!lastWpReady || !lastMysqlReady) {
      store.failureReason = "Pods not becoming ready in time";
    } else {
      store.failureReason = "Unknown readiness failure";
    }

    totalFailed++;
  }
}

/* -----------------------------
   Health
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
   Metrics
----------------------------- */

app.get("/metrics", (req, res) => {
  const ready = [...stores.values()].filter(s => s.status === "Ready").length;

  res.json({
    totalStores: stores.size,
    readyStores: ready,
    failedStores: totalFailed,
    totalCreated
  });
});

/* -----------------------------
   Activity Log
----------------------------- */

app.get("/activity", (req, res) => {
  res.json(activityLog);
});

/* -----------------------------
   Create Store
----------------------------- */

app.post("/stores", storeLimiter, async (req, res) => {
  if (stores.size >= MAX_STORES) {
    return res.status(400).json({ error: "Store limit reached" });
  }

  if (provisioningInProgress >= MAX_CONCURRENT_PROVISIONING) {
    return res.status(429).json({
      error: "Provisioning limit reached. Try later."
    });
  }

  provisioningInProgress++;

  const storeId = uuidv4().slice(0, 8);
  const namespace = `store-${storeId}`;
  const engine = req.body.engine || "woocommerce";
  const dbPassword = generatePassword();

  try {
    // Check if namespace already exists
    try {
      await coreApi.readNamespace(namespace);
      return res.status(409).json({
        error: "Store already exists",
        namespace
      });
    } catch {
      // Namespace does not exist, create it
      await coreApi.createNamespace({
        metadata: {
          name: namespace,
          labels: {
            "managed-by": "store-platform",
            "store-id": storeId
          }
        }
      });
    }

    // Resource Quota
    await coreApi.createNamespacedResourceQuota(namespace, {
      metadata: { name: "store-quota" },
      spec: {
        hard: {
          "requests.cpu": "500m",
          "requests.memory": "512Mi",
          "limits.cpu": "1",
          "limits.memory": "1Gi",
          "persistentvolumeclaims": "2"
        }
      }
    });

    // Limit Range
    await coreApi.createNamespacedLimitRange(namespace, {
      metadata: { name: "store-limits" },
      spec: {
        limits: [{
          type: "Container",
          default: { cpu: "500m", memory: "512Mi" },
          defaultRequest: { cpu: "100m", memory: "128Mi" }
        }]
      }
    });

    // Network Policies
    await networkingApi.createNamespacedNetworkPolicy(namespace, {
      metadata: { name: "default-deny" },
      spec: {
        podSelector: {},
        policyTypes: ["Ingress", "Egress"]
      }
    });

    await networkingApi.createNamespacedNetworkPolicy(namespace, {
      metadata: { name: "allow-wp-to-mysql" },
      spec: {
        podSelector: { matchLabels: { app: "mysql" }},
        ingress: [{
          from: [{
            podSelector: { matchLabels: { app: "wordpress" }}
          }]
        }]
      }
    });

    // MySQL Secret
    await coreApi.createNamespacedSecret(namespace, {
      metadata: { name: "mysql-secret" },
      stringData: {
        MYSQL_ROOT_PASSWORD: dbPassword,
        MYSQL_DATABASE: "wordpress",
        MYSQL_USER: "wpuser",
        MYSQL_PASSWORD: dbPassword
      }
    });

    // MySQL Headless Service
    await coreApi.createNamespacedService(namespace, {
      metadata: { name: "mysql" },
      spec: {
        clusterIP: "None",
        selector: { app: "mysql" },
        ports: [{ port: 3306 }]
      }
    });

    // Engine Provisioning
    if (engine === "woocommerce") {
      await provisionWooCommerce(namespace, dbPassword);
    } else {
      return res.status(400).json({ error: "Unsupported engine in Round 1" });
    }

    const store = {
      id: storeId,
      namespace,
      engine,
      status: "Provisioning",
      failureReason: null,
      url: `http://${namespace}.localhost`,
      createdAt: new Date().toISOString()
    };

    stores.set(storeId, store);
    totalCreated++;

    activityLog.push({
      action: "CREATE",
      namespace,
      timestamp: new Date().toISOString()
    });

    waitForStoreReady(namespace, storeId);

    return res.status(201).json(store);

  } catch (err) {
    totalFailed++;
    provisioningInProgress--;
    return res.status(500).json({ error: "Provisioning failed" });
  } finally {
    provisioningInProgress--;
  }
});

/* -----------------------------
   Delete Store
----------------------------- */

app.delete("/stores/:id", async (req, res) => {
  const { id } = req.params;
  const store = stores.get(id);

  if (!store) return res.status(404).json({ error: "Not found" });

  try {
    store.status = "Deleting";

    await coreApi.deleteNamespace(store.namespace);

    activityLog.push({
      action: "DELETE",
      namespace: store.namespace,
      timestamp: new Date().toISOString()
    });

    stores.delete(id);

    res.json({ message: "Store deletion initiated" });

  } catch (err) {
    if (err.body?.reason === "NotFound") {
      stores.delete(id);
      return res.json({ message: "Already deleted" });
    }

    res.status(500).json({ error: "Delete failed" });
  }
});

/* -----------------------------
   WooCommerce Provisioner
----------------------------- */

async function provisionWooCommerce(namespace, dbPassword) {
  await appsApi.createNamespacedStatefulSet(namespace, {
    metadata: { name: "mysql" },
    spec: {
      serviceName: "mysql",
      replicas: 1,
      selector: { matchLabels: { app: "mysql" } },
      template: {
        metadata: { labels: { app: "mysql" } },
        spec: {
          containers: [{
            name: "mysql",
            image: "mysql:8",
            envFrom: [{ secretRef: { name: "mysql-secret" } }],
            ports: [{ containerPort: 3306 }]
          }]
        }
      },
      volumeClaimTemplates: [{
        metadata: { name: "mysql-storage" },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "1Gi" } }
        }
      }]
    }
  });

    await coreApi.createNamespacedService(namespace, {
      metadata: { name: "wordpress" },
      spec: {
        selector: { app: "wordpress" },
        ports: [{ port: 80 }]
      }
    });

  await appsApi.createNamespacedDeployment(namespace, {
    metadata: { name: "wordpress" },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "wordpress" } },
      template: {
        metadata: { labels: { app: "wordpress" } },
        spec: {
          containers: [{
            name: "wordpress",
            image: "wordpress:php8.2-apache",
            env: [
              { name: "WORDPRESS_DB_HOST", value: "mysql" },
              { name: "WORDPRESS_DB_USER", value: "wpuser" },
              { name: "WORDPRESS_DB_PASSWORD", value: dbPassword },
              { name: "WORDPRESS_DB_NAME", value: "wordpress" }
            ],
            ports: [{ containerPort: 80 }]
          }]
        }
      }
    }
  });

    await networkingApi.createNamespacedIngress(namespace, {
      metadata: { name: "wordpress-ingress" },
      spec: {
        ingressClassName: "traefik",
        rules: [{
          host: `${namespace}.localhost`,
          http: {
            paths: [{
              path: "/",
              pathType: "Prefix",
              backend: {
                service: { name: "wordpress", port: { number: 80 } }
              }
            }]
          }
        }]
      }
    });
}

/* -----------------------------
   Reconciliation
----------------------------- */

async function reconcileStoresOnStartup() {
  try {
    const nsList = await coreApi.listNamespace();

    const storeNamespaces = nsList.body.items
      .filter(ns => ns.metadata.labels?.["managed-by"] === "store-platform")
      .map(ns => ns.metadata.name);

    for (const namespace of storeNamespaces) {
      const id = namespace.replace("store-", "");

      let status = "Provisioning";
      let failureReason = null;

      try {
        const wp = await appsApi.readNamespacedDeployment("wordpress", namespace);
        const mysql = await appsApi.readNamespacedStatefulSet("mysql", namespace);

        const wpReady = wp.body.status?.availableReplicas >= 1;
        const mysqlReady = mysql.body.status?.readyReplicas >= 1;

        if (wpReady && mysqlReady) {
          status = "Ready";
        }
      } catch (err) {
        status = "Failed";
        failureReason = "Missing or unhealthy resources";
      }

      stores.set(id, {
        id,
        namespace,
        status,
        failureReason,
        url: `http://${namespace}.localhost`,
        createdAt: new Date().toISOString()
      });
    }

    console.log(`Reconciled ${stores.size} stores.`);
  } catch (err) {
    console.error("Reconciliation failed:", err);
  }
}

/* -----------------------------
   Start Server
----------------------------- */

const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`Backend running on port ${PORT}`);
  await reconcileStoresOnStartup();
});