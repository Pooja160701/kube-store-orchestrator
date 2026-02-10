# Local to VPS Production Story

## Local

- k3d cluster
- Traefik ingress
- localhost domain
- local-path storage

## Production (k3s on VPS)

Changes only in Helm values:

values-prod.yaml:

- ingress.host → real domain
- storageClass → longhorn
- tls.enabled → true

Deployment command:

helm upgrade --install platform ./helm/platform -n platform -f values-prod.yaml

---

## DNS

Production requires:
- Domain A record pointing to VPS IP
- Traefik ingress controller

---

## TLS

Can integrate:
- cert-manager
- Let's Encrypt

---

## Upgrades

Helm supports safe upgrades:

helm upgrade platform ./helm/platform -n platform

Rollback:

helm rollback platform <revision>

Stores remain isolated in namespaces.

---

## Backup Strategy (Future)

- MySQL backups via CronJob
- Snapshot PVC
- External S3 storage

---

## Scaling on VPS

- Increase node count
- Scale backend replicas
- Use HPA