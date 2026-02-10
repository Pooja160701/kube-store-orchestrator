# System Design & Tradeoffs

## High-Level Design

The system consists of:

Dashboard → Backend API → Kubernetes API

The backend acts as an orchestration layer.
It provisions Kubernetes-native resources for each store.

Each store is isolated using a namespace-per-store model.

---

## Provisioning Flow

1. User clicks Create Store
2. Backend generates store ID
3. Backend creates namespace
4. Applies quotas & guardrails
5. Creates database (StatefulSet + PVC)
6. Creates application Deployment
7. Creates Service + Ingress
8. Polls readiness
9. Updates store status

---

## Isolation Model

Namespace-per-store provides:

- Network isolation
- Resource isolation
- Secret isolation
- PVC isolation
- Easy teardown

Deleting a namespace guarantees cleanup.

---

## Persistence

- MySQL StatefulSet
- PersistentVolumeClaim
- StorageClass configurable via Helm values

---

## Idempotency

- Reconciliation on startup scans namespaces
- Store state reconstructed from cluster
- Missing resources → store marked Failed
- Safe to restart provisioning backend

---

## Failure Handling

- Timeout for readiness
- Failed status tracked
- Activity log for actions

---

## Security

- Dedicated ServiceAccount
- ClusterRole with minimal verbs
- No cluster-admin privileges
- Secrets never hardcoded
- Default deny NetworkPolicy
- Resource quotas prevent blast radius

---

## Scaling Considerations

Stateless components:
- Dashboard
- Backend API

Stateful components:
- MySQL per store

Horizontal scaling:
- Increase backend replicas
- Increase cluster nodes
- Provisioning concurrency controlled via rate limiting

---

## Production Differences

Configured via Helm values:

Local:
- Host: localhost
- StorageClass: local-path
- No TLS

Production:
- Real domain
- Longhorn or cloud storage
- TLS enabled
- DNS configured externally

No code changes required.

---