# Kubernetes Store Orchestrator

A multi-tenant store provisioning platform built on Kubernetes using Helm.

## Features

- Namespace-per-store isolation
- WooCommerce provisioning (WordPress + MySQL)
- Persistent storage per store
- Ingress-based HTTP exposure
- Clean teardown
- Local (k3d) and VPS (k3s) deployment via Helm
- No hardcoded secrets
- Designed for horizontal scaling

## Architecture Overview

Control Plane:
- React Dashboard
- Node.js Backend API
- Provisioning Orchestrator (Kubernetes-native)

Data Plane (per store):
- Namespace
- MySQL (Stateful + PVC)
- WordPress + WooCommerce
- Service
- Ingress
- Secrets
- ResourceQuota

## Deployment Modes

- Local: k3d + NGINX ingress
- Production-like: k3s on VPS

More details in `/docs/system-design.md`