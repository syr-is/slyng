#!/bin/bash
# Migrate all S3 data from SeaweedFS to MinIO on production.
# Mirrors syr's scripts/migrate-seaweed-to-minio.sh, adapted for slyng.
#
# Run this ONCE on the server BEFORE redeploying with the MinIO compose,
# otherwise the fresh MinIO volume starts empty and existing uploads are lost.
#
# Usage (from project root):
#   SEAWEED_VOLUME=<actual-seaweedfs-prod-volume-name> bash scripts/migrate-seaweed-to-minio.sh
#
# Find the volume name with: docker volume ls | grep seaweedfs

set -euo pipefail

if [ -f .env ]; then
  set -a; source .env; set +a
fi

ACCESS_KEY="${S3_ACCESS_KEY_ID:-slyng-access-key}"
SECRET_KEY="${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY must be set}"
BUCKET="${S3_BUCKET:-slyng}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
# The SeaweedFS prod volume (project-prefixed). Override via env.
SEAWEED_VOLUME="${SEAWEED_VOLUME:?SEAWEED_VOLUME must be set — see 'docker volume ls | grep seaweedfs'}"

# Use the compose project network — all containers must share one.
NETWORK=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Networks}}' 2>/dev/null | head -1 | tr ',' '\n' | head -1)
if [ -z "$NETWORK" ]; then
  NETWORK=$(docker network ls --format '{{.Name}}' | grep -E "slyng.*default|code_default" | head -1)
fi
if [ -z "$NETWORK" ]; then
  NETWORK="code_default"
  docker network create "$NETWORK" 2>/dev/null || true
fi

echo "=== SeaweedFS → MinIO Migration ==="
echo "Bucket:  $BUCKET"
echo "Volume:  $SEAWEED_VOLUME"
echo "Network: $NETWORK"
echo ""

# 1. Start a temporary SeaweedFS reading the existing prod volume (internal only).
#    slyng prod ran SeaweedFS without -s3.config (no IAM), so no config is mounted.
echo "[1/5] Starting temporary SeaweedFS container..."
docker rm -f slyng-seaweed-migration 2>/dev/null || true
docker run -d \
  --name slyng-seaweed-migration \
  --network "$NETWORK" \
  -v "${SEAWEED_VOLUME}":/data \
  chrislusf/seaweedfs:latest \
  server -s3 -dir=/data -s3.port=8333 -volume.max=100 -ip=0.0.0.0 -filer=true

echo "Waiting for SeaweedFS S3 API..."
for i in $(seq 1 60); do
  if docker exec slyng-seaweed-migration wget -q -O /dev/null http://127.0.0.1:9333/cluster/status 2>/dev/null; then
    echo "SeaweedFS master ready, waiting for S3..."
    sleep 5
    echo "SeaweedFS S3 is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: SeaweedFS did not start in 60s"
    docker logs slyng-seaweed-migration --tail 20
    exit 1
  fi
  sleep 1
done

# 2. Ensure MinIO is running on the same network.
echo ""
echo "[2/5] Ensuring MinIO is running..."
docker compose -f "$COMPOSE_FILE" up -d minio
echo "Waiting for MinIO..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T minio curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "MinIO is ready."
    break
  fi
  sleep 1
done

MINIO_HOST=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Name}}' minio 2>/dev/null | head -1)
[ -z "$MINIO_HOST" ] && MINIO_HOST=$(docker ps --filter "name=minio" --format '{{.Names}}' | head -1)
echo "MinIO host: $MINIO_HOST"
docker network connect "$NETWORK" "$MINIO_HOST" 2>/dev/null || true

# 3. Create bucket + mirror.
echo ""
echo "[3/5] Creating bucket and mirroring data..."
docker run --rm --network "$NETWORK" --entrypoint sh minio/mc:latest -c "
  mc alias set seaweed http://slyng-seaweed-migration:8333 '$ACCESS_KEY' '$SECRET_KEY' &&
  mc alias set minio http://$MINIO_HOST:9000 '$ACCESS_KEY' '$SECRET_KEY' &&
  mc mb --ignore-existing minio/$BUCKET &&
  echo 'Mirroring objects...' &&
  mc mirror --overwrite seaweed/$BUCKET minio/$BUCKET
"

# 4. Verify.
echo ""
echo "[4/5] Verifying migration..."
docker run --rm --network "$NETWORK" --entrypoint sh minio/mc:latest -c "
  mc alias set seaweed http://slyng-seaweed-migration:8333 '$ACCESS_KEY' '$SECRET_KEY' &&
  mc alias set minio http://$MINIO_HOST:9000 '$ACCESS_KEY' '$SECRET_KEY' &&
  echo '--- SeaweedFS ---' && mc ls --recursive --summarize seaweed/$BUCKET | tail -3 &&
  echo '' &&
  echo '--- MinIO ---' && mc ls --recursive --summarize minio/$BUCKET | tail -3
"

# 5. Cleanup.
echo ""
echo "[5/5] Stopping temporary SeaweedFS container..."
docker stop slyng-seaweed-migration
docker rm slyng-seaweed-migration

echo ""
echo "=== Migration Complete ==="
echo "MinIO has all data. Redeploy the app (S3_PROVIDER=minio) — the API applies"
echo "the bucket's public-read policy on startup."
echo ""
