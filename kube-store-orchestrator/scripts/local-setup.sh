#!/bin/bash

set -e

CLUSTER_NAME="store-cluster"
IMAGE_NAME="store-platform-backend:1.0"

echo "Starting Local Setup..."

# 1. Create cluster if not exists
if ! k3d cluster list | grep -q $CLUSTER_NAME; then
  echo "Creating k3d cluster..."
  k3d cluster create $CLUSTER_NAME --agents 2
else
  echo "Cluster already exists"
fi

# 2. Create platform namespace if not exists
if ! kubectl get namespace platform >/dev/null 2>&1; then
  echo "Creating namespace 'platform'..."
  kubectl create namespace platform
else
  echo "Namespace 'platform' already exists"
fi

# 3. Install or upgrade Helm chart
echo "Installing Helm chart..."
helm upgrade --install platform ./helm/platform \
  -n platform \
  -f ./helm/platform/values-local.yaml

# 4. Build backend image
echo "Building backend Docker image..."
cd backend
docker build -t $IMAGE_NAME .
cd ..

# 5. Import image into k3d
echo "Importing image into k3d cluster..."
k3d image import $IMAGE_NAME -c $CLUSTER_NAME

# 6. Restart backend deployment
echo "Restarting backend deployment..."
kubectl rollout restart deployment platform-backend -n platform

echo ""
echo "Local setup complete!"
echo "Dashboard: http://localhost:8080"